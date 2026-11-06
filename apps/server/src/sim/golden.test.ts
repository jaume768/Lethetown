/**
 * Test dorado: 3 días de simulación en mock (SIM_SEED fijo, embeddings hash, RAM) deben producir
 * exactamente la misma línea de tiempo. Si cambias el comportamiento a propósito, regenera con
 * `pnpm vitest run apps/server -u` y revisa el diff de __golden__/three-days.txt.
 *
 * `three-days-off.txt` es el mismo mundo con la cognición en movimiento apagada
 * (`SIM_COGNITION=off`): es la línea de tiempo de antes de la fase 3.6 y NO debe cambiar con
 * nada de la 3.6 (es el mundo de control de los estudios). Si un cambio fuera de la 3.6 la
 * cambia a propósito, se regenera igual y se explica en el commit.
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

async function threeDays(env: Record<string, string>): Promise<string> {
  const app = await bootstrap(loadConfig(env), () => {});
  const w = app.defaultWorld;
  const lines: string[] = [];
  w.sim.onEvent((e) =>
    lines.push(`[${formatGameTime(e.time)}] ${e.kind} ${e.agentId ?? "-"} ${e.text}`),
  );
  w.start();
  await w.clock.runUntil(w.clock.now() + 72 * 60);
  const costs = w.costs.summary();
  lines.push(`llamadas: ${costs.total.calls}`);
  await app.close();
  return lines.join("\n") + "\n";
}

describe("simulación (dorado)", () => {
  it("con la cognición en movimiento apagada, la línea de tiempo de antes de la 3.6", async () => {
    await expect(await threeDays({ ...GOLDEN_ENV, SIM_COGNITION: "off" })).toMatchFileSnapshot(
      "__golden__/three-days-off.txt",
    );
  }, 30_000);

  it("3 días en mock con SIM_SEED=7 reproducen la misma línea de tiempo", async () => {
    await expect(await threeDays(GOLDEN_ENV)).toMatchFileSnapshot("__golden__/three-days.txt");
  }, 30_000);
});
