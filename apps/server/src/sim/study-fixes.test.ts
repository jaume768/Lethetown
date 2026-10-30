/** Correcciones que salieron de la partida de estudio de 48 h (estudio/partida-2dias). */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootstrap, type App } from "../bootstrap";
import { loadConfig } from "../config";
import type { SimContext } from "./context";
import { spreadOverDay } from "./memory-routines";

let app: App;
let ctx: SimContext;

beforeAll(async () => {
  app = await bootstrap(
    loadConfig({ LLM_PROVIDER: "mock", EMBEDDINGS: "hash", DATABASE_URL: "", SIM_SEED: "7" }),
    () => {},
  );
  ctx = (app.defaultWorld.sim as unknown as { ctx: SimContext }).ctx;
  app.defaultWorld.start();
  await ctx.clock.runUntil(ctx.clock.now() + 3 * 60);
});
afterAll(() => app.close());

describe("necesidades extremas", () => {
  it("con mucha hambre, sola en casa y sin nada nuevo, se para a pensar y come", async () => {
    const lucia = ctx.agents.get("lucia")!;
    const rt = ctx.rt("lucia");
    const decided: number[] = [];
    app.defaultWorld.llm.onCall((e) => {
      if (e.agentId === "lucia" && e.task === "decide" && e.phase === "start") {
        decided.push(ctx.clock.now());
      }
    });
    lucia.state.needs.hunger = 0.95;
    lucia.state.activityKind = "idle";
    lucia.state.action = "estar en casa";
    rt.pending = [];
    rt.inbox = [];
    await ctx.clock.runUntil(ctx.clock.now() + ctx.deps.tickMinutes + 1);
    expect(decided.length).toBeGreaterThan(0);
    expect(lucia.state.activityKind).toBe("eat");
  });
});

describe("crónica", () => {
  it("reparte las líneas por todo el día (no solo las últimas)", () => {
    const lines = Array.from({ length: 1000 }, (_, i) => `l${i}`);
    const picked = spreadOverDay(lines, 120);
    expect(picked).toHaveLength(120);
    expect(picked[0]).toBe("l0");
    expect(Number(picked.at(-1)!.slice(1))).toBeGreaterThan(980);
    expect(spreadOverDay(["a", "b"], 120)).toEqual(["a", "b"]);
  });
});
