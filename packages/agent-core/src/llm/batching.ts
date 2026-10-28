import type {
  BatchCapableProvider,
  CompletionRequest,
  CompletionResult,
  LLMProvider,
} from "./types";

export interface BatchingOptions {
  /** Tareas que pueden ir por lote (p. ej. consolidate, chronicle). */
  tasks: string[];
  /** Cuánto se espera a juntar peticiones antes de enviar el lote (ms reales). */
  windowMs: number;
  /** Cada cuánto se pregunta por el estado del lote (ms reales). */
  pollMs: number;
  /** Si el lote no termina en este tiempo, se cancela y se hace la llamada normal (ms reales). */
  maxWaitMs: number;
  /** ¿Se puede usar el lote ahora? (p. ej. solo si la simulación va despacio). */
  enabled: () => boolean;
}

interface Pending {
  req: CompletionRequest;
  resolve: (r: CompletionResult) => void;
  reject: (e: unknown) => void;
}

/**
 * Manda por la Batch API (50 % más barata, pero asíncrona) las tareas que no tienen prisa,
 * cuando `enabled()` lo permite. Junta las peticiones durante `windowMs` y, si el lote falla o
 * tarda más de `maxWaitMs`, cada petición se repite por la vía normal: nunca se pierde una.
 */
export class BatchingProvider implements LLMProvider {
  private queue: Pending[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly direct: LLMProvider,
    private readonly batcher: BatchCapableProvider,
    private readonly opts: BatchingOptions,
    private readonly onFallback: (reason: string) => void = () => {},
  ) {}

  get name(): string {
    return this.direct.name;
  }

  complete(req: CompletionRequest): Promise<CompletionResult> {
    if (!this.opts.tasks.includes(req.meta.task) || !this.opts.enabled()) {
      return this.direct.complete(req);
    }
    return new Promise((resolve, reject) => {
      this.queue.push({ req, resolve, reject });
      this.timer ??= setTimeout(() => void this.flush(), this.opts.windowMs);
    });
  }

  private async flush(): Promise<void> {
    this.timer = null;
    const batch = this.queue.splice(0);
    if (!batch.length) return;
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), this.opts.maxWaitMs);
    let results: (CompletionResult | Error)[];
    try {
      results = await this.batcher.submitBatch(
        batch.map((p) => p.req),
        { pollMs: this.opts.pollMs, signal: controller.signal },
      );
    } catch (error) {
      this.onFallback(error instanceof Error ? error.message : String(error));
      results = batch.map(() => new Error("lote fallido"));
    } finally {
      clearTimeout(deadline);
    }
    await Promise.all(
      batch.map(async (p, i) => {
        const r = results[i];
        if (r && !(r instanceof Error)) return p.resolve(r);
        try {
          p.resolve(await this.direct.complete(p.req));
        } catch (error) {
          p.reject(error);
        }
      }),
    );
  }
}
