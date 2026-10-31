/** Normas: casas privadas e invitados, intrusos, horarios (abrir, cerrar) y menores. */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { bootstrap, type App } from "../bootstrap";
import { loadConfig } from "../config";
import { runAction } from "./actions";
import type { SimContext } from "./context";
import { companyState } from "./company";
import { GUEST_MINUTES, grantGuest, mayEnter, normsState, normsTick } from "./norms";

let app: App;
let ctx: SimContext;
/** Día 1 a las 12:00 (todo abierto) y a las 23:00 (cerrado casi todo). */
const NOON = 1440 + 12 * 60;
const NIGHT = 1440 + 23 * 60;

beforeAll(async () => {
  app = await bootstrap(
    loadConfig({ LLM_PROVIDER: "mock", EMBEDDINGS: "hash", DATABASE_URL: "", SIM_SEED: "7" }),
    () => {},
  );
  ctx = (app.defaultWorld.sim as unknown as { ctx: SimContext }).ctx;
});
afterAll(() => app.close());

const agent = (id: string) => ctx.agents.get(id)!;
const act = (id: string, now: number, action: Parameters<typeof runAction>[1]) =>
  runAction({ ctx, agent: agent(id), now }, action);
const texts = (id: string) => ctx.rt(id).pending.flatMap((p) => ("text" in p ? [p.text] : []));
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
const goTo = (placeId: string) =>
  ({
    type: "do_activity",
    activity: "estar",
    activityKind: "idle",
    placeId,
    spotId: null,
  }) as const;

beforeEach(() => {
  normsState(ctx).guests.clear();
  normsState(ctx).openPlaces.clear();
  companyState(ctx).invitations.clear();
  for (const id of ctx.agents.keys()) at(agent(id).seed.homeId, id);
});

describe("casas privadas", () => {
  it("a casa ajena no se va sin invitación; a la propia, sí", async () => {
    at("plaza", "lucia");
    agent("lucia").learnPlace("casa_rio", "seen", 0);
    expect(await act("lucia", NOON, goTo("casa_rio"))).toBe(false);
    expect(texts("lucia").at(-1)).toMatch(/Casa del río es la casa de Hugo y nadie me ha invitado/);
    expect(await act("lucia", NOON, goTo("casa_azul"))).toBe(true);
  });

  it("invitada a casa: puede ir mientras dura el permiso", async () => {
    at("plaza", "hugo", "lucia");
    expect(
      await act("hugo", NOON, {
        type: "invite",
        with: ["lucia"],
        placeId: "casa_rio",
        activity: "escuchar música",
      }),
    ).toBe(true);
    // A casa ajena no se invita.
    expect(
      await act("lucia", NOON, {
        type: "invite",
        with: ["hugo"],
        placeId: "casa_roja",
        activity: "x",
      }),
    ).toBe(false);
    const [v] = [...companyState(ctx).invitations.values()];
    expect(await act("lucia", NOON, { type: "accept_invite", inviteId: v!.id })).toBe(true);
    expect(mayEnter(ctx, agent("lucia"), "casa_rio", NOON + 60)).toBeNull();
    // Ya no le acompaña (eso también le dejaría pasar) y el permiso caduca.
    ctx.rt("lucia").following = null;
    await normsTick(ctx, NOON + GUEST_MINUTES + 1);
    expect(mayEnter(ctx, agent("lucia"), "casa_rio", NOON + GUEST_MINUTES + 1)).toMatch(
      /nadie me ha invitado/,
    );
  });

  it("intruso: quien vive allí lo ve, le sienta mal y el intruso se va", async () => {
    at("casa_rio", "hugo", "lucia");
    const before = (await ctx.deps.social.get("hugo", "lucia"))?.affinity ?? 0;
    const events: string[] = [];
    const off = app.defaultWorld.sim.onEvent((e) => events.push(e.text));
    await normsTick(ctx, NOON);
    off();
    expect(events.some((e) => /🚪 Lucía Ferrer se mete en Casa del río sin permiso/.test(e))).toBe(
      true,
    );
    expect((await ctx.deps.social.get("hugo", "lucia"))!.affinity).toBeLessThan(before);
    expect(ctx.rt("lucia").travelling).toBe(true);
    expect(agent("lucia").state.targetId).toBe("casa_azul");
  });

  it("menores: un menor no se queda en una casa ajena con un adulto, aunque esté invitado", async () => {
    at("casa_rio", "hugo", "leo");
    grantGuest(ctx, "casa_rio", "leo", NOON + 60);
    await normsTick(ctx, NOON);
    expect(ctx.rt("leo").travelling).toBe(true);
    expect(agent("leo").state.targetId).toBe("casa_naranja");
    expect(texts("leo").at(-1)).toMatch(/Me voy a casa/);
  });

  it("no se queda en una casa que no es de ninguno de los dos", async () => {
    at("plaza", "lucia", "mateo");
    expect(
      await act("lucia", NOON, {
        type: "propose_meeting",
        with: ["mateo"],
        placeId: "casa_rio",
        at: "16:00",
        day: "hoy",
        reason: "x",
      }),
    ).toBe(false);
    expect(texts("lucia").at(-1)).toMatch(/no es la casa de ninguno de nosotros/);
  });
});

describe("horarios", () => {
  it("cerrado: no entra quien no trabaja allí", async () => {
    at("plaza", "lucia", "andres");
    expect(mayEnter(ctx, agent("lucia"), "biblioteca", NIGHT)).toMatch(
      /Biblioteca Mnemósine está cerrado a esa hora \(abre de 09:00 a 20:00\)/,
    );
    expect(mayEnter(ctx, agent("andres"), "biblioteca", NIGHT)).toBeNull();
    expect(await act("lucia", NIGHT, goTo("biblioteca"))).toBe(false);
  });

  it("al cerrar, quien no trabaja allí se va; se avisa al abrir y cerrar", async () => {
    at("cafe_ola", "lucia", "mateo");
    const events: string[] = [];
    const off = app.defaultWorld.sim.onEvent((e) => events.push(e.text));
    await normsTick(ctx, 1440 + 21 * 60 + 55);
    await normsTick(ctx, 1440 + 22 * 60);
    off();
    expect(events).toContain("🔒 Mateo Ruiz cierra Café La Ola");
    expect(ctx.rt("lucia").travelling).toBe(true);
    expect(ctx.rt("mateo").travelling).toBe(false);
  });
});
