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

/** Aviso de inicio/fin de cada llamada (el servidor lo usa para el indicador "pensando"). */
export interface CallEvent {
  phase: "start" | "end";
  task: string;
  agentId?: string;
  model: string;
  ok?: boolean;
}

/** Fachada que combina proveedor + router + registro de costes. Es lo que usan los agentes. */
export class LLMClient {
  private readonly listeners: ((e: CallEvent) => void)[] = [];

  constructor(
    readonly provider: LLMProvider,
    readonly router: ModelRouter,
    readonly costs: CostTracker,
  ) {}

  onCall(listener: (e: CallEvent) => void): void {
    this.listeners.push(listener);
  }

  private notify(e: CallEvent) {
    for (const l of this.listeners) l(e);
  }

  async run(req: RunRequest): Promise<CompletionResult> {
    const model = this.router.modelFor(req.kind);
    const base = { task: req.task, agentId: req.agentId, model };
    this.notify({ ...base, phase: "start" });
    try {
      const result = await this.call(req, model);
      this.notify({ ...base, phase: "end", ok: true });
      return result;
    } catch (error) {
      this.notify({ ...base, phase: "end", ok: false });
      throw error;
    }
  }

  private async call(req: RunRequest, model: string): Promise<CompletionResult> {
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
