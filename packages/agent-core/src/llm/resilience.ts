import type { CompletionRequest, CompletionResult, LLMProvider } from "./types";
import { LLMRefusalError } from "./types";

export interface ResilienceOptions {
  /** Tiempo máximo por intento (ms). */
  timeoutMs: number;
  /** Reintentos tras el primer intento (solo en errores transitorios). */
  retries: number;
  /** Espera base del backoff exponencial (ms): base · 2^intento, con jitter completo. */
  baseDelayMs: number;
  maxDelayMs: number;
  /** Fallos seguidos que abren el circuito. */
  breakerThreshold: number;
  /** Tiempo con el circuito abierto antes de dejar pasar una llamada de prueba (ms). */
  breakerCooldownMs: number;
}

export const DEFAULT_RESILIENCE: ResilienceOptions = {
  timeoutMs: 60_000,
  retries: 3,
  baseDelayMs: 500,
  maxDelayMs: 20_000,
  breakerThreshold: 5,
  breakerCooldownMs: 30_000,
};

/** El circuito del proveedor está abierto: se falla rápido sin llamar a la API. */
export class CircuitOpenError extends Error {
  constructor(provider: string, retryInMs: number) {
    super(
      `Proveedor ${provider} no disponible (circuito abierto, reintento en ${Math.ceil(retryInMs / 1000)} s)`,
    );
    this.name = "CircuitOpenError";
  }
}

export class LLMTimeoutError extends Error {
  constructor(ms: number) {
    super(`El LLM no respondió en ${ms} ms`);
    this.name = "LLMTimeoutError";
  }
}

const statusOf = (e: unknown): number | undefined => {
  const s = (e as { status?: unknown } | null)?.status;
  return typeof s === "number" ? s : undefined;
};

/** ¿Merece la pena reintentar? Timeouts, red, 408, 409, 429 y 5xx (incluido 529 "overloaded"). */
export function isTransient(e: unknown): boolean {
  if (e instanceof LLMRefusalError) return false;
  if (e instanceof LLMTimeoutError) return true;
  const status = statusOf(e);
  if (status !== undefined)
    return status === 408 || status === 409 || status === 429 || status >= 500;
  const code = (e as { code?: unknown } | null)?.code;
  const name = (e as { name?: unknown } | null)?.name;
  return (
    name === "APIConnectionError" ||
    name === "APIConnectionTimeoutError" ||
    (typeof code === "string" &&
      ["ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "EAI_AGAIN"].includes(code))
  );
}

/** Espera sugerida por el servidor (cabecera retry-after, en segundos), si la hay. */
function retryAfterMs(e: unknown): number | undefined {
  const headers = (e as { headers?: { get?: (k: string) => string | null } } | null)?.headers;
  const v = headers?.get?.("retry-after");
  const secs = v ? Number(v) : NaN;
  return Number.isFinite(secs) ? secs * 1000 : undefined;
}

export interface ResilienceEvents {
  onRetry?: (info: { attempt: number; delayMs: number; error: unknown }) => void;
  onBreaker?: (state: "open" | "half-open" | "closed") => void;
  onError?: (error: unknown) => void;
}

/**
 * Decorador de proveedor: timeout propio por intento (con AbortSignal), reintentos con
 * backoff exponencial y jitter completo en errores transitorios (429, 5xx, red) y un circuit
 * breaker que, tras N fallos seguidos, falla rápido durante un tiempo.
 */
export class ResilientProvider implements LLMProvider {
  private failures = 0;
  private openedAt: number | null = null;
  private halfOpenInFlight = false;

  constructor(
    private readonly inner: LLMProvider,
    private readonly opts: ResilienceOptions = DEFAULT_RESILIENCE,
    private readonly events: ResilienceEvents = {},
    private readonly deps: {
      now?: () => number;
      sleep?: (ms: number) => Promise<void>;
      /** Azar para el jitter (no afecta a la simulación: solo a tiempos de espera reales). */
      random?: () => number;
    } = {},
  ) {}

  get name(): string {
    return this.inner.name;
  }

  get breakerState(): "closed" | "open" | "half-open" {
    if (this.openedAt === null) return "closed";
    return this.now() - this.openedAt >= this.opts.breakerCooldownMs ? "half-open" : "open";
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    this.checkBreaker();
    let attempt = 0;
    for (;;) {
      try {
        const result = await this.withTimeout(req);
        this.succeed();
        return result;
      } catch (error) {
        const transient = isTransient(error);
        if (transient) this.fail();
        else this.halfOpenInFlight = false;
        this.events.onError?.(error);
        if (!transient || attempt >= this.opts.retries || this.openedAt !== null) throw error;
        const backoff = Math.min(this.opts.maxDelayMs, this.opts.baseDelayMs * 2 ** attempt);
        const delayMs = Math.max(retryAfterMs(error) ?? 0, Math.round(this.random() * backoff));
        attempt++;
        this.events.onRetry?.({ attempt, delayMs, error });
        await this.sleep(delayMs);
      }
    }
  }

  private async withTimeout(req: CompletionRequest): Promise<CompletionResult> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        // Primero el rechazo (gana la carrera) y luego se aborta la petición en curso.
        reject(new LLMTimeoutError(this.opts.timeoutMs));
        controller.abort();
      }, this.opts.timeoutMs);
    });
    try {
      return await Promise.race([
        this.inner.complete({ ...req, signal: controller.signal }),
        timeout,
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  private checkBreaker() {
    const state = this.breakerState;
    if (state === "closed") return;
    if (state === "open" || this.halfOpenInFlight) {
      throw new CircuitOpenError(
        this.name,
        this.opts.breakerCooldownMs - (this.now() - this.openedAt!),
      );
    }
    // Medio abierto: deja pasar una sola llamada de prueba.
    this.halfOpenInFlight = true;
    this.events.onBreaker?.("half-open");
  }

  private succeed() {
    this.failures = 0;
    this.halfOpenInFlight = false;
    if (this.openedAt !== null) {
      this.openedAt = null;
      this.events.onBreaker?.("closed");
    }
  }

  private fail() {
    this.failures++;
    const wasHalfOpen = this.halfOpenInFlight;
    this.halfOpenInFlight = false;
    if (wasHalfOpen || this.failures >= this.opts.breakerThreshold) {
      this.openedAt = this.now();
      this.events.onBreaker?.("open");
    }
  }

  private now() {
    return (this.deps.now ?? Date.now)();
  }
  private sleep(ms: number) {
    return (this.deps.sleep ?? ((t) => new Promise<void>((r) => setTimeout(r, t))))(ms);
  }
  private random() {
    // Jitter de tiempos de espera reales, fuera de la simulación determinista.
    return (this.deps.random ?? Math.random)();
  }
}
