/** Sistema de citas (sim/meetings.ts y sim/actions/meetings.ts; mock en agent/mock/meetings.ts). */
import { Commitment } from "@lethetown/shared";
import { z } from "zod";
import {
  agendaLines,
  fixedPlanFor,
  meetingsState,
  meetingsTick,
  rehearseAgenda,
} from "../meetings";
import { registerSystem } from "./registry";
import { REVIEW_MINUTES } from "./types";

registerSystem({
  id: "meetings",
  description: "Citas: proponer, aceptar, acordarse a tiempo, llegar (o tarde) y plantones.",
  actions: ["propose_meeting", "accept_meeting", "decline_meeting", "cancel_meeting"],
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
