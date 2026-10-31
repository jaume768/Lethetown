/** Invitar a ir juntos, aceptar o rechazar, y acompañar a alguien (ver sim/company.ts). */
import type {
  AcceptInviteAction,
  DeclineInviteAction,
  FollowAction,
  Invitation,
  InviteAction,
} from "@lethetown/shared";
import type { z } from "zod";
import type { SimContext } from "../context";
import { INVITE_MINUTES, companyState, startFollowing } from "../company";
import { learn } from "../places";
import { grantGuest, GUEST_MINUTES, mayEnter } from "../norms";
import { setAction, travel, travelTogether } from "../routines";
import { minorMeetingRule } from "./meetings";
import { registerAction, type ActionContext } from "./registry";

const nameOf = (ctx: SimContext, id: string) => ctx.agents.get(id)?.seed.name ?? id;
const firstOf = (ctx: SimContext, id: string) => nameOf(ctx, id).split(" ")[0]!;

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

const someoneHere = (c: ActionContext) => [...c.ctx.agents.keys()].some((id) => here(c, id));

/** La invitación pendiente para este agente, o el motivo. */
function pendingFor(c: ActionContext, id: string): Invitation | string {
  const v = companyState(c.ctx).invitations.get(id);
  if (!v || v.responses[c.agent.id] === undefined) return `no tengo ninguna invitación "${id}"`;
  if (v.responses[c.agent.id] !== "pending") return "ya respondí a esa invitación";
  if (c.now >= v.expiresAt) return "esa invitación ya ha caducado";
  return v;
}

const hasInvitation = (c: ActionContext) =>
  [...companyState(c.ctx).invitations.values()].some((v) => v.responses[c.agent.id] === "pending");

registerAction<z.infer<typeof InviteAction>>({
  type: "invite",
  available: someoneHere,
  check: (c, a) => {
    const away = a.with.filter((id) => !here(c, id));
    if (away.length) return `${away.map((id) => nameOf(c.ctx, id)).join(" y ")} no está aquí`;
    if (!c.ctx.world.places.some((p) => p.id === a.placeId) || !c.agent.knows(a.placeId)) {
      return `no conozco ningún sitio llamado "${a.placeId}"`;
    }
    if (a.placeId === c.agent.state.locationId) return "ya estamos aquí";
    const place = c.ctx.world.place(a.placeId);
    if (place.private && c.agent.seed.homeId !== place.id) return "solo puedo invitar a mi casa";
    const barred = mayEnter(c.ctx, c.agent, a.placeId, c.now);
    if (barred) return barred;
    return minorMeetingRule(c.ctx, [c.agent.id, ...a.with], a.placeId);
  },
  describe: ({ ctx }, a) =>
    `invitar a ${a.with.map((id) => firstOf(ctx, id)).join(" y ")} a ${ctx.world.places.find((p) => p.id === a.placeId)?.name ?? a.placeId}`,
  execute: ({ ctx, agent, now }, a) => {
    const to = [...new Set(a.with)];
    const v: Invitation = {
      id: `v${++companyState(ctx).seq}`,
      fromId: agent.id,
      to,
      responses: Object.fromEntries(to.map((id) => [id, "pending"] as const)),
      placeId: a.placeId,
      activity: a.activity,
      createdAt: now,
      expiresAt: now + INVITE_MINUTES,
    };
    companyState(ctx).invitations.set(v.id, v);
    const place = ctx.world.place(a.placeId).name;
    // Espera la respuesta aquí un rato (no se va con el plan).
    ctx.rt(agent.id).overrideUntil = now + INVITE_MINUTES;
    setAction(
      ctx,
      agent,
      `esperando a ver si ${to.map((id) => firstOf(ctx, id)).join(" y ")} viene`,
      "idle",
    );
    for (const id of to) {
      ctx.rt(id).pending.push({
        kind: "world",
        text: `${agent.seed.name} me invita a ir ahora a ${place} a ${a.activity} (invitación ${v.id}).`,
        placeId: agent.state.locationId,
      });
    }
    ctx.emit(
      "action",
      agent.id,
      `💌 ${agent.seed.name} invita a ${to.map((id) => firstOf(ctx, id)).join(" y ")} a ${place}: ${a.activity}`,
      [agent.id, ...to],
      undefined,
      { action: "invite", ok: true },
    );
  },
});

registerAction<z.infer<typeof AcceptInviteAction>>({
  type: "accept_invite",
  available: hasInvitation,
  check: (c, a) => {
    const v = pendingFor(c, a.inviteId);
    if (typeof v === "string") return v;
    if (!here(c, v.fromId)) return `${nameOf(c.ctx, v.fromId)} ya no está aquí`;
    return minorMeetingRule(c.ctx, [v.fromId, c.agent.id], v.placeId);
  },
  describe: ({ ctx }, a) => {
    const v = companyState(ctx).invitations.get(a.inviteId);
    return `aceptar la invitación${v ? ` de ${firstOf(ctx, v.fromId)}` : ""}`;
  },
  execute: ({ ctx, agent, now }, a) => {
    const v = companyState(ctx).invitations.get(a.inviteId)!;
    v.responses[agent.id] = "accepted";
    const host = ctx.agents.get(v.fromId)!;
    const place = ctx.world.place(v.placeId);
    learn(ctx, agent, place, "told", now, host);
    // Invitado a casa de quien invita: puede estar allí un rato.
    if (place.private) grantGuest(ctx, place.id, agent.id, now + GUEST_MINUTES);
    // Van juntos: la ruta de quien invita, y quien acepta le acompaña un rato al llegar.
    const activity = v.activity;
    if (host.state.targetId === v.placeId) {
      // Ya iba con otro que aceptó antes: le sigue por su cuenta hasta allí.
      travel(ctx, agent, v.placeId, null, activity, "idle");
    } else {
      travelTogether(ctx, host, [agent], v.placeId, activity, "idle");
    }
    ctx.rt(host.id).overrideUntil = now + 60;
    startFollowing(ctx, agent, host.id, now);
    host.state.companionId = agent.id;
    ctx.rt(host.id).pending.push({
      kind: "world",
      text: `${agent.seed.name} acepta venir conmigo a ${place.name}.`,
      placeId: null,
    });
    ctx.emit(
      "action",
      agent.id,
      `🚶 ${host.seed.name} y ${agent.seed.name} van juntos a ${place.name}`,
      [host.id, agent.id],
      undefined,
      { action: "go_together", ok: true },
    );
  },
});

registerAction<z.infer<typeof DeclineInviteAction>>({
  type: "decline_invite",
  available: hasInvitation,
  check: (c, a) => {
    const v = pendingFor(c, a.inviteId);
    return typeof v === "string" ? v : null;
  },
  describe: (_c, a) => `rechazar la invitación ${a.inviteId}`,
  execute: ({ ctx, agent }, a) => {
    const v = companyState(ctx).invitations.get(a.inviteId)!;
    v.responses[agent.id] = "declined";
    const why = a.reason ? `: ${a.reason}` : "";
    ctx.rt(v.fromId).pending.push({
      kind: "world",
      text: `${agent.seed.name} no quiere venir${why}.`,
      placeId: null,
    });
    ctx.emit(
      "action",
      agent.id,
      `✖ ${agent.seed.name} no acepta la invitación de ${firstOf(ctx, v.fromId)}${why}`,
      [agent.id, v.fromId],
      undefined,
      { action: "decline_invite", ok: true },
    );
  },
});

registerAction<z.infer<typeof FollowAction>>({
  type: "follow",
  available: (c) => someoneHere(c) && !c.ctx.rt(c.agent.id).following,
  check: (c, a) => (here(c, a.who) ? null : `${nameOf(c.ctx, a.who)} no está aquí`),
  describe: ({ ctx }, a) => `acompañar a ${firstOf(ctx, a.who)}`,
  execute: ({ ctx, agent, now }, a) => {
    startFollowing(ctx, agent, a.who, now);
    setAction(ctx, agent, `acompañando a ${nameOf(ctx, a.who)}`, "idle");
    ctx.rt(a.who).pending.push({
      kind: "world",
      text: `${agent.seed.name} se viene conmigo un rato.`,
      placeId: null,
    });
    ctx.emit(
      "action",
      agent.id,
      `👣 ${agent.seed.name} acompaña a ${nameOf(ctx, a.who)}`,
      [agent.id, a.who],
      undefined,
      { action: "follow", ok: true },
    );
  },
});
