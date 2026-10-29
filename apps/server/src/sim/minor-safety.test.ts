/** Protección de menores de punta a punta: descartes en moderation_log y voz interior. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootstrap, type App } from "../bootstrap";
import { loadConfig } from "../config";

let app: App;

beforeAll(async () => {
  app = await bootstrap(
    loadConfig({
      LLM_PROVIDER: "mock",
      EMBEDDINGS: "hash",
      DATABASE_URL: "",
      SIM_SEED: "7",
      MODERATION: "off",
    }),
    () => {},
  );
});
afterAll(() => app.close());

describe("protección de menores en el servidor", () => {
  it("los agentes conocen a los menores del pueblo en su identidad", () => {
    const hugo = app.defaultWorld.sim.agents.get("hugo")!;
    expect(hugo.system).toContain("Inés Ortega (16 años)");
    expect(hugo.system).toContain("Leo Gil (10 años)");
  });

  it("un recuerdo romántico sobre un menor no se guarda y queda en moderation_log", async () => {
    const w = app.defaultWorld;
    const r = await w.memory.tryRemember(
      { agentId: "hugo", text: "Estoy enamorado de Inés", type: "observation", importance: 6 },
      w.clock.now(),
    );
    expect(r).toBeNull();
    await app.flush();
    const log = await app.moderationLog.recent(w.id);
    expect(log[0]).toMatchObject({ kind: "minor_safety:memory", userId: null });
  });

  it("la voz interior romántica hacia un menor se rechaza aunque la moderación esté apagada", async () => {
    const w = app.defaultWorld;
    const vetted = await w.vetUserText("thought", "Quiero ligar con él", null, "leo");
    expect(vetted.ok).toBe(false);
    const ok = await w.vetUserText("thought", "Quiero ir al lago a buscar el pez", null, "leo");
    expect(ok.ok).toBe(true);
  });
});
