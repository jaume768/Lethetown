import OpenAI from "openai";
import type { CompletionRequest, CompletionResult, LLMProvider } from "./types";

export interface OpenAIProviderOptions {
  apiKey?: string;
  client?: OpenAI;
}

/** Usa la Responses API (la recomendada por OpenAI para gpt-6-*). */
export class OpenAIProvider implements LLMProvider {
  readonly name = "openai";
  private readonly client: OpenAI;

  constructor(options: OpenAIProviderOptions = {}) {
    this.client = options.client ?? new OpenAI(options.apiKey ? { apiKey: options.apiKey } : {});
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const response = await this.client.responses.create({
      model: req.model,
      instructions: req.system,
      input: req.prompt,
      max_output_tokens: req.maxTokens,
      reasoning: { effort: req.effort },
      ...(req.cacheKey ? { prompt_cache_key: req.cacheKey } : {}),
    });

    const usage = response.usage;
    // OpenAI incluye lecturas y escrituras de caché dentro de input_tokens: las separamos.
    const cached = usage?.input_tokens_details?.cached_tokens ?? 0;
    const cacheWrite = usage?.input_tokens_details?.cache_write_tokens ?? 0;
    return {
      text: response.output_text,
      model: response.model,
      usage: {
        inputTokens: Math.max(0, (usage?.input_tokens ?? 0) - cached - cacheWrite),
        outputTokens: usage?.output_tokens ?? 0,
        cacheReadTokens: cached,
        cacheWriteTokens: cacheWrite,
      },
    };
  }
}
