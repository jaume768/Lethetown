/** SIM_SLOWDOWN_IN_CONVERSATION: por encima de x10, el reloj va a x10 mientras se habla. */
import { describe, expect, it } from "vitest";
import { bootstrap } from "../bootstrap";
import { loadConfig } from "../config";
import { liveState } from "../worlds/gateway";
import type { SimContext } from "./context";
import { endConversation, talk } from "./conversations";

const env = { LLM_PROVIDER: "mock", EMBEDDINGS: "hash", DATABASE_URL: "", SIM_SEED: "7" };

describe("frenar en conversación", () => {
  it("a x60, con una conversación abierta va a x10; al acabar, vuelve", async () => {
    const app = await bootstrap(loadConfig({ ...env, SIM_SPEED: "60" }), () => {});
    const w = app.defaultWorld;
    const ctx = (w.sim as unknown as { ctx: SimContext }).ctx;
    for (const id of ["lucia", "mateo"]) ctx.agents.get(id)!.state.locationId = "cafe_ola";
    talk(ctx, ctx.agents.get("lucia")!, "mateo", "¿Qué tal?");
    expect(w.clock.speed).toBe(60);
    expect(w.clock.rate).toBe(10);
    expect(liveState(w)).toMatchObject({ speed: 60, rate: 10 });
    const [id] = [...ctx.conversations.keys()];
    await endConversation(ctx, id!, "prueba");
    expect(w.clock.rate).toBe(60);
    expect(liveState(w).rate).toBeUndefined();
    await app.close();
  });

  it("con SIM_SLOWDOWN_IN_CONVERSATION=off no frena", async () => {
    const app = await bootstrap(
      loadConfig({ ...env, SIM_SPEED: "60", SIM_SLOWDOWN_IN_CONVERSATION: "off" }),
      () => {},
    );
    const w = app.defaultWorld;
    const ctx = (w.sim as unknown as { ctx: SimContext }).ctx;
    for (const id of ["lucia", "mateo"]) ctx.agents.get(id)!.state.locationId = "cafe_ola";
    talk(ctx, ctx.agents.get("lucia")!, "mateo", "¿Qué tal?");
    expect(w.clock.rate).toBe(60);
    await app.close();
  });
});
