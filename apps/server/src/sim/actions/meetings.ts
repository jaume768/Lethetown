/** Acciones de citas: proponer, aceptar, rechazar y anular (ver sim/meetings.ts). */
import { applySocialUpdate, parseClock } from "@lethetown/agent-core";
import {
  seedIsMinor,
  type AcceptMeetingAction,
  type CancelMeetingAction,
  type Commitment,
  type DeclineMeetingAction,
  type ProposeMeetingAction,
} from "@lethetown/shared";
import type { z } from "zod";
import type { SimContext } from "../context";
import {
  acceptedOf,
  newMeetingId,
  openMeetingsOf,
  releaseSlot,
  reserveSlot,
  saveMeeting,
  whenText,
} from "../meetings";
import { learn } from "../places";
import { registerAction, type ActionContext } from "./registry";

/** Citas abiertas que puede tener alguien a la vez (para que no llene la agenda). */
const MAX_OPEN = 3;
/** Antelación mínima (minutos de juego) para proponer una cita. */
const MIN_NOTICE = 30;
/** Horas en que se puede quedar (de 07:00 a 22:00, cuando no duermen). */
const DAY_START = 7 * 60;
const DAY_END = 22 * 60;

const nameOf = (ctx: SimContext, id: string) => ctx.agents.get(id)?.seed.name ?? id;
const firstOf = (ctx: SimContext, id: string) => nameOf(ctx, id).split(" ")[0]!;
const placeOf = (ctx: SimContext, id: string) => ctx.world.places.find((p) => p.id === id);

/** ¿Está aquí, despierto y quieto? */
function here(c: ActionContext, id: string): boolean {
  const other = c.ctx.agents.get(id);
  return Boolean(
    other &&
    id !== c.agent.id &&
    other.state.locationId === c.agent.state.locationId &&
    other.state.activityKind !== "sleep" &&
    !c.ctx.rt(id).travelling,
  );
}

/** Minuto absoluto de "HH:MM" hoy o mañana. */
function absoluteTime(now: number, at: string, day: "hoy" | "mañana"): number | null {
  const minute = parseClock(at);
  if (minute === null) return null;
  return (Math.floor(now / 1440) + (day === "mañana" ? 1 : 0)) * 1440 + minute;
}

/**
 * Protección de menores: si en la cita hay un menor y algún adulto, solo en un sitio público
 * (o en la casa del propio menor, con su familia). Devuelve el motivo si no se puede.
 */
export function minorMeetingRule(
  ctx: SimContext,
  participants: string[],
  placeId: string,
): string | null {
  const seeds = participants.map((p) => ctx.agents.get(p)?.seed).filter((s) => s !== undefined);
  const minors = seeds.filter(seedIsMinor);
  if (!minors.length || minors.length === seeds.length) return null;
  const place = placeOf(ctx, placeId);
  if (place && place.kind !== "home") return null;
  if (minors.every((m) => m.homeId === placeId)) return null;
  return `con ${minors.map((m) => m.name.split(" ")[0]).join(" y ")} solo se puede quedar en un sitio público`;
}

registerAction<z.infer<typeof ProposeMeetingAction>>({
  type: "propose_meeting",
  available: (c) => [...c.ctx.agents.keys()].some((id) => here(c, id)),
  check: (c, a) => {
    const { ctx, agent, now } = c;
    const away = a.with.filter((id) => !here(c, id));
    if (away.length) return `${away.map((id) => nameOf(ctx, id)).join(" y ")} no está aquí`;
    if (!placeOf(ctx, a.placeId) || !agent.knows(a.placeId)) {
      return `no conozco ningún sitio llamado "${a.placeId}"`;
    }
    const at = absoluteTime(now, a.at, a.day);
    if (at === null) return `"${a.at}" no es una hora`;
    if (at < now + MIN_NOTICE) return "esa hora ya ha pasado o es demasiado pronto";
    const minute = at % 1440;
    if (minute < DAY_START || minute >= DAY_END) return "a esas horas estaremos durmiendo";
    if (openMeetingsOf(ctx, agent.id).length >= MAX_OPEN) return "ya tengo demasiadas citas";
    return minorMeetingRule(ctx, [agent.id, ...a.with], a.placeId);
  },
  describe: ({ ctx }, a) =>
    `quedar con ${a.with.map((id) => firstOf(ctx, id)).join(" y ")} en ${placeOf(ctx, a.placeId)?.name ?? a.placeId}`,
  execute: async ({ ctx, agent, now }, a) => {
    const at = absoluteTime(now, a.at, a.day)!;
    const participants = [agent.id, ...new Set(a.with)];
    const where = placeOf(ctx, a.placeId)!.name;
    const meeting: Commitment = {
      id: newMeetingId(ctx),
      organizerId: agent.id,
      participants,
      responses: Object.fromEntries(
        participants.map((p) => [p, p === agent.id ? "accepted" : "pending"] as const),
      ),
      placeId: a.placeId,
      at,
      reason: a.reason,
      status: "proposed",
      arrivals: {},
      forgot: [],
      intentions: {},
      flags: [],
      createdAt: now,
      updatedAt: now,
    };
    const others = a.with.map((id) => firstOf(ctx, id)).join(" y ");
    const id = await agent.intend(now, {
      text: `ir a la cita con ${others} en ${where} (${a.reason})`,
    });
    if (id) meeting.intentions[agent.id] = id;
    saveMeeting(ctx, meeting);
    ctx.emit(
      "action",
      agent.id,
      `📅 ${agent.seed.name} propone a ${others} quedar en ${where} ${whenText(at, now)}: ${a.reason}`,
      participants,
      undefined,
      { action: "propose_meeting", ok: true },
    );
    for (const p of a.with) {
      // Quien la propone le dice dónde es (si no lo conocía, ya lo sabe).
      const other = ctx.agents.get(p);
      if (other) learn(ctx, other, placeOf(ctx, a.placeId)!, "told", now, agent);
      ctx.rt(p).pending.push({
        kind: "world",
        text: `${agent.seed.name} te propone quedar en ${where} ${whenText(at, now)} (cita ${meeting.id}): ${a.reason}.`,
        placeId: null,
      });
    }
  },
});

/** La cita en la que está y en qué estado. */
function meetingFor(c: ActionContext, id: string): Commitment | string {
  const m = c.ctx.meetings.get(id);
  if (!m || !m.participants.includes(c.agent.id)) return `no tengo ninguna cita "${id}"`;
  if (m.status !== "proposed" && m.status !== "accepted") return "esa cita ya no sigue en pie";
  return m;
}

const hasPending = (c: ActionContext) =>
  openMeetingsOf(c.ctx, c.agent.id).some((m) => m.responses[c.agent.id] === "pending");

registerAction<z.infer<typeof AcceptMeetingAction>>({
  type: "accept_meeting",
  available: hasPending,
  check: (c, a) => {
    const m = meetingFor(c, a.meetingId);
    if (typeof m === "string") return m;
    return m.responses[c.agent.id] === "pending" ? null : "ya respondí a esa cita";
  },
  describe: ({ ctx }, a) =>
    `aceptar la cita ${a.meetingId}${ctx.meetings.get(a.meetingId) ? ` con ${firstOf(ctx, ctx.meetings.get(a.meetingId)!.organizerId)}` : ""}`,
  execute: async ({ ctx, agent, now }, a) => {
    const m = ctx.meetings.get(a.meetingId)!;
    const firstAcceptance = m.status === "proposed";
    m.responses[agent.id] = "accepted";
    m.status = "accepted";
    const where = placeOf(ctx, m.placeId)?.name ?? m.placeId;
    const others = m.participants.filter((p) => p !== agent.id).map((p) => firstOf(ctx, p));
    const id = await agent.intend(now, {
      text: `ir a la cita con ${others.join(" y ")} en ${where} (${m.reason})`,
    });
    if (id) m.intentions[agent.id] = id;
    // El hueco en el plan: el suyo y, la primera vez que alguien acepta, el de quien la propuso.
    reserveSlot(ctx, agent, m, now);
    const organizer = ctx.agents.get(m.organizerId);
    if (firstAcceptance && organizer) reserveSlot(ctx, organizer, m, now);
    saveMeeting(ctx, m);
    ctx.emit(
      "action",
      agent.id,
      `✔ ${agent.seed.name} acepta quedar con ${others.join(" y ")} en ${where} ${whenText(m.at, now)}`,
      m.participants,
      undefined,
      { action: "accept_meeting", ok: true },
    );
    ctx.rt(m.organizerId).pending.push({
      kind: "world",
      text: `${agent.seed.name} acepta la cita ${m.id} en ${where} ${whenText(m.at, now)}.`,
      placeId: null,
    });
  },
});

registerAction<z.infer<typeof DeclineMeetingAction>>({
  type: "decline_meeting",
  available: hasPending,
  check: (c, a) => {
    const m = meetingFor(c, a.meetingId);
    if (typeof m === "string") return m;
    return m.responses[c.agent.id] === "pending" ? null : "ya respondí a esa cita";
  },
  describe: (_c, a) => `rechazar la cita ${a.meetingId}`,
  execute: ({ ctx, agent }, a) => {
    const m = ctx.meetings.get(a.meetingId)!;
    m.responses[agent.id] = "declined";
    // Si ya nadie más que quien la propuso va a ir, se anula.
    if (acceptedOf(m).length < 2 && !m.participants.some((p) => m.responses[p] === "pending")) {
      m.status = "cancelled";
    }
    saveMeeting(ctx, m);
    const why = a.reason ? `: ${a.reason}` : "";
    ctx.emit(
      "action",
      agent.id,
      `✖ ${agent.seed.name} no quiere quedar con ${firstOf(ctx, m.organizerId)}${why}`,
      m.participants,
      undefined,
      { action: "decline_meeting", ok: true },
    );
    ctx.rt(m.organizerId).pending.push({
      kind: "world",
      text: `${agent.seed.name} no puede o no quiere ir a la cita ${m.id}${why}.`,
      placeId: null,
    });
  },
});

registerAction<z.infer<typeof CancelMeetingAction>>({
  type: "cancel_meeting",
  available: (c) =>
    openMeetingsOf(c.ctx, c.agent.id).some((m) => m.responses[c.agent.id] === "accepted"),
  check: (c, a) => {
    const m = meetingFor(c, a.meetingId);
    if (typeof m === "string") return m;
    return m.responses[c.agent.id] === "accepted" ? null : "no he quedado en ir a esa cita";
  },
  describe: (_c, a) => `anular la cita ${a.meetingId}`,
  execute: async ({ ctx, agent, now }, a) => {
    const m = ctx.meetings.get(a.meetingId)!;
    const organizer = m.organizerId === agent.id;
    m.responses[agent.id] = "declined";
    releaseSlot(ctx, agent, m);
    if (organizer || acceptedOf(m).length < 2) {
      m.status = "cancelled";
      for (const p of acceptedOf(m)) {
        const other = ctx.agents.get(p);
        if (other) releaseSlot(ctx, other, m);
      }
    }
    saveMeeting(ctx, m);
    const why = a.reason ? `: ${a.reason}` : "";
    const where = placeOf(ctx, m.placeId)?.name ?? m.placeId;
    ctx.emit(
      "action",
      agent.id,
      `🚫 ${agent.seed.name} anula la cita en ${where}${why}`,
      m.participants,
      undefined,
      { action: "cancel_meeting", ok: true },
    );
    for (const p of m.participants.filter((x) => x !== agent.id)) {
      ctx.rt(p).pending.push({
        kind: "world",
        text: `${agent.seed.name} ha anulado la cita ${m.id} en ${where}${why}.`,
        placeId: null,
      });
      // Anular a última hora molesta un poco.
      if (m.at - now < 180) {
        await applySocialUpdate(ctx.deps.social, {
          ownerId: p,
          aboutId: agent.id,
          affinityDelta: -0.03,
          now,
          reason: `anuló a última hora la cita en ${where}`,
          config: ctx.deps.memory.config.social,
        });
      }
    }
  },
});
