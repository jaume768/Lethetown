/**
 * Cognición en movimiento (fase 3.6): encuentros por el camino, saliencia, enfriamientos, topes,
 * revalidación de lo que llega tarde, pararse a charlar y retomar el viaje (con y sin
 * replanificar), presencia por proximidad, salir por distancia, menores e interruptores.
 */
import { tileAt } from "@lethetown/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { bootstrap, type App } from "../bootstrap";
import { loadConfig } from "../config";
import { availableActions, isHere, runAction } from "./actions";
import type { SimContext } from "./context";
import { startFollowing } from "./company";
import { activeConversationOf, endConversation, talk } from "./conversations";
import {
  encountersState,
  encountersTick,
  moving,
  resumeTrips,
  stopped,
  walkTurnAvailable,
} from "./encounters";
import { presentWith } from "./perception";
import { travel, travelTogether } from "./routines";
import { registeredSystems } from "./systems";
import { revalidate, walkingTurn } from "./walking";

const ENV = { LLM_PROVIDER: "mock", EMBEDDINGS: "hash", DATABASE_URL: "", SIM_SEED: "7" };

let app: App;
let ctx: SimContext;

beforeAll(async () => {
  app = await bootstrap(loadConfig(ENV), () => {});
  ctx = (app.defaultWorld.sim as unknown as { ctx: SimContext }).ctx;
});
afterAll(() => app.close());

const agent = (id: string) => ctx.agents.get(id)!;
const now = () => ctx.clock.now();

/** Todos quietos y despiertos en su casa (lejos unos de otros), sin nada pendiente. */
function reset() {
  const st = encountersState(ctx);
  st.cooldown.clear();
  st.lastSeen.clear();
  st.walkTurns.clear();
  st.cues.clear();
  st.sightings.clear();
  st.trips.clear();
  st.greeted.clear();
  st.totals = {};
  ctx.conversations.clear();
  for (const a of ctx.agents.values()) {
    a.state.locationId = a.seed.homeId;
    a.state.tile = { ...ctx.world.place(a.seed.homeId).anchor };
    a.state.movement = null;
    a.state.targetId = null;
    a.state.activityKind = "idle";
    a.state.action = "tiempo libre";
    const rt = ctx.rt(a.id);
    rt.travelling = false;
    rt.arrival = null;
    rt.pending = [];
    rt.inbox = [];
    rt.following = null;
  }
}

/** `walker` sale hacia `dest`; `still` espera quieto en la baldosa por la que pasará en `inMin`. */
function crossing(walker: string, still: string, dest: string, inMin = 2) {
  travel(ctx, agent(walker), dest, null, "dar una vuelta", "idle");
  const w = agent(walker);
  const tile = tileAt(w.state, now() + inMin);
  const s = agent(still);
  s.state.tile = tile;
  s.state.locationId = ctx.world.publicPlaceNear(tile).id;
}

beforeEach(reset);

describe("encuentros por el camino", () => {
  it("quien camina ve a quien está en su ruta, aunque no coincidan en una revisión", async () => {
    crossing("hugo", "samuel", "lago");
    // Revisión cuando ya han pasado: la distancia mínima en el intervalo cuenta.
    await ctx.clock.runUntil(now() + 4);
    await encountersTick(ctx, now());
    expect(encountersState(ctx).totals.encounters).toBe(1);
  });

  it("saliencia: un préstamo pendiente le hace pensar (Lucía tiene el libro de Carmen)", async () => {
    crossing("lucia", "carmen", "plaza");
    await encountersTick(ctx, now());
    const cue = encountersState(ctx).cues.get("lucia");
    expect(cue?.withId).toBe("carmen");
    expect(cue?.reasons).toContain("loan");
    expect(encountersState(ctx).sightings.get("lucia")?.withId).toBe("carmen");
  });

  it("enfriamiento: la misma pareja, un encuentro por cada 60 minutos", async () => {
    crossing("hugo", "samuel", "lago");
    await encountersTick(ctx, now());
    await encountersTick(ctx, now());
    expect(encountersState(ctx).totals.encounters).toBe(1);
    expect(encountersState(ctx).cooldown.get("hugo>samuel")).toBe(now() + 60);
  });

  it("si acababan de verse en el mismo sitio, no es un encuentro", async () => {
    crossing("hugo", "samuel", "lago");
    encountersState(ctx).lastSeen.set("hugo|samuel", now() - 5);
    await encountersTick(ctx, now());
    expect(encountersState(ctx).totals.encounters ?? 0).toBe(0);
  });

  it("tope de decisiones en camino por agente y hora", () => {
    const t = now();
    expect(walkTurnAvailable(ctx, "hugo", t, true)).toBe(true);
    expect(walkTurnAvailable(ctx, "hugo", t, true)).toBe(true);
    expect(walkTurnAvailable(ctx, "hugo", t)).toBe(false);
    expect(walkTurnAvailable(ctx, "hugo", t + 60)).toBe(true);
  });

  it("sin cognición en movimiento no hay sistema ni acciones del camino", async () => {
    const off = await bootstrap(loadConfig({ ...ENV, SIM_COGNITION: "off" }), () => {});
    const c = (off.defaultWorld.sim as unknown as { ctx: SimContext }).ctx;
    expect(c.enabled("encounters")).toBe(false);
    expect(c.enabled("associations")).toBe(false);
    expect(registeredSystems().some((s) => s.id === "encounters")).toBe(true);
    const a = c.agents.get("hugo")!;
    c.rt("hugo").travelling = true;
    expect(availableActions({ ctx: c, agent: a, now: c.clock.now() })).not.toContain("greet");
    // El prompt fijo no describe las acciones del camino (es el de antes de la 3.6).
    expect(a.system).not.toContain("stop_to_chat");
    expect(agent("hugo").system).toContain("stop_to_chat");
    await off.close();
  });
});

describe("decisiones que llegan tarde", () => {
  it("si ya se han alejado, se descarta sin «No pude…»", () => {
    travel(ctx, agent("hugo"), "lago", null, "pasear", "idle");
    const d = {
      kind: "act" as const,
      action: { type: "greet" as const, to: "samuel", text: "¡Hola!" },
    };
    expect(revalidate(ctx, agent("hugo"), d).decision).toBeNull();
    expect(ctx.rt("hugo").pending).toEqual([]);
    expect(encountersState(ctx).totals.lateDiscarded).toBe(1);
  });

  it("si aún no se han cruzado (la vio venir), se hará al cruzarse", () => {
    travel(ctx, agent("hugo"), "lago", null, "pasear", "idle");
    encountersState(ctx).sightings.set("hugo", { withId: "samuel", meetAt: now() + 1 });
    const d = {
      kind: "act" as const,
      action: { type: "greet" as const, to: "samuel", text: "¡Hola!" },
    };
    expect(revalidate(ctx, agent("hugo"), d)).toEqual({ decision: d, at: now() + 1 });
    // Al cruzarse ya no se aplaza más: o vale o se descarta.
    expect(revalidate(ctx, agent("hugo"), d, true).decision).toBeNull();
  });

  it("seguir no se revalida", () => {
    expect(revalidate(ctx, agent("hugo"), { kind: "follow_plan" }).decision).toEqual({
      kind: "follow_plan",
    });
  });
});

describe("pararse a charlar", () => {
  async function stopFor(walker: string, other: string, dest: string) {
    crossing(walker, other, dest, 0);
    return runAction(
      { ctx, agent: agent(walker), now: now() },
      {
        type: "stop_to_chat",
        to: other,
        text: "¡Hombre! ¿Qué tal?",
      },
    );
  }

  it("se para en su baldosa, guarda el viaje y abre una charla en el camino", async () => {
    expect(await stopFor("lucia", "carmen", "plaza")).toBe(true);
    expect(stopped(ctx, "lucia")).toBe(true);
    expect(moving(ctx, "lucia")).toBe(false);
    expect(agent("lucia").state.movement).toBeNull();
    const trip = encountersState(ctx).trips.get("lucia");
    expect(trip?.destId).toBe("plaza");
    const conv = activeConversationOf(ctx, "lucia")?.conv;
    expect(conv?.road).toBe(true);
    expect(conv?.members.sort()).toEqual(["carmen", "lucia"]);
    // Presencia por proximidad: cada una está «aquí» para la otra.
    expect(isHere({ ctx, agent: agent("carmen"), now: now() }, "lucia")).toBe(true);
    expect(presentWith(ctx, agent("carmen")).map((p) => p.id)).toContain("lucia");
    // Para el resto del pueblo sigue de camino: no está en el sitio más cercano.
    const other = [...ctx.agents.values()].find((a) => a.id !== "carmen" && a.id !== "lucia")!;
    other.state.locationId = agent("lucia").state.locationId;
    expect(presentWith(ctx, other).map((p) => p.id)).not.toContain("lucia");
  });

  it("al acabar la charla retoma el camino con una ruta nueva", async () => {
    await stopFor("lucia", "carmen", "plaza");
    const conv = activeConversationOf(ctx, "lucia")!.conv;
    await endConversation(ctx, conv.id, "se quedaron sin tema");
    resumeTrips(ctx, now());
    expect(moving(ctx, "lucia")).toBe(true);
    expect(ctx.rt("lucia").arrival?.destId).toBe("plaza");
    expect(encountersState(ctx).trips.has("lucia")).toBe(false);
    expect(encountersState(ctx).totals.resumed).toBe(1);
  });

  it("si el hueco del plan al que iba ya pasó, lo mete en el plan (replan) y va", async () => {
    await stopFor("lucia", "carmen", "plaza");
    const trip = encountersState(ctx).trips.get("lucia")!;
    trip.planStart = -1;
    await endConversation(ctx, activeConversationOf(ctx, "lucia")!.conv.id, "fin");
    resumeTrips(ctx, now());
    expect(encountersState(ctx).totals.replanned).toBe(1);
    expect(agent("lucia").state.plan.some((p) => p.replanned && p.placeId === "plaza")).toBe(true);
    expect(moving(ctx, "lucia")).toBe(true);
  });

  it("quien se aleja más del radio sale de la charla", async () => {
    await stopFor("lucia", "carmen", "plaza");
    agent("carmen").state.tile = { ...ctx.world.place("huerto").anchor };
    await encountersTick(ctx, now());
    expect(activeConversationOf(ctx, "lucia")).toBeUndefined();
    expect(encountersState(ctx).totals.leftByDistance).toBe(1);
  });

  it("no se ofrece a quien ya se ha parado, ni lejos de nadie", async () => {
    travel(ctx, agent("hugo"), "lago", null, "pasear", "idle");
    expect(availableActions({ ctx, agent: agent("hugo"), now: now() })).not.toContain(
      "stop_to_chat",
    );
    await stopFor("lucia", "carmen", "plaza");
    expect(availableActions({ ctx, agent: agent("lucia"), now: now() })).not.toContain(
      "stop_to_chat",
    );
  });

  it("menores: pararse en el camino es público, pero no llevárselo a una casa", async () => {
    expect(await stopFor("hugo", "leo", "plaza")).toBe(true);
    const ok = await runAction(
      { ctx, agent: agent("hugo"), now: now() },
      { type: "invite", with: ["leo"], placeId: agent("hugo").seed.homeId, activity: "merendar" },
    );
    expect(ok).toBe(false);
    expect(JSON.stringify(ctx.rt("hugo").pending)).toMatch(/sitio público/);
  });
});

describe("instantánea del sistema", () => {
  it("guarda y restaura enfriamientos, viajes pendientes y cifras", async () => {
    crossing("lucia", "carmen", "plaza", 0);
    await runAction(
      { ctx, agent: agent("lucia"), now: now() },
      {
        type: "stop_to_chat",
        to: "carmen",
        text: "¡Carmen!",
      },
    );
    const sys = registeredSystems().find((s) => s.id === "encounters")!;
    const saved = sys.snapshot!.save(ctx);
    const parsed = sys.snapshot!.schema.parse(JSON.parse(JSON.stringify(saved)));
    reset();
    sys.snapshot!.restore(ctx, parsed);
    expect(encountersState(ctx).trips.get("lucia")?.destId).toBe("plaza");
    expect(encountersState(ctx).totals.stops).toBe(1);
  });
});

describe("hablar andando con quien acompaña (walkingTalk)", () => {
  it("van juntos: se hablan andando, por proximidad, sin pararse ni saludarse", () => {
    travelTogether(ctx, agent("clara"), [agent("aurora")], "cafe_ola", "tomar algo", "eat");
    startFollowing(ctx, agent("aurora"), "clara", now());
    talk(ctx, agent("clara"), "aurora", "¿Y la abuela de Valentina, qué?");
    const conv = activeConversationOf(ctx, "clara")?.conv;
    expect(conv?.road).toBe(true);
    // Siguen andando (no se ponen «hablando con…»).
    expect(agent("clara").state.activityKind).toBe("walk");
    expect(agent("clara").state.lastUtterance).toContain("abuela");
    // Quien recibe la frase piensa andando: puede contestar (say), no pararse ni saludar.
    const turn = walkingTurn(ctx, agent("aurora"), now())!;
    expect(turn.heard.map((h) => h.fromId)).toEqual(["clara"]);
    expect(turn.actions).toContain("say");
    expect(turn.actions).not.toContain("stop_to_chat");
    expect(turn.actions).not.toContain("greet");
    expect(turn.sections[0]!.lines[0]).toMatch(/^Vas de camino a /);
  });

  it("con walkingTalk apagado, quien camina no puede hablar con su acompañante", async () => {
    const off = await bootstrap(loadConfig({ ...ENV, SIM_COGNITION: "walkingTalk=off" }), () => {});
    const c = (off.defaultWorld.sim as unknown as { ctx: SimContext }).ctx;
    for (const id of ["clara", "aurora"]) c.agents.get(id)!.state.activityKind = "idle";
    travelTogether(
      c,
      c.agents.get("clara")!,
      [c.agents.get("aurora")!],
      "cafe_ola",
      "tomar algo",
      "eat",
    );
    startFollowing(c, c.agents.get("aurora")!, "clara", c.clock.now());
    talk(c, c.agents.get("clara")!, "aurora", "Hola");
    expect(activeConversationOf(c, "clara")).toBeUndefined();
    await off.close();
  });
});

describe("escuchar a escondidas en el camino", () => {
  it("solo quien pasa a ≤ 2 baldosas, con la fidelidad parcial de siempre", async () => {
    crossing("lucia", "carmen", "plaza", 0);
    await runAction(
      { ctx, agent: agent("lucia"), now: now() },
      {
        type: "stop_to_chat",
        to: "carmen",
        text: "¿Sabes lo de la casa en venta?",
      },
    );
    const here = agent("lucia").state.tile;
    const near = agent("hugo");
    near.state.tile = { x: here.x + 1, y: here.y };
    const far = agent("samuel");
    far.state.tile = { x: here.x + 4, y: here.y };
    for (let i = 0; i < 12; i++) {
      talk(
        ctx,
        agent(i % 2 ? "carmen" : "lucia"),
        i % 2 ? "lucia" : "carmen",
        `Una cosa más, ${i}`,
      );
    }
    const heard = (id: string) => ctx.rt(id).pending.filter((p) => p.kind === "overheard");
    expect(heard("hugo").length).toBeGreaterThan(0);
    expect(heard("samuel")).toEqual([]);
    const frag = heard("hugo")[0]!;
    expect(frag.kind === "overheard" && frag.fragment.startsWith("…")).toBe(true);
  });
});

describe("memoria prospectiva al cruzarse", () => {
  it("cruzarse con Carmen le puede recordar a Lucía lo que tenía pendiente con ella", async () => {
    const lucia = agent("lucia");
    await lucia.intend(now(), {
      text: "devolverle el libro a Carmen",
      personId: "carmen",
      importance: 7,
    });
    // Varias ocasiones (cada una con su enfriamiento): con su perfil, alguna se acuerda.
    let reminded = false;
    for (let i = 0; i < 8 && !reminded; i++) {
      reset();
      // Entre una ocasión y otra no se ven (la pista vuelve a «aparecer»).
      await lucia.checkIntentions(now(), 1, []);
      if (!lucia.mind.intentions.some((x) => x.status === "pending")) break;
      crossing("lucia", "carmen", "plaza");
      await encountersTick(ctx, now());
      reminded = Boolean(encountersState(ctx).cues.get("lucia")?.reminder);
    }
    expect(reminded).toBe(true);
    expect(encountersState(ctx).cues.get("lucia")?.reasons).toContain("intention");
  });
});
