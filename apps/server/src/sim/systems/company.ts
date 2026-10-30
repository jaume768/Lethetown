/** Sistema de invitar y acompañar (sim/company.ts y sim/actions/company.ts; mock en agent/mock/company.ts). */
import { Invitation } from "@lethetown/shared";
import { z } from "zod";
import { companySections, companyState, companyTick, stopFollowing } from "../company";
import { registerSystem } from "./registry";
import { REVIEW_MINUTES } from "./types";

/** Acciones con las que uno se va por su cuenta (y deja de acompañar a quien acompañaba). */
const ON_ITS_OWN = new Set(["do_activity", "explore", "invite"]);

registerSystem({
  id: "company",
  description: "Invitaciones a ir juntos ahora y acompañar a alguien un rato.",
  actions: ["invite", "accept_invite", "decline_invite", "follow"],
  snapshot: {
    version: 1,
    schema: z.object({ invitations: z.array(Invitation), seq: z.number().int().nonnegative() }),
    save: (ctx) => {
      const s = companyState(ctx);
      return { invitations: structuredClone([...s.invitations.values()]), seq: s.seq };
    },
    restore: (ctx, data) => {
      const s = companyState(ctx);
      s.invitations.clear();
      for (const v of data.invitations) s.invitations.set(v.id, v);
      s.seq = data.seq;
    },
  },
  tick: { every: REVIEW_MINUTES, run: companyTick },
  promptSections: (ctx, agent) => companySections(ctx, agent).map((s) => ({ ...s, order: 10 })),
  beforeAction: (ctx, agent, action) => {
    if (ON_ITS_OWN.has(action.type)) stopFollowing(ctx, agent.id, null);
  },
  metrics: (ctx) => ({
    invitations: companyState(ctx).invitations.size,
    following: [...ctx.runtime.values()].filter((r) => r.following).length,
  }),
});
