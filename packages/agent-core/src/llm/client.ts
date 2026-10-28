import type { CostTracker } from "./cost-tracker";
import type { ModelRouter } from "./router";
import type { CompletionResult, Effort, LLMProvider, TaskKind } from "./types";

export interface RunRequest {
  kind: TaskKind;
  task: string;
  agentId?: string;
  system: string;
  prompt: string;
  maxTokens?: number;
  effort?: Effort;
}

/** Fachada que combina proveedor + router + registro de costes. Es lo que usan los agentes. */
export class LLMClient {
  constructor(
    readonly provider: LLMProvider,
    readonly router: ModelRouter,
    readonly costs: CostTracker,
  ) {}

  async run(req: RunRequest): Promise<CompletionResult> {
    const model = this.router.modelFor(req.kind);
    const result = await this.provider.complete({
      model,
      system: req.system,
      prompt: req.prompt,
      maxTokens: req.maxTokens ?? (req.kind === "reflection" ? 4000 : 1000),
      effort: req.effort ?? (req.kind === "reflection" ? "medium" : "low"),
      cacheKey: req.agentId ? `agent:${req.agentId}` : undefined,
      meta: { task: req.task, agentId: req.agentId },
    });
    this.costs.record({
      model: result.model,
      task: req.task,
      agentId: req.agentId,
      usage: result.usage,
    });
    return result;
  }
}
