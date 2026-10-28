import { describe, expect, it } from "vitest";
import { BudgetExceededError, BudgetGuard, BudgetedProvider, type BudgetBreach } from "./budget";

const limits = {
  global: { dailyUsd: 3, monthlyUsd: 10 },
  perWorld: { dailyUsd: 1, monthlyUsd: 5 },
};

function guardAt(iso: { t: string }) {
  return new BudgetGuard(limits, () => new Date(iso.t));
}

describe("BudgetGuard", () => {
  it("avisa una sola vez al superar el límite diario del mundo y bloquea solo ese mundo", () => {
    const clock = { t: "2026-10-28T10:00:00Z" };
    const g = guardAt(clock);
    const breaches: BudgetBreach[] = [];
    g.onBreach((b) => breaches.push(b));
    g.record("a", 0.6);
    expect(g.blockReason("a")).toBeNull();
    g.record("a", 0.5);
    g.record("a", 0.1);
    expect(breaches).toHaveLength(1);
    expect(breaches[0]).toMatchObject({ scope: "world", worldId: "a", period: "day" });
    expect(g.blockReason("a")).toMatch(/diario del mundo/);
    expect(g.blockReason("b")).toBeNull();
  });

  it("el límite global bloquea todos los mundos", () => {
    const g = guardAt({ t: "2026-10-28T10:00:00Z" });
    g.record("a", 0.9);
    g.record("b", 0.9);
    g.record("c", 0.9);
    expect(g.blockReason("d")).toBeNull();
    g.record("d", 0.4);
    expect(g.blockReason("e")).toMatch(/diario global/);
  });

  it("al cambiar de día se reinicia el diario pero no el mensual", () => {
    const clock = { t: "2026-10-28T23:00:00Z" };
    const g = guardAt(clock);
    g.load({ global: { day: 0, month: 4.5 }, worlds: { a: { day: 1.2, month: 4.5 } } });
    expect(g.blockReason("a")).toMatch(/diario/);
    clock.t = "2026-10-29T00:10:00Z";
    expect(g.blockReason("a")).toBeNull();
    g.record("a", 0.6);
    expect(g.blockReason("a")).toMatch(/mensual del mundo/);
    clock.t = "2026-11-01T00:10:00Z";
    expect(g.blockReason("a")).toBeNull();
  });

  it("el kill switch bloquea las llamadas del proveedor", async () => {
    const g = guardAt({ t: "2026-10-28T10:00:00Z" });
    const inner = {
      name: "fake",
      complete: async () => ({
        text: "{}",
        model: "m",
        usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
      }),
    };
    const p = new BudgetedProvider(inner, g, "a");
    await expect(p.complete({} as never)).resolves.toBeTruthy();
    g.setKilled(true);
    await expect(p.complete({} as never)).rejects.toBeInstanceOf(BudgetExceededError);
  });
});
