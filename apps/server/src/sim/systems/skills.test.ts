/** Sistema `skills`: semillas, práctica por lo que se hace, maestro delante, olvido e instantánea. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootstrap, type App } from "../../bootstrap";
import { loadConfig } from "../../config";
import type { SimContext } from "../context";
import { decayAll, levelOf, skillsLine, skillsState, skillsTick, skillState } from "../skills";
import { restoreSystems, snapshotSystems } from ".";

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

/** Pone a alguien a hacer algo aquí (sin moverse ni dormir). */
function doing(id: string, action: string, placeId: string, spotId: string | null = null) {
  const a = agent(id);
  a.state.locationId = placeId;
  a.state.action = action;
  a.state.activityKind = "work";
  a.state.spotId = spotId;
  ctx.rt(id).travelling = false;
}

describe("sistema skills", () => {
  it("cada vecino empieza con lo de su semilla (y se guarda)", async () => {
    expect(levelOf(ctx, "julian", "baking")).toBe(0.85);
    expect(levelOf(ctx, "tomas", "fishing")).toBe(0.9);
    expect((await app.defaultWorld.skills.listFor("julian")).length).toBe(3);
  });

  it("practica lo que hace: el objeto que usa o las palabras de la actividad", () => {
    for (const a of ctx.agents.values()) doing(a.id, "durmiendo", "casa_" + a.id);
    for (const a of ctx.agents.values()) a.state.activityKind = "sleep";
    doing("ines", "haciendo fotos con carrete", "plaza");
    const before = levelOf(ctx, "ines", "photography");
    skillsTick(ctx, ctx.clock.now(), 60);
    expect(levelOf(ctx, "ines", "photography")).toBeGreaterThan(before);
    doing("marta", "preparando un café", "cafe_ola", "cafetera");
    skillsTick(ctx, ctx.clock.now(), 60);
    expect(levelOf(ctx, "marta", "hospitality")).toBeGreaterThan(0);
  });

  it("con alguien delante que hace lo mismo y lo hace mejor, aprende más deprisa (y de quién)", () => {
    doing("leo", "haciendo fotos con carrete", "parque");
    doing("ines", "haciendo fotos con carrete", "lago");
    const alone0 = levelOf(ctx, "leo", "photography");
    skillsTick(ctx, ctx.clock.now(), 60);
    const alone = levelOf(ctx, "leo", "photography") - alone0;
    doing("valentina", "haciendo fotos con carrete", "parque");
    const with0 = levelOf(ctx, "leo", "photography");
    skillsTick(ctx, ctx.clock.now(), 60);
    expect(levelOf(ctx, "leo", "photography") - with0).toBeGreaterThan(1.5 * alone);
    expect(skillState(ctx, "leo", "photography", 0).learnedFrom).toBe("valentina");
  });

  it("sin práctica se oxida despacio, con su hito en la auditoría", async () => {
    const s = skillState(ctx, "hugo", "music", 0);
    s.lastUsedAt = ctx.clock.now() - 100 * 1440;
    const before = s.level;
    // 60 días la dejaban en 0,69: con la histéresis (baja de «con maestría» por debajo de 0,68)
    // aún no es un hito; 90 días, sí.
    decayAll(ctx, ctx.clock.now(), 90);
    expect(s.level).toBeLessThan(before);
    expect(s.level).toBeGreaterThan(0.5);
    const audit = await ctx.deps.memory.store.audit("hugo", 50);
    expect(audit.some((a) => a.action === "skill" && a.reason.includes("sin practicar"))).toBe(
      true,
    );
  });

  it("en el plan, compacto: lo que se le da bien y lo que está aprendiendo", () => {
    expect(skillsLine(ctx, agent("julian"), ctx.clock.now())).toMatch(
      /^Se te da bien: panadería \[baking\] \(con maestría\)/,
    );
    expect(skillsLine(ctx, agent("leo"), ctx.clock.now())).toMatch(
      /Estás aprendiendo: fotografía \(con Valentina\)/,
    );
  });

  it("la instantánea guarda niveles y quién practica", () => {
    const snap = structuredClone(snapshotSystems(ctx));
    expect(snap.skills!.version).toBe(1);
    const n = skillsState(ctx).skills.size;
    skillsState(ctx).skills.clear();
    restoreSystems(ctx, snap);
    expect(skillsState(ctx).skills.size).toBe(n);
  });
});
