/** Turnos reactivos: quien recibe una frase contesta enseguida, sin ticks duplicados. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootstrap, type App } from "../bootstrap";
import { loadConfig } from "../config";
import type { SimContext } from "./context";
import { talk } from "./conversations";

let app: App;
let ctx: SimContext;

beforeAll(async () => {
  app = await bootstrap(
    loadConfig({ LLM_PROVIDER: "mock", EMBEDDINGS: "hash", DATABASE_URL: "", SIM_SEED: "7" }),
    () => {},
  );
  ctx = (app.defaultWorld.sim as unknown as { ctx: SimContext }).ctx;
  app.defaultWorld.start();
  // Media mañana del primer día: todos despiertos y con plan.
  await ctx.clock.runUntil(ctx.clock.now() + 4 * 60 + 3);
});
afterAll(() => app.close());

function together(placeId: string, ...ids: string[]) {
  for (const id of ids) {
    const a = ctx.agents.get(id)!;
    a.state.locationId = placeId;
    a.state.targetId = null;
    a.state.movement = null;
    a.state.tile = { ...ctx.world.place(placeId).anchor };
    a.state.activityKind = "idle";
    const rt = ctx.rt(id);
    rt.travelling = false;
    rt.arrival = null;
  }
}

describe("turnos reactivos", () => {
  it("la respuesta llega en ≤ 2 min de juego", async () => {
    together("cafe_ola", "lucia", "mateo");
    const replies: number[] = [];
    const off = app.defaultWorld.sim.onEvent((e) => {
      if (e.kind === "speech" && e.agentId === "mateo") replies.push(e.time);
    });
    const t0 = ctx.clock.now();
    talk(ctx, ctx.agents.get("lucia")!, "mateo", "Oye, Mateo, ¿abrís mañana temprano?");
    await ctx.clock.runUntil(t0 + 2);
    off();
    expect(replies.length).toBe(1);
    expect(replies[0]! - t0).toBeLessThanOrEqual(2);
  });

  it("un único tick pendiente por agente: adelantarlo no lo duplica", async () => {
    together("plaza", "carmen", "hugo");
    let ticks = 0;
    const sim = app.defaultWorld.sim as unknown as {
      agentTick: (a: unknown) => Promise<void>;
    };
    const original = sim.agentTick.bind(sim);
    sim.agentTick = (a: unknown) => {
      if ((a as { id: string }).id === "hugo") ticks++;
      return original(a);
    };
    const t0 = ctx.clock.now();
    // Dos frases seguidas: un solo tick adelantado, y el normal se reprograma tras él.
    ctx.wake("hugo", t0 + 1);
    ctx.wake("hugo", t0 + 1.5);
    await ctx.clock.runUntil(t0 + 1.9);
    expect(ticks).toBe(1);
    await ctx.clock.runUntil(t0 + 1 + ctx.deps.tickMinutes - 0.1);
    expect(ticks).toBe(1);
    await ctx.clock.runUntil(t0 + 1 + ctx.deps.tickMinutes + 0.1);
    expect(ticks).toBe(2);
    sim.agentTick = original;
  });
});
