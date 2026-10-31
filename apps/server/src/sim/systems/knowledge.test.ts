/** Sistema `knowledge`: registro de conocimiento externo y lo que se aprende de otros. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { analyzeEvolution } from "../../analysis/evolution";
import { bootstrap, type App } from "../../bootstrap";
import { loadConfig } from "../../config";
import type { SimContext } from "../context";

let app: App;
let ctx: SimContext;

beforeAll(async () => {
  app = await bootstrap(
    loadConfig({ LLM_PROVIDER: "mock", EMBEDDINGS: "hash", DATABASE_URL: "", SIM_SEED: "7" }),
    () => {},
  );
  ctx = (app.defaultWorld.sim as unknown as { ctx: SimContext }).ctx;
});
afterAll(() => app.close());

describe("sistema knowledge", () => {
  it("registra los anacronismos de lo que entra en el mundo, sin bloquearlo (modo log)", async () => {
    const guard = ctx.deps.memory.guard!;
    expect(
      await guard.allows("Luego te mando un WhatsApp", { kind: "speech", agentId: "hugo" }),
    ).toBe(true);
    const rows = await app.defaultWorld.knowledgeLog.list();
    expect(rows[0]).toMatchObject({ kind: "anachronism", term: "whatsapp", agentId: "hugo" });
    expect(app.defaultWorld.sim.systemMetrics().knowledge).toMatchObject({
      anachronism: 1,
      "hugo.anachronism": 1,
    });
  });

  it("quien oye algo de fuera que no sabía lo guarda como recuerdo semántico con su fuente", async () => {
    ctx.emit(
      "speech",
      "samuel",
      'Samuel Okafor → Leo Gil: "En Lagos decimos que el agua tiene memoria"',
      ["samuel", "leo"],
    );
    await new Promise((r) => setTimeout(r, 50));
    const learned = (await ctx.deps.memory.store.listByAgent("leo")).filter((m) =>
      m.text.includes("me contó algo de Lagos"),
    );
    expect(learned).toHaveLength(1);
    expect(learned[0]).toMatchObject({ type: "semantic", source: "contado por samuel" });
    // Una vez: si lo vuelve a oír, no se duplica.
    ctx.emit("speech", "samuel", 'Samuel Okafor → Leo Gil: "Lagos es enorme"', ["samuel", "leo"]);
    await new Promise((r) => setTimeout(r, 50));
    const again = (await ctx.deps.memory.store.listByAgent("leo")).filter((m) =>
      m.text.includes("me contó algo de Lagos"),
    );
    expect(again).toHaveLength(1);
  });

  it("el informe de evolución lo cuenta por tipo, por agente y con ejemplos", async () => {
    const report = analyzeEvolution({
      seeds: ctx.deps.seeds,
      events: [],
      audits: [],
      socialHistory: [],
      llmCalls: [],
      knowledge: await app.defaultWorld.knowledgeLog.list(),
    });
    expect(report.knowledge?.byKind.anachronism).toBe(1);
    expect(report.knowledge?.byAgent.hugo).toEqual({ anachronism: 1 });
    expect(report.knowledge?.examples[0]?.term).toBe("whatsapp");
  });
});
