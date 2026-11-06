/** Pensamiento por asociación (fase 3.6): sin LLM, con tope por hora, en la memoria de trabajo. */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { bootstrap, type App } from "../bootstrap";
import { loadConfig } from "../config";
import { associateCue, associationsState, associationsTick } from "./associations";
import type { SimContext } from "./context";

const ENV = { LLM_PROVIDER: "mock", EMBEDDINGS: "hash", DATABASE_URL: "", SIM_SEED: "7" };

let app: App;
let ctx: SimContext;
beforeAll(async () => {
  app = await bootstrap(loadConfig(ENV), () => {});
  ctx = (app.defaultWorld.sim as unknown as { ctx: SimContext }).ctx;
});
afterAll(() => app.close());

const lucia = () => ctx.agents.get("lucia")!;
const now = () => ctx.clock.now();

beforeEach(async () => {
  const st = associationsState(ctx);
  st.perHour.clear();
  st.lastPlace.clear();
  st.lastSpot.clear();
  st.totals = {};
  lucia().workingMemory.replace([]);
  lucia().state.cameToMind = null;
  lucia().state.activityKind = "idle";
  await ctx.deps.memory.remember(
    {
      agentId: "lucia",
      text: "En la plaza, Carmen me contó lo de su hermana y lloramos juntas",
      type: "observation",
      importance: 8,
      emotionalValence: -0.8,
      people: ["carmen"],
      placeId: "plaza",
    },
    now() - 600,
  );
});

describe("asociaciones", () => {
  it("al pasar por un sitio le viene a la cabeza lo que pasó allí (memoria de trabajo)", async () => {
    // Cruza la plaza de oeste a este, de camino a otro sitio.
    const a = lucia();
    a.state.locationId = "tienda";
    a.state.targetId = "mercado";
    a.state.movement = {
      waypoints: [
        { x: 50, y: 48 },
        { x: 72, y: 48 },
      ],
      startTime: now() - 2,
      endTime: now() + 2,
    };
    ctx.rt("lucia").travelling = true;
    const calls = app.defaultWorld.costs.summary().total.calls;
    await associationsTick(ctx, now());
    expect(lucia().workingMemory.render()).toContain("te viene a la cabeza");
    expect(lucia().state.cameToMind?.cue).toBe(ctx.world.place("plaza").name);
    expect(associationsState(ctx).totals.associations).toBe(1);
    // Nunca llama al LLM.
    expect(app.defaultWorld.costs.summary().total.calls).toBe(calls);
    ctx.rt("lucia").travelling = false;
    a.state.movement = null;
  });

  it("importante y negativo: se porta como un recuerdo intrusivo (tiñe el ánimo)", async () => {
    const before = lucia().state.mood.valence;
    await associateCue(ctx, lucia(), { kind: "person", id: "carmen", name: "Carmen Vidal" }, now());
    expect(lucia().state.mood.valence).toBeLessThan(before);
    expect(associationsState(ctx).totals.intrusive).toBe(1);
    expect(lucia().workingMemory.render()).toContain("sin querer");
  });

  it("tope por agente y hora", async () => {
    const max = ctx.cognition.params.maxAssociationsPerHour;
    for (let i = 0; i < max + 2; i++) {
      lucia().workingMemory.replace([]);
      await associateCue(
        ctx,
        lucia(),
        { kind: "person", id: "carmen", name: "Carmen Vidal" },
        now(),
      );
    }
    expect(associationsState(ctx).totals.associations).toBe(max);
  });
});
