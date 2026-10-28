import type { CompletionRequest, CompletionResult, LLMProvider } from "./types";

export type MockResponder = (req: CompletionRequest) => string;

/** Aproximación barata: ~4 caracteres por token. */
export const estimateTokens = (text: string): number => Math.ceil(text.length / 4);

/**
 * Proveedor determinista sin red. La lógica de respuesta se inyecta (`responder`)
 * para que agent-core pueda dar respuestas con sentido sin acoplar el proveedor a los prompts.
 * Simula prompt caching: la segunda vez que ve un `system` lo cuenta como lectura de caché.
 */
export class MockProvider implements LLMProvider {
  readonly name = "mock";
  readonly calls: CompletionRequest[] = [];
  private readonly seenSystems = new Set<string>();

  constructor(private readonly responder: MockResponder = () => "ok") {}

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    this.calls.push(req);
    const text = this.responder(req);
    const systemTokens = estimateTokens(req.system);
    const cached = this.seenSystems.has(req.system);
    this.seenSystems.add(req.system);
    return {
      text,
      model: req.model,
      usage: {
        inputTokens: estimateTokens(req.prompt) + (cached ? 0 : systemTokens),
        outputTokens: estimateTokens(text),
        cacheReadTokens: cached ? systemTokens : 0,
        cacheWriteTokens: 0,
      },
    };
  }
}
