import type { CompletionRequest, CompletionResult, LLMProvider } from "@lethetown/agent-core";
import pLimit, { type LimitFunction } from "p-limit";

/** Decorador que limita las llamadas concurrentes al LLM (rate limits). */
export class LimitedProvider implements LLMProvider {
  private readonly limit: LimitFunction;

  constructor(
    private readonly inner: LLMProvider,
    concurrency: number,
  ) {
    this.limit = pLimit(concurrency);
  }

  get name(): string {
    return this.inner.name;
  }

  get pendingCount(): number {
    return this.limit.pendingCount;
  }

  get activeCount(): number {
    return this.limit.activeCount;
  }

  complete(req: CompletionRequest): Promise<CompletionResult> {
    return this.limit(() => this.inner.complete(req));
  }
}
