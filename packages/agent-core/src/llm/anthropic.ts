import Anthropic from "@anthropic-ai/sdk";
import type { CompletionRequest, CompletionResult, LLMProvider } from "./types";
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

export class AnthropicProvider implements LLMProvider {
  readonly name = "anthropic";
  private readonly client: Anthropic;

  constructor(options: AnthropicProviderOptions = {}) {
    // Sin apiKey, el SDK resuelve ANTHROPIC_API_KEY / perfil de `ant auth login`.
    this.client = options.client ?? new Anthropic(options.apiKey ? { apiKey: options.apiKey } : {});
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const useFallback = SERVER_FALLBACK_MODELS.has(req.model);
    const response = await this.client.beta.messages.create({
      model: req.model,
      max_tokens: req.maxTokens,
      // Identidad estable en `system` con breakpoint de caché; lo volátil va en el mensaje.
      system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: req.prompt }],
      output_config: { effort: req.effort },
      ...(useFallback
        ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }
        : {}),
    });

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
}
