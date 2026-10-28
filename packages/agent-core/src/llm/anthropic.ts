import Anthropic from "@anthropic-ai/sdk";
import type { BatchCapableProvider, CompletionRequest, CompletionResult } from "./types";
import { LLMRefusalError } from "./types";

/**
 * Modelos que aceptan el fallback del lado servidor (`fallbacks: "default"`), que reenvía
 * la petición a otro modelo si la rechaza un clasificador. Haiku 5.5 no lo admite.
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

  /** Cuerpo de la petición, igual para la llamada directa y para un lote. */
  private params(req: CompletionRequest) {
    const useFallback = SERVER_FALLBACK_MODELS.has(req.model);
    return {
      model: req.model,
      max_tokens: req.maxTokens,
      // Identidad estable en `system` con breakpoint de caché; lo volátil va en el mensaje.
      system: [
        { type: "text" as const, text: req.system, cache_control: { type: "ephemeral" as const } },
      ],
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
    const betas = [...new Set(reqs.flatMap((r) => this.betas(r)))];
    const batch = await this.client.beta.messages.batches.create({
      requests: reqs.map((r, i) => ({ custom_id: `r${i}`, params: this.params(r) })),
      ...(betas.length ? { betas } : {}),
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
    usage: {
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      cacheReadTokens: usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
    },
  };
}
