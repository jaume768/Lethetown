import type { CompletionRequest, CompletionResult, LLMProvider } from "@lethetown/agent-core";

export interface Spent {
  day: number;
  month: number;
}

/** Un administrador activó el kill switch: no se llama al LLM. */
export class BudgetExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BudgetExceededError";
  }
}

const dayKey = (d: Date) => d.toISOString().slice(0, 10);
const monthKey = (d: Date) => d.toISOString().slice(0, 7);

/** Inicio del día y del mes actuales (UTC), para sumar el gasto ya registrado en la BD. */
export function periodStarts(now: Date): { day: Date; month: Date } {
  return {
    day: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())),
    month: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
  };
}

/**
 * Lleva el gasto en LLM por mundo y global (día y mes UTC, solo para verlo) y el kill switch.
 * No hay límites de gasto: eso se controla con el saldo de la API key del proveedor.
 */
export class BudgetGuard {
  private readonly worlds = new Map<string, Spent>();
  private global: Spent = { day: 0, month: 0 };
  private day: string;
  private month: string;
  private _killed = false;

  constructor(private readonly now: () => Date = () => new Date()) {
    const d = now();
    this.day = dayKey(d);
    this.month = monthKey(d);
  }

  /** Gasto ya registrado (al arrancar, desde llm_calls). */
  load(initial: { global: Spent; worlds: Record<string, Spent> }): void {
    this.global = { ...initial.global };
    for (const [id, s] of Object.entries(initial.worlds)) this.worlds.set(id, { ...s });
  }

  get killed(): boolean {
    return this._killed;
  }

  setKilled(on: boolean): void {
    this._killed = on;
  }

  /** Suma un gasto. */
  record(worldId: string, usd: number): void {
    this.rollover();
    const w = this.spentOf(worldId);
    w.day += usd;
    w.month += usd;
    this.global.day += usd;
    this.global.month += usd;
  }

  /** Motivo por el que no se puede llamar al LLM ahora (kill switch), o null si se puede. */
  blockReason(_worldId: string): string | null {
    return this._killed ? "kill switch activado por un administrador" : null;
  }

  status(worldId?: string) {
    this.rollover();
    return {
      killed: this._killed,
      global: { ...this.global },
      world: worldId ? { ...this.spentOf(worldId) } : undefined,
      worlds: Object.fromEntries([...this.worlds].map(([id, s]) => [id, { ...s }])),
    };
  }

  private spentOf(worldId: string): Spent {
    let s = this.worlds.get(worldId);
    if (!s) {
      s = { day: 0, month: 0 };
      this.worlds.set(worldId, s);
    }
    return s;
  }

  private rollover(): void {
    const d = this.now();
    const day = dayKey(d);
    const month = monthKey(d);
    if (month !== this.month) {
      this.month = month;
      this.global.month = 0;
      for (const s of this.worlds.values()) s.month = 0;
    }
    if (day !== this.day) {
      this.day = day;
      this.global.day = 0;
      for (const s of this.worlds.values()) s.day = 0;
    }
  }
}

/** Proveedor que se niega a llamar al LLM si hay kill switch. */
export class BudgetedProvider implements LLMProvider {
  constructor(
    private readonly inner: LLMProvider,
    private readonly guard: BudgetGuard,
    private readonly worldId: string,
  ) {}

  get name(): string {
    return this.inner.name;
  }

  complete(req: CompletionRequest): Promise<CompletionResult> {
    const reason = this.guard.blockReason(this.worldId);
    if (reason) return Promise.reject(new BudgetExceededError(reason));
    return this.inner.complete(req);
  }
}
