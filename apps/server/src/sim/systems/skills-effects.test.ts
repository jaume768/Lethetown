/** Que la habilidad importe: arreglar, la calidad de lo que se sirve, resultados y metas. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootstrap, type App } from "../../bootstrap";
import { loadConfig } from "../../config";
import { runAction } from "../actions";
import type { SimContext } from "../context";
import { createGoal, goalsOf, measureTick } from "../goals";
import { itemsState } from "../items";
import { addPractice, levelOf, resultsOf, serveResult, skillState, skillsState } from "../skills";

let app: App;
let ctx: SimContext;
const agent = (id: string) => ctx.agents.get(id)!;

beforeAll(async () => {
  app = await bootstrap(
    loadConfig({ LLM_PROVIDER: "mock", EMBEDDINGS: "hash", DATABASE_URL: "", SIM_SEED: "7" }),
    () => {},
  );
  ctx = (app.defaultWorld.sim as unknown as { ctx: SimContext }).ctx;
});
afterAll(() => app.close());

function at(id: string, placeId: string) {
  const a = agent(id);
  a.state.locationId = placeId;
  a.state.activityKind = "idle";
  ctx.rt(id).travelling = false;
}

describe("arreglar según lo que se sabe", () => {
  it("quien no sabe falla más que quien sabe (y probarlo ya es practicar)", async () => {
    const tries = async (id: string, level: number) => {
      const s = skillState(ctx, id, "repair", 0);
      let ok = 0;
      for (let i = 0; i < 40; i++) {
        s.level = level;
        ctx.world.setSpotState("cafetera", "rota");
        at(id, "cafe_ola");
        await runAction(
          { ctx, agent: agent(id), now: ctx.clock.now() },
          { type: "use_object", objectId: "cafetera", verb: "arreglar" },
        );
        if (ctx.world.spot("cafetera")!.state === "idle") ok++;
      }
      return ok;
    };
    const novice = await tries("leo", 0);
    const expert = await tries("tomas", 1);
    expect(expert).toBeGreaterThan(novice + 8);
    expect(skillState(ctx, "leo", "repair", 0).practiceMinutes).toBeGreaterThan(0);
  });
});

describe("la calidad de lo que se sirve", () => {
  it("el café de quien sabe está bueno: quien está delante lo nota (ánimo y afinidad)", async () => {
    at("mateo", "cafe_ola");
    at("lucia", "cafe_ola");
    skillState(ctx, "mateo", "hospitality", 0).level = 1;
    const before = agent("lucia").state.mood.valence;
    const affinity = (await ctx.deps.social.get("lucia", "mateo"))?.affinity ?? 0;
    const label = serveResult(ctx, agent("mateo"), "cafetera", "preparar un café", ctx.clock.now());
    expect(label).toBe("muy bueno");
    await new Promise((r) => setTimeout(r, 20));
    expect(agent("lucia").state.mood.valence).toBeGreaterThan(before);
    expect((await ctx.deps.social.get("lucia", "mateo"))!.affinity).toBeGreaterThan(affinity);
    const p = ctx.rt("lucia").pending.at(-1);
    expect(p && "text" in p ? p.text : "").toMatch(/El café de Mateo: muy bueno/);
  });
});

describe("resultados de practicar", () => {
  it("un rato seguido haciendo fotos deja una foto, con su calidad (y no más de tres)", () => {
    for (let i = 0; i < 12; i++)
      addPractice(ctx, agent("valentina"), "photography", 15, ctx.clock.now());
    const mine = resultsOf(ctx, "valentina");
    expect(mine.length).toBeGreaterThanOrEqual(1);
    expect(mine.length).toBeLessThanOrEqual(3);
    const item = itemsState(ctx).items.get(mine[0]!)!;
    expect(item.kind).toBe("foto");
    expect(item.name).toMatch(/^una foto de Valentina \((bueno|muy bueno|regular)\)$/);
    expect(skillsState(ctx).results.get(item.id)!.makerId).toBe("valentina");
  });
});

describe("metas de aprender", () => {
  it("skill_level: desde su nivel al crearla; sube con la práctica y se consigue", async () => {
    const life = goalsOf(ctx, "leo", "active").find((g) => g.level === "life")!;
    const g = await createGoal(
      ctx,
      agent("leo"),
      {
        level: "project",
        parentId: life.id,
        text: "Aprender a hacer fotos",
        criterion: { type: "skill_level", skill: "photography", level: 0.3 },
      },
      ctx.clock.now(),
      "t",
    );
    expect(g?.baseline).toBe(levelOf(ctx, "leo", "photography"));
    skillState(ctx, "leo", "photography", 0).level = 0.31;
    measureTick(ctx, ctx.clock.now(), 5);
    expect(g!.status).toBe("achieved");
    // Lo que ya sabe no es una meta; una habilidad que no existe, tampoco.
    const known = await createGoal(
      ctx,
      agent("tomas"),
      {
        level: "project",
        parentId: goalsOf(ctx, "tomas").find((x) => x.level === "life")!.id,
        text: "Aprender a pescar",
        criterion: { type: "skill_level", skill: "fishing", level: 0.5 },
      },
      ctx.clock.now(),
      "t",
    );
    expect(known).toBeNull();
  });

  it("Inés empieza con «aprender a hacer buenas fotos con Valentina»", () => {
    expect(
      goalsOf(ctx, "ines").some(
        (g) => g.criterion.type === "skill_level" && g.criterion.skill === "photography",
      ),
    ).toBe(true);
  });
});
