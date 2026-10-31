/** Sistema de invitar y acompañar (sim/company.ts y sim/actions/company.ts; mock en agent/mock/company.ts). */
import { Invitation } from "@lethetown/shared";
import { z } from "zod";
import { companySections, companyState, companyTick, stopFollowing } from "../company";
import { formalAction } from "../agreements";
import { registerSystem } from "./registry";
import { REVIEW_MINUTES, type AgreementKind } from "./types";

/** Acciones con las que uno se va por su cuenta (y deja de acompañar a quien acompañaba). */
const ON_ITS_OWN = new Set(["do_activity", "explore", "invite"]);

/**
 * «¿Te vienes a casa?» «Vale»: invitar y aceptar ahora. Aquí no vale quien ya se fue de la
 * charla (es para ir juntos ahora): el manejador pide que estén presentes.
 */
const inviteAgreement: AgreementKind = {
  type: "invite",
  steps: (ctx, a) => [
    {
      actorId: a.from,
      action: () =>
        formalAction({
          type: "invite",
          with: a.to,
          placeId: a.placeId,
          activity: a.what || "pasar un rato",
        }),
    },
    ...a.to.map((id) => ({
      actorId: id,
      action: () => {
        const v = [...companyState(ctx).invitations.values()]
          .filter((x) => x.fromId === a.from && x.placeId === a.placeId)
          .at(-1);
        return v ? formalAction({ type: "accept_invite", inviteId: v.id }) : "no hubo invitación";
      },
    })),
  ],
  covers: (i) => /ir |veni|acompa|invit|casa/i.test(i.text),
};

registerSystem({
  id: "company",
  description: "Invitaciones a ir juntos ahora y acompañar a alguien un rato.",
  actions: ["invite", "accept_invite", "decline_invite", "follow"],
  agreements: [inviteAgreement],
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
