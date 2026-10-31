/** Sistema de citas (sim/meetings.ts y sim/actions/meetings.ts; mock en agent/mock/meetings.ts). */
import { Commitment } from "@lethetown/shared";
import { z } from "zod";
import type { SimContext } from "../context";
import {
  agendaLines,
  fixedPlanFor,
  meetingsState,
  meetingsTick,
  rehearseAgenda,
  saveMeeting,
} from "../meetings";
import { absoluteTime } from "../actions/meetings";
import { formalAction } from "../agreements";
import { registerSystem } from "./registry";
import { REVIEW_MINUTES, type AgreementKind, type ResolvedAgreement } from "./types";

/** Dos citas de la misma gente a menos de esto (minutos) son la misma (no se puede estar en dos). */
const SAME_SLOT = 90;

/** La última cita de quien organiza el acuerdo, con esa gente y en ese sitio. */
const latestOf = (ctx: SimContext, a: ResolvedAgreement) =>
  [...meetingsState(ctx).meetings.values()]
    .filter(
      (m) =>
        m.organizerId === a.from &&
        m.placeId === a.placeId &&
        a.people.every((p) => m.participants.includes(p)),
    )
    .at(-1);

/** «Quedamos mañana a las cinco en el café»: proponer (quien lo propuso) y aceptar (los demás). */
const meetingAgreement: AgreementKind = {
  type: "meeting",
  duplicate: (ctx, a) => {
    const at = a.at ? absoluteTime(ctx.clock.now(), a.at, a.day) : null;
    if (at === null) return null;
    const same = [...meetingsState(ctx).meetings.values()].find(
      (m) =>
        (m.status === "proposed" || m.status === "accepted") &&
        a.people.every((p) => m.participants.includes(p)) &&
        Math.abs(m.at - at) <= SAME_SLOT,
    );
    return same ? `ya habían quedado a esa hora (cita ${same.id})` : null;
  },
  steps: (ctx, a) => [
    {
      actorId: a.from,
      action: () =>
        formalAction({
          type: "propose_meeting",
          with: a.to,
          placeId: a.placeId,
          at: a.at,
          day: a.day,
          reason: a.what || "lo que hablamos",
        }),
    },
    ...a.to.map((id) => ({
      actorId: id,
      action: () => {
        const m = latestOf(ctx, a);
        return m ? formalAction({ type: "accept_meeting", meetingId: m.id }) : "no se creó la cita";
      },
    })),
  ],
  // Marcada como acordada hablando (para la agenda, las métricas y el estudio).
  applied: (ctx, a) => {
    const m = latestOf(ctx, a);
    if (m && !m.flags.includes("agreed")) {
      m.flags.push("agreed");
      saveMeeting(ctx, m);
    }
  },
  covers: (i, a) =>
    /qued|cita|ver(me|te|nos)|junt/i.test(i.text) ||
    (a.placeId !== null && i.text.includes(a.placeId)),
};

registerSystem({
  id: "meetings",
  description: "Citas: proponer, aceptar, acordarse a tiempo, llegar (o tarde) y plantones.",
  actions: ["propose_meeting", "accept_meeting", "decline_meeting", "cancel_meeting"],
  agreements: [meetingAgreement],
  snapshot: {
    version: 1,
    schema: z.object({ meetings: z.array(Commitment), seq: z.number().int().nonnegative() }),
    save: (ctx) => {
      const s = meetingsState(ctx);
      return { meetings: structuredClone([...s.meetings.values()]), seq: s.seq };
    },
    restore: (ctx, data) => {
      const s = meetingsState(ctx);
      s.meetings.clear();
      for (const m of data.meetings) s.meetings.set(m.id, m);
      s.seq = data.seq;
    },
  },
  // Primer id libre: lo guardado en la tabla manda si va por delante.
  load: async (ctx) => {
    const s = meetingsState(ctx);
    s.seq = Math.max(s.seq, await ctx.commitments.maxSeq());
  },
  tick: { every: REVIEW_MINUTES, run: meetingsTick },
  promptSections: (ctx, agent, now) => [
    { title: "AGENDA", lines: agendaLines(ctx, agent.id, now), order: 0 },
  ],
  fixedPlan: (ctx, agent, day) => fixedPlanFor(ctx, agent.id, day),
  beforeDecide: rehearseAgenda,
  retention: { table: "commitments", policy: "commitments" },
  metrics: (ctx) => {
    const counts: Record<string, number> = { proposed: 0, accepted: 0, done: 0, failed: 0 };
    for (const m of meetingsState(ctx).meetings.values()) {
      counts[m.status] = (counts[m.status] ?? 0) + 1;
    }
    return counts;
  },
  admin: (ctx) => [...meetingsState(ctx).meetings.values()],
});
