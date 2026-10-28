/**
 * Test dorado: 3 días de simulación en mock (SIM_SEED fijo, embeddings hash, RAM) deben producir
 * exactamente la misma línea de tiempo. Si cambias el comportamiento a propósito, regenera con
 * `pnpm vitest run apps/server -u` y revisa el diff de __golden__/three-days.txt.
 */
import { formatGameTime } from "@lethetown/agent-core";
import { describe, expect, it } from "vitest";
import { bootstrap } from "../bootstrap";
import { loadConfig } from "../config";

const GOLDEN_ENV = {
  LLM_PROVIDER: "mock",
  EMBEDDINGS: "hash",
  DATABASE_URL: "",
  SIM_SEED: "7",
  SIM_SPEED: "10",
  SIM_TICK_MINUTES: "10",
  SIM_WALK_TILES_PER_MINUTE: "6",
};

describe("simulación (dorado)", () => {
  it("3 días en mock con SIM_SEED=7 reproducen la misma línea de tiempo", async () => {
    const app = await bootstrap(loadConfig(GOLDEN_ENV), () => {});
    const lines: string[] = [];
    app.sim.onEvent((e) =>
      lines.push(`[${formatGameTime(e.time)}] ${e.kind} ${e.agentId ?? "-"} ${e.text}`),
    );
    app.sim.start();
    await app.clock.runUntil(app.clock.now() + 72 * 60);
    const costs = app.costs.summary();
    lines.push(`llamadas: ${costs.total.calls}`);
    await app.close();
    await expect(lines.join("\n") + "\n").toMatchFileSnapshot("__golden__/three-days.txt");
  }, 30_000);
});
