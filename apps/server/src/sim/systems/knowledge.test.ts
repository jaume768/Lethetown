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

describe("personas inventadas (PersonGuard, partida 2: «la Pepa»)", () => {
  it("lo que se guarda no lleva a la Pepa: «alguien», registrado como persona inventada", async () => {
    const rec = await ctx.deps.memory.tryRemember(
      {
        agentId: "rafael",
        text: "Ernesto me dijo que la Pepa la vio hablar con alguien de Palma.",
        type: "observation",
        importance: 5,
        people: ["ernesto"],
      },
      ctx.clock.now(),
    );
    expect(rec!.text).toBe("Ernesto me dijo que alguien la vio hablar con alguien de Palma.");
    const rows = await app.defaultWorld.knowledgeLog.list();
    expect(rows.some((r) => r.kind === "person" && r.term === "la Pepa")).toBe(true);
    const m = app.defaultWorld.sim.systemMetrics().knowledge!;
    expect(m.person).toBeGreaterThanOrEqual(1);
    expect(m["person.replaced"]).toBeGreaterThanOrEqual(1);
  });

  it("una intención con alguien que no existe se descarta", async () => {
    const id = await ctx.agents.get("ernesto")!.intend(ctx.clock.now(), {
      text: "preguntar a la Pepa si la han llamado de Promociones Llevant",
    });
    expect(id).toBeNull();
  });

  it("aprender de otros nunca aprende una persona inexistente; a la gente de fuera real, sí", async () => {
    ctx.emit(
      "speech",
      "ernesto",
      'Ernesto Blasco → Rafael Castro: "Me lo ha dicho la Pepa, de Lagos."',
      ["ernesto", "rafael"],
    );
    ctx.emit("speech", "aurora", 'Aurora Méndez → Samuel Okafor: "Alma se fue y nunca volvió."', [
      "aurora",
      "samuel",
    ]);
    await new Promise((r) => setTimeout(r, 50));
    const rafael = await ctx.deps.memory.store.listByAgent("rafael");
    expect(rafael.some((m) => m.text.includes("me contó algo de Pepa"))).toBe(false);
    // Samuel ya puede nombrar a Alma sin que cuente como inventada.
    const guard = ctx.deps.memory.guard!;
    expect(
      guard.findRewrites("Dicen que Alma era muy guapa.", { kind: "speech", agentId: "samuel" }),
    ).toEqual([]);
    expect(
      guard.findRewrites("Dicen que Alma era muy guapa.", { kind: "speech", agentId: "leo" }),
    ).toEqual(["Alma"]);
  });
});
