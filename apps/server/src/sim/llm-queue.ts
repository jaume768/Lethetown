import type { CompletionRequest, CompletionResult, LLMProvider } from "@lethetown/agent-core";

/**
 * Tareas que van delante en la cola: lo que hace esperar a una conversación o a una decisión
 * (y la moderación, que está en medio). El resto (esencias, fichas sociales, resúmenes,
 * crónicas, consolidación, reconsolidación) puede esperar.
 */
export const URGENT_TASKS: ReadonlySet<string> = new Set([
  "decide",
  "importance",
  "plan",
  "interview",
  "converse",
  "moderate",
  "moderate_minor",
]);

export type Priority = "high" | "low";

export const priorityOf = (task: string): Priority => (URGENT_TASKS.has(task) ? "high" : "low");

/** Espera en cola por tarea (ms reales). */
export interface QueueWait {
  calls: number;
  totalMs: number;
  maxMs: number;
}

interface Waiting {
  run: () => void;
  task: string;
  queuedAt: number;
}

/**
 * Decorador que limita las llamadas concurrentes al LLM (rate limits) con dos niveles de
 * prioridad: al quedar un hueco entra antes lo urgente (`URGENT_TASKS`); dentro de cada nivel,
 * por orden de llegada. Mide cuánto espera en cola cada tarea.
 */
export class LimitedProvider implements LLMProvider {
  private readonly queues: Record<Priority, Waiting[]> = { high: [], low: [] };
  private active = 0;
  private readonly waits = new Map<string, QueueWait>();

  constructor(
    private readonly inner: LLMProvider,
    private readonly concurrency: number,
    private readonly onWait: (task: string, ms: number) => void = () => {},
    private readonly realNow: () => number = () => performance.now(),
  ) {}

  get name(): string {
    return this.inner.name;
  }

  get pendingCount(): number {
    return this.queues.high.length + this.queues.low.length;
  }

  get activeCount(): number {
    return this.active;
  }

  /** Espera en cola acumulada por tarea desde que arrancó el proceso. */
  waitStats(): Record<string, QueueWait> {
    return Object.fromEntries([...this.waits].map(([task, w]) => [task, { ...w }]));
  }

  complete(req: CompletionRequest): Promise<CompletionResult> {
    const task = req.meta.task;
    return new Promise((resolve, reject) => {
      const run = () => {
        this.active++;
        this.inner
          .complete(req)
          .then(resolve, reject)
          .finally(() => {
            this.active--;
            this.next();
          });
      };
      this.queues[priorityOf(task)].push({ run, task, queuedAt: this.realNow() });
      this.next();
    });
  }

  private next(): void {
    while (this.active < this.concurrency) {
      const item = this.queues.high.shift() ?? this.queues.low.shift();
      if (!item) return;
      const ms = this.realNow() - item.queuedAt;
      const w = this.waits.get(item.task) ?? { calls: 0, totalMs: 0, maxMs: 0 };
      w.calls++;
      w.totalMs += ms;
      w.maxMs = Math.max(w.maxMs, ms);
      this.waits.set(item.task, w);
      this.onWait(item.task, ms);
      item.run();
    }
  }
}
