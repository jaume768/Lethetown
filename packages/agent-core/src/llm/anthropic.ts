import Anthropic from "@anthropic-ai/sdk";
import type { BatchCapableProvider, CompletionRequest, CompletionResult } from "./types";
import { IDENTITY_HEADING, LLMRefusalError } from "./types";

/**
 * Modelos que aceptan el fallback del lado servidor (`fallbacks: "default"`), que reenvía
 * la petición a otro modelo si la rechaza un clasificador. Haiku 5.5 no lo admite, y los
 * lotes tampoco (la API responde 400 «The `fallbacks` parameter is not supported for batch
 * requests»): en un lote va sin él y, si se rechaza, se repite por la vía normal, que sí lo lleva.
 */
const SERVER_FALLBACK_MODELS = new Set([
  "claude-sonnet-5-5",
  "claude-opus-5-5",
  "claude-opus-5",
  "claude-fable-5-1",
]);

export interface AnthropicProviderOptions {
  apiKey?: string;
  client?: Anthropic;
}

type BetaMessage = Anthropic.Beta.Messages.BetaMessage;

export class AnthropicProvider implements BatchCapableProvider {
  readonly name = "anthropic";
  private readonly client: Anthropic;

  constructor(options: AnthropicProviderOptions = {}) {
    // Sin apiKey, el SDK resuelve ANTHROPIC_API_KEY / perfil de `ant auth login`.
    // Reintentos y timeouts los gestiona ResilientProvider (no los dupliquemos en el SDK).
    this.client =
      options.client ??
      new Anthropic({ maxRetries: 0, ...(options.apiKey ? { apiKey: options.apiKey } : {}) });
  }

  /** Cuerpo de la petición, igual para la llamada directa y para un lote (sin el fallback). */
  private params(req: CompletionRequest, batch = false) {
    const useFallback = !batch && SERVER_FALLBACK_MODELS.has(req.model);
    return {
      model: req.model,
      max_tokens: req.maxTokens,
      // `system` estable con puntos de caché; lo volátil va en el mensaje. Si trae la
      // identidad aparte (`## Quién eres`), dos bloques: lo común a todos los vecinos (lo
      // comparten los 20) y lo de cada uno. Hasta 4 puntos por petición; los dos con el mismo
      // TTL (uno de 1 h no puede ir detrás de uno de 5 min).
      system: splitSystem(req.system).map((text) => ({
        type: "text" as const,
        text,
        cache_control: {
          type: "ephemeral" as const,
          // TTL de 1 h (documentado: escritura a 2× la entrada); sin él, 5 min.
          ...(req.cacheTtl === "1h" ? { ttl: "1h" as const } : {}),
        },
      })),
      messages: [{ role: "user" as const, content: req.prompt }],
      output_config: { effort: req.effort },
      ...(useFallback ? { fallbacks: "default" as const } : {}),
    };
  }

  private betas(req: CompletionRequest): Anthropic.Beta.AnthropicBeta[] {
    return SERVER_FALLBACK_MODELS.has(req.model) ? ["server-side-fallback-2026-07-01"] : [];
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const betas = this.betas(req);
    const response = await this.client.beta.messages.create(
      { ...this.params(req), ...(betas.length ? { betas } : {}) },
      { signal: req.signal },
    );
    return toResult(response);
  }

  /**
   * Message Batches: 50 % más barato, asíncrono (normalmente minutos). Sondea cada `pollMs`
   * hasta que termina o se aborta (y entonces cancela el lote).
   */
  async submitBatch(
    reqs: CompletionRequest[],
    opts: { pollMs: number; signal: AbortSignal },
  ): Promise<(CompletionResult | Error)[]> {
    const batch = await this.client.beta.messages.batches.create({
      requests: reqs.map((r, i) => ({ custom_id: `r${i}`, params: this.params(r, true) })),
    });
    try {
      for (;;) {
        const status = await this.client.beta.messages.batches.retrieve(batch.id);
        if (status.processing_status === "ended") break;
        await abortableSleep(opts.pollMs, opts.signal);
      }
    } catch (error) {
      await this.client.beta.messages.batches.cancel(batch.id).catch(() => undefined);
      throw error;
    }
    const out: (CompletionResult | Error)[] = reqs.map(() => new Error("sin resultado en el lote"));
    for await (const item of await this.client.beta.messages.batches.results(batch.id)) {
      const i = Number(item.custom_id.slice(1));
      const r = item.result;
      try {
        out[i] =
          r.type === "succeeded"
            ? { ...toResult(r.message), priceMultiplier: 0.5 }
            : new Error(`Lote: petición ${r.type}`);
      } catch (error) {
        out[i] = error instanceof Error ? error : new Error(String(error));
      }
    }
    return out;
  }
}

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error("lote cancelado"));
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new Error("lote cancelado"));
    });
  });
}

function toResult(response: BetaMessage): CompletionResult {
  if (response.stop_reason === "refusal") {
    throw new LLMRefusalError(
      response.stop_details?.explanation ?? "El modelo rechazó la petición",
      response.model,
    );
  }
  const text = response.content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("");
  const usage = response.usage;
  return {
    text,
    model: response.model,
    cacheWrite1hTokens: usage.cache_creation?.ephemeral_1h_input_tokens ?? 0,
    usage: {
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      cacheReadTokens: usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
    },
  };
}

/**
 * El `system` en bloques de caché: lo común a todos (hasta «## Quién eres») y lo de cada uno.
 * Sin el encabezado, un solo bloque. Concatenados dan exactamente el texto original.
 */
export function splitSystem(system: string): string[] {
  const at = system.indexOf(`\n${IDENTITY_HEADING}\n`);
  if (at <= 0) return [system];
  return [system.slice(0, at + 1), system.slice(at + 1)];
}
