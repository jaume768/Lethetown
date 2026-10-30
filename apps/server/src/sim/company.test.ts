/** Ir con otros: invitar, aceptar (ruta compartida), rechazar, acompañar y la regla de menores. */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { bootstrap, type App } from "../bootstrap";
import { loadConfig } from "../config";
import { runAction } from "./actions";
import { companySections, companyState, companyTick, FOLLOW_MINUTES } from "./company";
import type { SimContext } from "./context";

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

const agent = (id: string) => ctx.agents.get(id)!;
const now = () => ctx.clock.now();
const act = (id: string, action: Parameters<typeof runAction>[1]) =>
  runAction({ ctx, agent: agent(id), now: now() }, action);
const lastText = (id: string) => {
  const p = ctx.rt(id).pending.at(-1);
  return p && "text" in p ? p.text : "";
};
function at(placeId: string, ...ids: string[]) {
  for (const id of ids) {
    const a = agent(id);
    a.state.locationId = placeId;
    a.state.targetId = null;
    a.state.tile = { ...ctx.world.place(placeId).anchor };
    a.state.activityKind = "idle";
    const rt = ctx.rt(id);
    rt.travelling = false;
    rt.arrival = null;
    rt.pending = [];
    rt.following = null;
  }
}

beforeEach(() => {
  companyState(ctx).invitations.clear();
  for (const id of ctx.agents.keys()) at(id === "leo" ? "escuela" : "casa_roja", id);
});

describe("ir con otros", () => {
  it("invitar y aceptar: van juntos por la misma ruta y llegan a la vez", async () => {
    at("cafe_ola", "mateo", "lucia");
    expect(
      await act("mateo", {
        type: "invite",
        with: ["lucia"],
        placeId: "plaza",
        activity: "pasear",
      }),
    ).toBe(true);
    const [v] = [...companyState(ctx).invitations.values()];
    expect(companySections(ctx, agent("lucia"))[0]!.lines[0]).toMatch(
      new RegExp(`Invitación ${v!.id}: Mateo Ruiz te invita a ir ahora a Plaza Mayor`),
    );
    expect(await act("lucia", { type: "accept_invite", inviteId: v!.id })).toBe(true);
    const m = agent("mateo").state.movement!;
    const l = agent("lucia").state.movement!;
    expect(l.endTime).toBe(m.endTime);
    expect(l.waypoints.slice(1, -1)).toEqual(m.waypoints.slice(1, -1));
    expect(agent("lucia").state.companionId).toBe("mateo");
    await ctx.clock.runUntil(m.endTime + 0.5);
    expect(agent("lucia").state.locationId).toBe("plaza");
    expect(agent("mateo").state.locationId).toBe("plaza");
    expect(agent("lucia").state.action).toBe("pasear");
  });

  it("rechazar avisa a quien invitó; la invitación caduca", async () => {
    at("cafe_ola", "mateo", "lucia");
    await act("mateo", { type: "invite", with: ["lucia"], placeId: "plaza", activity: "pasear" });
    const [v] = [...companyState(ctx).invitations.values()];
    expect(await act("lucia", { type: "decline_invite", inviteId: v!.id, reason: "llueve" })).toBe(
      true,
    );
    expect(lastText("mateo")).toMatch(/no quiere venir: llueve/);
    await act("mateo", { type: "invite", with: ["lucia"], placeId: "plaza", activity: "pasear" });
    companyTick(ctx, now() + 31);
    expect(companyState(ctx).invitations.size).toBe(0);
  });

  it("un adulto no puede invitar a un menor a una casa ni llevárselo a una", async () => {
    at("plaza", "hugo", "leo");
    expect(
      await act("hugo", { type: "invite", with: ["leo"], placeId: "casa_rio", activity: "tocar" }),
    ).toBe(false);
    expect(lastText("hugo")).toMatch(/solo se puede quedar en un sitio público/);
    // Si Leo acompaña a Hugo y Hugo se va a su casa, Leo no le sigue.
    expect(await act("leo", { type: "follow", who: "hugo" })).toBe(true);
    agent("hugo").state.targetId = "casa_rio";
    companyTick(ctx, now());
    expect(ctx.rt("leo").following).toBeNull();
    expect(lastText("leo")).toMatch(/No seguí a Hugo .* sitio público/);
  });

  it("acompañar: va donde vaya la otra persona y lo deja al cabo de un rato", async () => {
    at("cafe_ola", "lucia", "carmen");
    expect(await act("lucia", { type: "follow", who: "carmen" })).toBe(true);
    agent("carmen").state.targetId = "plaza";
    companyTick(ctx, now());
    expect(agent("lucia").state.targetId).toBe("plaza");
    companyTick(ctx, now() + FOLLOW_MINUTES + 1);
    expect(ctx.rt("lucia").following).toBeNull();
    expect(agent("lucia").state.companionId).toBeNull();
  });
});
