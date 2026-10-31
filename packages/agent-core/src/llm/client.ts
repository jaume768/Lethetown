import type { CostTracker } from "./cost-tracker";
import type { ModelRouter } from "./router";
import type { CacheTtl, CompletionResult, Effort, LLMProvider, TaskKind } from "./types";
import { MAX_TOKENS } from "./limits";

/** Enrutado de una tarea: qué tipo de modelo usa y cuánto dura la caché de su prefijo. */
export interface TaskRoute {
  kind?: TaskKind;
  cacheTtl?: CacheTtl;
}

/** Por tarea ("summarize" → { kind: "fast" }); lo que no aparece usa el `kind` de la llamada. */
export type TaskRouting = Record<string, TaskRoute>;

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
  /** Solo en "end": duración de la llamada (ms reales) y nombre del error si falló. */
  durationMs?: number;
  error?: string;
}

/**
 * Fachada que combina proveedor + router + registro de costes. Es lo que usan los agentes. El
 * enrutado por tarea (`config/llm-routing.json` en el servidor) puede cambiar el tipo de modelo
 * que pide cada llamada.
 */
export class LLMClient {
  private readonly listeners: ((e: CallEvent) => void)[] = [];

  constructor(
    readonly provider: LLMProvider,
    readonly router: ModelRouter,
    readonly costs: CostTracker,
    readonly routing: TaskRouting = {},
  ) {}

  /** Tipo de modelo que usa de verdad una llamada (el del enrutado, si lo hay). */
  kindFor(task: string, requested: TaskKind): TaskKind {
    return this.routing[task]?.kind ?? requested;
  }

  onCall(listener: (e: CallEvent) => void): void {
    this.listeners.push(listener);
  }

  private notify(e: CallEvent) {
    for (const l of this.listeners) l(e);
  }

  async run(request: RunRequest): Promise<CompletionResult> {
    const req = { ...request, kind: this.kindFor(request.task, request.kind) };
    const model = this.router.modelFor(req.kind);
    const base = { task: req.task, agentId: req.agentId, model };
    this.notify({ ...base, phase: "start" });
    const t0 = performance.now();
    try {
      const result = await this.call(req, model);
      this.notify({ ...base, phase: "end", ok: true, durationMs: performance.now() - t0 });
      return result;
    } catch (error) {
      this.notify({
        ...base,
        phase: "end",
        ok: false,
        durationMs: performance.now() - t0,
        error: error instanceof Error ? error.name : "Error",
      });
      throw error;
    }
  }

  private async call(req: RunRequest, model: string): Promise<CompletionResult> {
    const result = await this.provider.complete({
      model,
      system: req.system,
      prompt: req.prompt,
      maxTokens:
        req.maxTokens ?? (req.kind === "reflection" ? MAX_TOKENS.reflection : MAX_TOKENS.fast),
      effort: req.effort ?? (req.kind === "reflection" ? "medium" : "low"),
      cacheKey: req.agentId ? `agent:${req.agentId}` : undefined,
      cacheTtl: this.routing[req.task]?.cacheTtl,
      meta: { task: req.task, agentId: req.agentId },
    });
    this.costs.record(
      { model: result.model, task: req.task, agentId: req.agentId, usage: result.usage },
      result.priceMultiplier ?? 1,
      result.cacheWrite1hTokens ?? 0,
    );
    return result;
  }
}
