/** Conocer el pueblo: lo que conoce cada uno, descubrir al pasar, explorar y que te lo cuenten. */
import { applySocialUpdate } from "@lethetown/agent-core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { bootstrap, type App } from "../bootstrap";
import { loadConfig } from "../config";
import { runAction } from "./actions";
import type { SimContext } from "./context";
import { discoverAlong, learnFromSpeech, nextToExplore } from "./places";

let app: App;
let ctx: SimContext;
const NOW = 9 * 60;

beforeAll(async () => {
  app = await bootstrap(
    loadConfig({ LLM_PROVIDER: "mock", EMBEDDINGS: "hash", DATABASE_URL: "", SIM_SEED: "7" }),
    () => {},
  );
  ctx = (app.defaultWorld.sim as unknown as { ctx: SimContext }).ctx;
});
afterAll(() => app.close());

const agent = (id: string) => ctx.agents.get(id)!;
/** Lo que conocía de partida (deshace lo aprendido en otros tests). */
function forget(id: string) {
  const a = agent(id);
  for (const [p, k] of Object.entries(a.mind.knownPlaces)) {
    if (k.source !== "seed") delete a.mind.knownPlaces[p];
  }
  ctx.rt(id).pending = [];
}
const lastText = (id: string) => {
  const p = ctx.rt(id).pending.at(-1);
  return p && "text" in p ? p.text : "";
};

beforeEach(() => {
  for (const id of ctx.agents.keys()) forget(id);
});

describe("lugares conocidos", () => {
  it("quien vive aquí de siempre conoce lo público y su casa; quien acaba de llegar, poco", () => {
    const lucia = agent("lucia");
    expect(lucia.knows("biblioteca")).toBe(true);
    expect(lucia.knows("casa_azul")).toBe(true);
    expect(lucia.knows("casa_en_venta")).toBe(false);
    const valentina = agent("valentina");
    expect(Object.keys(valentina.mind.knownPlaces).sort()).toEqual([
      "cafe_ola",
      "casa_colina",
      "plaza",
      "tienda",
    ]);
    // El prompt fijo solo lista lo que conoce.
    expect(valentina.system).toContain("- plaza (park, exterior)");
    expect(valentina.system).not.toContain("biblioteca");
  });

  it("no puede ir a un sitio que no sabe dónde está", async () => {
    const ok = await runAction(
      { ctx, agent: agent("valentina"), now: NOW },
      {
        type: "do_activity",
        activity: "leer",
        activityKind: "read",
        placeId: "biblioteca",
        spotId: null,
      },
    );
    expect(ok).toBe(false);
    expect(lastText("valentina")).toMatch(/no sé dónde está "biblioteca"/);
  });

  it("al pasar cerca descubre un sitio: percepción, evento y almacén", async () => {
    const v = agent("valentina");
    const lib = ctx.world.place("biblioteca");
    const events: string[] = [];
    const off = app.defaultWorld.sim.onEvent((e) => events.push(e.text));
    const found = discoverAlong(ctx, v, [{ x: lib.area.x - 2, y: lib.area.y }], "plaza", NOW);
    off();
    expect(found.map((p) => p.id)).toContain("biblioteca");
    expect(v.mind.knownPlaces.biblioteca).toMatchObject({ source: "seen", at: NOW });
    expect(v.discoveredPlaces().some((l) => l.startsWith("- biblioteca"))).toBe(true);
    expect(events).toContain("🧭 Valentina Ríos descubre Biblioteca Mnemósine");
    expect(
      ctx.rt("valentina").pending.some((p) => "text" in p && /Descubrí Biblioteca/.test(p.text)),
    ).toBe(true);
    expect((await ctx.knownPlaces.list("valentina")).map((k) => k.placeId)).toContain("biblioteca");
  });

  it("explorar: el motor la lleva a lo desconocido más cercano y allí lo descubre", async () => {
    const v = agent("valentina");
    v.state.locationId = "plaza";
    v.state.tile = { ...ctx.world.place("plaza").anchor };
    v.state.activityKind = "idle";
    ctx.rt("valentina").travelling = false;
    const dest = nextToExplore(ctx, v)!;
    expect(dest.kind).not.toBe("home");
    expect(
      await runAction({ ctx, agent: v, now: ctx.clock.now() }, { type: "explore", zone: null }),
    ).toBe(true);
    expect(ctx.rt("valentina").travelling).toBe(true);
    await ctx.clock.runUntil(ctx.rt("valentina").arrival!.at);
    expect(v.mind.knownPlaces[dest.id]?.source).toBe("explored");
    expect(v.state.locationId).toBe(dest.id);
  });

  it("se aprende un sitio si te lo cuenta alguien de confianza", async () => {
    const v = agent("valentina");
    const lucia = agent("lucia");
    const learned = await learnFromSpeech(
      ctx,
      v,
      lucia,
      "¿Conoces la Biblioteca Mnemósine? Te encantará.",
      NOW,
    );
    expect(learned.map((p) => p.id)).toEqual(["biblioteca"]);
    expect(v.mind.knownPlaces.biblioteca).toMatchObject({ source: "told", toldBy: "lucia" });
    expect(lastText("valentina")).toMatch(/Lucía .* me habló de Biblioteca Mnemósine/);
  });

  it("si no se fía, no se lo cree", async () => {
    const v = agent("valentina");
    const rafael = agent("rafael");
    await applySocialUpdate(ctx.deps.social, {
      ownerId: "valentina",
      aboutId: "rafael",
      trustDelta: -1,
      now: NOW,
      reason: "test",
    });
    expect(await learnFromSpeech(ctx, v, rafael, "Ve al Huerto comunitario.", NOW)).toEqual([]);
    expect(v.knows("huerto")).toBe(false);
  });

  it("al proponer una cita, quien la recibe aprende dónde es", async () => {
    const v = agent("valentina");
    const lucia = agent("lucia");
    for (const a of [v, lucia]) {
      a.state.locationId = "cafe_ola";
      a.state.activityKind = "idle";
      ctx.rt(a.id).travelling = false;
    }
    expect(
      await runAction(
        { ctx, agent: lucia, now: NOW },
        {
          type: "propose_meeting",
          with: ["valentina"],
          placeId: "biblioteca",
          at: "12:00",
          day: "hoy",
          reason: "enseñarle libros de fotos",
        },
      ),
    ).toBe(true);
    expect(v.mind.knownPlaces.biblioteca).toMatchObject({ source: "told", toldBy: "lucia" });
  });
});
