/** Practicar, enseñar y aprender, ayudar y enseñar lo hecho (sistema `skills`). */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootstrap, type App } from "../../bootstrap";
import { loadConfig } from "../../config";
import { applyAgreements } from "../agreements";
import type { SimContext } from "../context";
import { itemsState } from "../items";
import {
  addPractice,
  levelOf,
  resultsOf,
  sessionsAwaiting,
  sessionsTick,
  skillsState,
  skillsTick,
} from "../skills";
import { availableActions, runAction } from "./registry";
import { teachingRule } from "./skills";

let app: App;
let ctx: SimContext;
const agent = (id: string) => ctx.agents.get(id)!;
const now = () => ctx.clock.now();
const c = (id: string) => ({ ctx, agent: agent(id), now: now() });

beforeAll(async () => {
  app = await bootstrap(
    loadConfig({ LLM_PROVIDER: "mock", EMBEDDINGS: "hash", DATABASE_URL: "", SIM_SEED: "7" }),
    () => {},
  );
  ctx = (app.defaultWorld.sim as unknown as { ctx: SimContext }).ctx;
  // Todos durmiendo en su casa, salvo a quien se ponga en escena.
  for (const a of ctx.agents.values()) {
    a.state.locationId = a.seed.homeId;
    a.state.activityKind = "sleep";
  }
});
afterAll(() => app.close());

function at(id: string, placeId: string, action = "charlando") {
  const a = agent(id);
  a.state.locationId = placeId;
  a.state.activityKind = "idle";
  a.state.action = action;
  ctx.rt(id).travelling = false;
}

describe("enseñar y aprender", () => {
  it("Inés le pide a Valentina que le enseñe; acepta y aprenden las dos (y queda vínculo)", async () => {
    at("ines", "plaza");
    at("valentina", "plaza");
    expect(availableActions(c("ines"))).toContain("ask_to_learn");
    expect(
      await runAction(c("ines"), { type: "ask_to_learn", who: "valentina", skill: "photography" }),
    ).toBe(true);
    const [v] = sessionsAwaiting(ctx, "valentina", now());
    expect(v).toMatchObject({ teacherId: "valentina", learnerId: "ines", skill: "photography" });
    expect(await runAction(c("valentina"), { type: "accept_teaching", sessionId: v!.id })).toBe(
      true,
    );
    expect(agent("ines").state.action).toMatch(/aprendiendo fotografía con Valentina/);
    const before = levelOf(ctx, "ines", "photography");
    const teacher = levelOf(ctx, "valentina", "teaching");
    const affinity = (await ctx.deps.social.get("ines", "valentina"))?.affinity ?? 0;
    for (let t = 0; t < 12; t++) skillsTick(ctx, now() + t * 5, 5);
    // Con maestra: el doble que sola (y Valentina practica «enseñar»).
    expect(levelOf(ctx, "ines", "photography") - before).toBeGreaterThan(0.025);
    expect(levelOf(ctx, "valentina", "teaching")).toBeGreaterThan(teacher);
    sessionsTick(ctx, now() + 61);
    await new Promise((r) => setTimeout(r, 30));
    expect(skillsState(ctx).sessions.get(v!.id)!.status).toBe("done");
    expect((await ctx.deps.social.get("ines", "valentina"))!.affinity).toBeGreaterThan(affinity);
    const mem = await ctx.deps.memory.store.listByAgent("ines");
    expect(mem.some((m) => m.text === "Valentina Ríos me enseñó fotografía.")).toBe(true);
  });

  it("no se puede enseñar lo que no se sabe, ni aprender de quien sabe lo mismo", async () => {
    at("leo", "parque");
    at("hugo", "parque");
    expect(await runAction(c("leo"), { type: "teach", who: "hugo", skill: "music" })).toBe(false);
    expect(await runAction(c("leo"), { type: "ask_to_learn", who: "hugo", skill: "fishing" })).toBe(
      false,
    );
    expect(await runAction(c("leo"), { type: "ask_to_learn", who: "hugo", skill: "volar" })).toBe(
      false,
    );
  });

  it("menores: en sitio público o en su casa con su familia, nunca a solas en casa ajena", () => {
    expect(teachingRule(ctx, ["hugo", "leo"], "plaza")).toBeNull();
    expect(teachingRule(ctx, ["hugo", "leo"], "escuela")).toBeNull();
    expect(teachingRule(ctx, ["hugo", "leo"], agent("hugo").seed.homeId)).toMatch(/sitio público/);
    // En casa de Leo: su madre, sí; otro adulto, solo con su madre allí.
    const home = agent("leo").seed.homeId;
    expect(teachingRule(ctx, ["marta", "leo"], home)).toBeNull();
    agent("marta").state.locationId = "tienda";
    expect(teachingRule(ctx, ["hugo", "leo"], home)).toMatch(/con su familia/);
    agent("marta").state.locationId = home;
    expect(teachingRule(ctx, ["hugo", "leo"], home)).toBeNull();
  });
});

describe("ayudar, practicar y enseñar lo hecho", () => {
  it("ayudar a quien trabaja: practica lo suyo y suma afinidad", async () => {
    at("julian", "panaderia", "hornear y vender pan");
    agent("julian").state.activityKind = "work";
    at("clara", "panaderia");
    expect(availableActions(c("clara"))).toContain("help");
    expect(await runAction(c("clara"), { type: "help", who: "julian" })).toBe(true);
    const before = levelOf(ctx, "clara", "baking");
    skillsTick(ctx, now(), 30);
    expect(levelOf(ctx, "clara", "baking")).toBeGreaterThan(before);
  });

  it("practicar a propósito: en el sitio y con el objeto, y queda como práctica", async () => {
    at("nuria", "huerto", "tiempo libre");
    expect(
      await runAction(c("nuria"), {
        type: "practice",
        skill: "gardening",
        placeId: "huerto",
        spotId: null,
      }),
    ).toBe(true);
    expect(skillsState(ctx).practicing.get("nuria")?.skill).toBe("gardening");
    expect(
      await runAction(c("nuria"), {
        type: "practice",
        skill: "volar",
        placeId: null,
        spotId: null,
      }),
    ).toBe(false);
  });

  it("enseñar lo hecho: se lo regala y quien lo recibe nota la calidad", async () => {
    at("valentina", "plaza");
    at("aurora", "plaza");
    for (let i = 0; i < 4; i++) addPractice(ctx, agent("valentina"), "photography", 15, now());
    const [id] = resultsOf(ctx, "valentina");
    expect(id).toBeDefined();
    expect(
      await runAction(c("valentina"), { type: "show_result", who: "aurora", itemId: id! }),
    ).toBe(true);
    expect(itemsState(ctx).items.get(id!)!.holderId).toBe("aurora");
    const p = ctx.rt("aurora").pending.at(-1);
    expect(p && "text" in p ? p.text : "").toMatch(
      /Valentina Ríos me ha regalado una foto de Valentina/,
    );
  });
});

describe("acordado hablando", () => {
  it("«¿Me enseñas?» «Venga»: teach con las acciones formales (proponer y aceptar)", async () => {
    at("tomas", "lago");
    at("leo", "lago");
    await applyAgreements(ctx, { id: "conv-t", people: ["tomas", "leo"] }, "tomas", [
      {
        type: "teach",
        from: "tomas",
        to: ["leo"],
        itemId: null,
        placeId: null,
        skill: "fishing",
        loreId: null,
        at: null,
        day: "hoy",
        what: "pescar",
        quote: "Ven, que te enseño a pescar.",
      },
    ]);
    const active = [...skillsState(ctx).sessions.values()].find(
      (v) => v.teacherId === "tomas" && v.learnerId === "leo",
    );
    expect(active?.status).toBe("active");
  });
});
