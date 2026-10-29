/** Citas: proponer, aceptar, reservar el hueco, la regla de menores, plantones y anular. */
import type { Commitment } from "@lethetown/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { bootstrap, type App } from "../bootstrap";
import { loadConfig } from "../config";
import { runAction } from "./actions";
import type { SimContext } from "./context";
import { MEETING_WINDOW, agendaLines, meetingsTick, saveMeeting } from "./meetings";

let app: App;
let ctx: SimContext;
/** 08:00 del día 0. */
const NOW = 8 * 60;

beforeAll(async () => {
  app = await bootstrap(
    loadConfig({ LLM_PROVIDER: "mock", EMBEDDINGS: "hash", DATABASE_URL: "", SIM_SEED: "7" }),
    () => {},
  );
  ctx = (app.defaultWorld.sim as unknown as { ctx: SimContext }).ctx;
});
afterAll(() => app.close());

/** Todos despiertos y quietos en un sitio. */
function place(id: string, placeId: string, kind: "idle" | "talk" = "idle") {
  const a = ctx.agents.get(id)!;
  a.state.locationId = placeId;
  a.state.activityKind = kind;
  ctx.rt(id).travelling = false;
  ctx.rt(id).pending = [];
  return a;
}

beforeEach(() => {
  ctx.meetings.clear();
  for (const id of ctx.agents.keys()) place(id, "casa_roja", "talk");
});

/** Texto de lo último que ha percibido. */
const lastText = (id: string) => {
  const p = ctx.rt(id).pending.at(-1);
  return p && "text" in p ? p.text : "";
};

const act = (id: string, action: Parameters<typeof runAction>[1]) =>
  runAction({ ctx, agent: ctx.agents.get(id)!, now: NOW }, action);

describe("citas", () => {
  it("proponer y aceptar: cita aceptada, agenda y hueco en el plan de los dos", async () => {
    place("lucia", "cafe_ola");
    place("mateo", "cafe_ola");
    expect(
      await act("lucia", {
        type: "propose_meeting",
        with: ["mateo"],
        placeId: "plaza",
        at: "12:00",
        day: "hoy",
        reason: "pasear",
      }),
    ).toBe(true);
    const [m] = [...ctx.meetings.values()];
    expect(m).toMatchObject({
      status: "proposed",
      responses: { lucia: "accepted", mateo: "pending" },
    });
    expect(lastText("mateo")).toMatch(
      /te propone quedar en Plaza Mayor hoy a las 12:00 \(cita c\d+\)/,
    );
    expect(agendaLines(ctx, "mateo", NOW)[0]).toMatch(/Responde con accept_meeting/);
    expect(await act("mateo", { type: "accept_meeting", meetingId: m!.id })).toBe(true);
    expect(m!.status).toBe("accepted");
    for (const id of ["lucia", "mateo"]) {
      expect(ctx.agents.get(id)!.state.plan.some((p) => p.activity.startsWith("cita con"))).toBe(
        true,
      );
    }
    expect(await app.defaultWorld.commitments.get(m!.id)).toMatchObject({ status: "accepted" });
  });

  it("con un menor, solo en un sitio público (o en su propia casa)", async () => {
    place("hugo", "plaza");
    place("leo", "plaza");
    const propose = (placeId: string) =>
      act("hugo", {
        type: "propose_meeting",
        with: ["leo"],
        placeId,
        at: "12:00",
        day: "hoy",
        reason: "música",
      });
    expect(await propose("casa_rio")).toBe(false);
    expect(lastText("hugo")).toMatch(/con Leo solo se puede quedar en un sitio público/);
    expect(await propose("cafe_ola")).toBe(true);
    place("marta", "plaza");
    expect(
      await act("marta", {
        type: "propose_meeting",
        with: ["leo"],
        placeId: "casa_naranja",
        at: "13:00",
        day: "hoy",
        reason: "comer",
      }),
    ).toBe(true);
  });

  it("no se puede quedar con quien no está, a deshoras ni en el pasado", async () => {
    place("lucia", "cafe_ola");
    place("mateo", "cafe_ola");
    const base = {
      type: "propose_meeting" as const,
      placeId: "plaza",
      day: "hoy" as const,
      reason: "x",
    };
    expect(await act("lucia", { ...base, with: ["carmen"], at: "12:00" })).toBe(false);
    expect(await act("lucia", { ...base, with: ["mateo"], at: "23:30" })).toBe(false);
    expect(await act("lucia", { ...base, with: ["mateo"], at: "07:00" })).toBe(false);
  });

  it("plantón: quien esperaba lo percibe y baja su afinidad y su confianza; quien llega, cumple", async () => {
    const at = NOW + 60;
    const m: Commitment = {
      id: "c900",
      organizerId: "lucia",
      participants: ["lucia", "mateo", "carmen"],
      responses: { lucia: "accepted", mateo: "accepted", carmen: "accepted" },
      placeId: "cafe_ola",
      at,
      reason: "café",
      status: "accepted",
      arrivals: {},
      forgot: [],
      intentions: {},
      flags: [],
      createdAt: NOW,
      updatedAt: NOW,
    };
    saveMeeting(ctx, m);
    place("lucia", "cafe_ola");
    place("mateo", "cafe_ola");
    // Carmen está liada hablando en otro sitio: no llegará.
    place("carmen", "casa_roja", "talk");
    const before = (await ctx.deps.social.get("lucia", "carmen"))?.affinity ?? 0;
    for (let t = at - 20; t <= at + MEETING_WINDOW; t += 5) await meetingsTick(ctx, t);
    expect(m.status).toBe("failed");
    expect(Object.keys(m.arrivals).sort()).toEqual(["lucia", "mateo"]);
    const after = await ctx.deps.social.get("lucia", "carmen");
    expect(after!.affinity).toBeLessThan(before);
    expect(
      ctx.rt("lucia").pending.some((p) => "text" in p && /Carmen no vino a la cita/.test(p.text)),
    ).toBe(true);
    expect((await ctx.deps.social.history("lucia", "carmen")).at(-1)?.reason).toMatch(/plantón/);
  });

  it("anular (quien la propuso) la cancela para todos y libera el hueco", async () => {
    place("lucia", "cafe_ola");
    place("mateo", "cafe_ola");
    await act("lucia", {
      type: "propose_meeting",
      with: ["mateo"],
      placeId: "plaza",
      at: "15:00",
      day: "hoy",
      reason: "x",
    });
    const [m] = [...ctx.meetings.values()];
    await act("mateo", { type: "accept_meeting", meetingId: m!.id });
    expect(await act("lucia", { type: "cancel_meeting", meetingId: m!.id, reason: "lluvia" })).toBe(
      true,
    );
    expect(m!.status).toBe("cancelled");
    expect(
      ctx.agents.get("mateo")!.state.plan.some((p) => p.activity === "cita con Lucía: x"),
    ).toBe(false);
    expect(lastText("mateo")).toMatch(/ha anulado la cita/);
  });
});
