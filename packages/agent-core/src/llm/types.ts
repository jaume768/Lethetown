import type { TokenUsage } from "@lethetown/shared";

/** Tipo de tarea: decide qué modelo usa el ModelRouter. */
export type TaskKind = "fast" | "reflection";

export type Effort = "low" | "medium" | "high";

/** Duración de la caché del prompt fijo (Anthropic: 5 min por defecto, o 1 h). */
export type CacheTtl = "5m" | "1h";

export interface CompletionRequest {
  model: string;
  /**
   * Prefijo estable (identidad del agente + reglas del mundo). Debe ser byte a byte
   * idéntico entre llamadas del mismo agente para aprovechar el prompt caching.
   */
  system: string;
  /** Parte volátil: percepciones, memoria de trabajo, hora... */
  prompt: string;
  maxTokens: number;
  effort: Effort;
  /** Clave de caché para proveedores que la admiten (OpenAI `prompt_cache_key`). */
  cacheKey?: string;
  /** Duración de la caché del prefijo (`system`); sin definir, la del proveedor (5 min). */
  cacheTtl?: CacheTtl;
  /** Metadatos para el registro de costes y para el MockProvider. */
  meta: CompletionMeta;
  /** Cancela la llamada (timeout propio de ResilientProvider). */
  signal?: AbortSignal;
}

export interface CompletionMeta {
  /** Nombre de la tarea concreta: "plan", "decide", "importance"... */
  task: string;
  agentId?: string;
}

export interface CompletionResult {
  text: string;
  usage: TokenUsage;
  /** Modelo que realmente respondió (puede diferir si hubo fallback). */
  model: string;
  /** Multiplicador de precio (Batch API: 0.5). Por defecto 1. */
  priceMultiplier?: number;
  /** De `usage.cacheWriteTokens`, los escritos con TTL de 1 h (se cobran a 2× la entrada). */
  cacheWrite1hTokens?: number;
}

/** Proveedor que además admite envío por lotes asíncrono (p. ej. Message Batches de Anthropic). */
export interface BatchCapableProvider extends LLMProvider {
  /** Envía las peticiones en un lote y espera los resultados (en el mismo orden). */
  submitBatch(
    reqs: CompletionRequest[],
    opts: { pollMs: number; signal: AbortSignal },
  ): Promise<(CompletionResult | Error)[]>;
}

export function isBatchCapable(p: LLMProvider): p is BatchCapableProvider {
  return typeof (p as Partial<BatchCapableProvider>).submitBatch === "function";
}

export interface LLMProvider {
  readonly name: string;
  complete(req: CompletionRequest): Promise<CompletionResult>;
}

/** El modelo rechazó la petición (p. ej. stop_reason "refusal"). */
export class LLMRefusalError extends Error {
  constructor(
    message: string,
    readonly model: string,
  ) {
    super(message);
    this.name = "LLMRefusalError";
  }
}

export const emptyUsage = (): TokenUsage => ({
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
});
