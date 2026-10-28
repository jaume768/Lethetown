import type { CompletionRequest, CompletionResult, LLMProvider } from "@lethetown/agent-core";

/** Límites en USD por día y por mes (UTC). 0 = sin límite. */
export interface BudgetLimits {
  dailyUsd: number;
  monthlyUsd: number;
}

export interface Spent {
  day: number;
  month: number;
}

export interface BudgetBreach {
  scope: "world" | "global";
  worldId: string;
  period: "day" | "month";
  spent: number;
  limit: number;
}

/** El presupuesto se agotó o el admin activó el kill switch: no se llama al LLM. */
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
 * Lleva el gasto en LLM por mundo y global (día y mes UTC) y decide si se puede seguir
 * llamando. Al superar un límite avisa una vez (para pausar el mundo); al cambiar de día o de
 * mes los contadores vuelven a cero.
 */
export class BudgetGuard {
  private readonly worlds = new Map<string, Spent>();
  private global: Spent = { day: 0, month: 0 };
  private day: string;
  private month: string;
  private readonly breached = new Set<string>();
  private readonly listeners: ((b: BudgetBreach) => void)[] = [];
  private _killed = false;

  constructor(
    private readonly limits: { global: BudgetLimits; perWorld: BudgetLimits },
    private readonly now: () => Date = () => new Date(),
  ) {
    const d = now();
    this.day = dayKey(d);
    this.month = monthKey(d);
  }

  /** Gasto ya registrado (al arrancar, desde llm_calls). */
  load(initial: { global: Spent; worlds: Record<string, Spent> }): void {
    this.global = { ...initial.global };
    for (const [id, s] of Object.entries(initial.worlds)) this.worlds.set(id, { ...s });
  }

  onBreach(listener: (b: BudgetBreach) => void): void {
    this.listeners.push(listener);
  }

  get killed(): boolean {
    return this._killed;
  }

  setKilled(on: boolean): void {
    this._killed = on;
  }

  /** Suma un gasto y avisa (una vez por límite y periodo) si se ha superado alguno. */
  record(worldId: string, usd: number): void {
    this.rollover();
    const w = this.spentOf(worldId);
    w.day += usd;
    w.month += usd;
    this.global.day += usd;
    this.global.month += usd;
    for (const b of this.breaches(worldId)) {
      const key = `${b.scope}:${b.scope === "world" ? worldId : "*"}:${b.period}`;
      if (this.breached.has(key)) continue;
      this.breached.add(key);
      for (const l of this.listeners) l(b);
    }
  }

  /** Motivo por el que este mundo no puede llamar al LLM ahora, o null si puede. */
  blockReason(worldId: string): string | null {
    if (this._killed) return "kill switch activado por un administrador";
    this.rollover();
    const b = this.breaches(worldId)[0];
    return b ? describeBreach(b) : null;
  }

  status(worldId?: string) {
    this.rollover();
    return {
      killed: this._killed,
      limits: this.limits,
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

  private breaches(worldId: string): BudgetBreach[] {
    const out: BudgetBreach[] = [];
    const w = this.spentOf(worldId);
    const check = (scope: "world" | "global", spent: Spent, limits: BudgetLimits) => {
      if (limits.dailyUsd > 0 && spent.day >= limits.dailyUsd) {
        out.push({ scope, worldId, period: "day", spent: spent.day, limit: limits.dailyUsd });
      }
      if (limits.monthlyUsd > 0 && spent.month >= limits.monthlyUsd) {
        out.push({ scope, worldId, period: "month", spent: spent.month, limit: limits.monthlyUsd });
      }
    };
    check("world", w, this.limits.perWorld);
    check("global", this.global, this.limits.global);
    return out;
  }

  private rollover(): void {
    const d = this.now();
    const day = dayKey(d);
    const month = monthKey(d);
    if (month !== this.month) {
      this.month = month;
      this.global.month = 0;
      for (const s of this.worlds.values()) s.month = 0;
      for (const k of [...this.breached]) if (k.endsWith(":month")) this.breached.delete(k);
    }
    if (day !== this.day) {
      this.day = day;
      this.global.day = 0;
      for (const s of this.worlds.values()) s.day = 0;
      for (const k of [...this.breached]) if (k.endsWith(":day")) this.breached.delete(k);
    }
  }
}

export function describeBreach(b: BudgetBreach): string {
  const who = b.scope === "world" ? "del mundo" : "global";
  const period = b.period === "day" ? "diario" : "mensual";
  return `Presupuesto ${period} ${who} superado: $${b.spent.toFixed(2)} de $${b.limit.toFixed(2)}`;
}

/** Proveedor que se niega a llamar al LLM si el mundo no tiene presupuesto (o hay kill switch). */
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
