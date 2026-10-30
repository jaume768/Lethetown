import { describe, expect, it } from "vitest";
import { BudgetExceededError, BudgetGuard, BudgetedProvider } from "./budget";

function guardAt(iso: { t: string }) {
  return new BudgetGuard(() => new Date(iso.t));
}

describe("BudgetGuard", () => {
  it("suma el gasto por mundo y global, sin bloquear nunca por gasto", () => {
    const g = guardAt({ t: "2026-10-28T10:00:00Z" });
    g.record("a", 100);
    g.record("b", 0.5);
    expect(g.blockReason("a")).toBeNull();
    expect(g.status("a")).toMatchObject({ world: { day: 100 }, global: { day: 100.5 } });
  });

  it("al cambiar de día se reinicia el diario pero no el mensual", () => {
    const clock = { t: "2026-10-28T23:00:00Z" };
    const g = guardAt(clock);
    g.load({ global: { day: 1, month: 4.5 }, worlds: { a: { day: 1, month: 4.5 } } });
    clock.t = "2026-10-29T00:10:00Z";
    g.record("a", 0.5);
    expect(g.status("a").world).toEqual({ day: 0.5, month: 5 });
    clock.t = "2026-11-01T00:10:00Z";
    expect(g.status("a").world).toEqual({ day: 0, month: 0 });
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
