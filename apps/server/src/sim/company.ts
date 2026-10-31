/**
 * Ir con otros: invitaciones a ir juntos ahora (`invite`, `accept_invite`, `decline_invite`) y
 * acompañar a alguien un rato (`follow`). Quien acompaña va donde vaya la otra persona; deja de
 * hacerlo al cumplirse el rato, si se va por su cuenta o si el sitio no es apropiado (un adulto y un
 * menor solos, solo en sitios públicos). Ver sim/actions/company.ts.
 */
import type { Agent } from "@lethetown/agent-core";
import type { Invitation } from "@lethetown/shared";
import type { SimContext } from "./context";
import { minorMeetingRule } from "./actions/meetings";
import { travel } from "./routines";
import { grantGuest, GUEST_MINUTES, mayEnter } from "./norms";

/** Minutos que dura una invitación sin respuesta. */
export const INVITE_MINUTES = 30;
/** Minutos que se acompaña a alguien (al seguirle o tras aceptar una invitación). */
export const FOLLOW_MINUTES = 60;

const nameOf = (ctx: SimContext, id: string) => ctx.agents.get(id)?.seed.name ?? id;

/** Estado de ir con otros: invitaciones vivas (unos minutos) y su contador ("v1", "v2"…). */
export interface CompanyState {
  invitations: Map<string, Invitation>;
  seq: number;
}

export const companyState = (ctx: SimContext) =>
  ctx.state<CompanyState>("company", () => ({ invitations: new Map(), seq: 0 }));

/** Empieza a acompañar a alguien. */
export function startFollowing(ctx: SimContext, agent: Agent, who: string, now: number): void {
  const rt = ctx.rt(agent.id);
  rt.following = { who, until: now + FOLLOW_MINUTES };
  rt.overrideUntil = Math.max(rt.overrideUntil, now + FOLLOW_MINUTES);
  agent.state.companionId = who;
}

/** Deja de acompañar (con el motivo como percepción, si lo hay). */
export function stopFollowing(ctx: SimContext, agentId: string, why: string | null): void {
  const rt = ctx.rt(agentId);
  const f = rt.following;
  if (!f) return;
  rt.following = null;
  rt.overrideUntil = Math.min(rt.overrideUntil, ctx.clock.now());
  const agent = ctx.agents.get(agentId);
  if (agent) agent.state.companionId = null;
  const leader = ctx.agents.get(f.who);
  if (leader?.state.companionId === agentId) leader.state.companionId = null;
  if (why) rt.pending.push({ kind: "world", text: why, placeId: null });
}

/** A dónde va (o dónde está) alguien. */
const whereTo = (a: Agent) => a.state.targetId ?? a.state.locationId;

/**
 * Revisión periódica: quien acompaña sigue a la otra persona; las invitaciones caducan. Sin LLM.
 */
export function companyTick(ctx: SimContext, now: number): void {
  const invitations = companyState(ctx).invitations;
  for (const [id, v] of [...invitations]) {
    if (now >= v.expiresAt) invitations.delete(id);
  }
  for (const agent of ctx.agents.values()) {
    const rt = ctx.rt(agent.id);
    const f = rt.following;
    if (!f) continue;
    const leader = ctx.agents.get(f.who);
    if (!leader || now >= f.until) {
      stopFollowing(ctx, agent.id, `Dejé de acompañar a ${nameOf(ctx, f.who)}.`);
      continue;
    }
    if (leader.state.activityKind === "sleep" || agent.state.activityKind === "sleep") {
      stopFollowing(ctx, agent.id, null);
      continue;
    }
    const dest = whereTo(leader);
    if (rt.travelling || whereTo(agent) === dest) continue;
    const blocked =
      minorMeetingRule(ctx, [agent.id, leader.id], dest) ?? mayEnter(ctx, agent, dest, now);
    if (blocked) {
      stopFollowing(ctx, agent.id, `No seguí a ${nameOf(ctx, leader.id)}: ${blocked}.`);
      continue;
    }
    agent.learnPlace(dest, "seen", now);
    // Acompañar a alguien a su casa es ir de invitado.
    if (ctx.world.place(dest).private && leader.seed.homeId === dest) {
      grantGuest(ctx, dest, agent.id, now + GUEST_MINUTES);
    }
    travel(ctx, agent, dest, null, `acompañando a ${nameOf(ctx, leader.id)}`, "idle");
  }
}

/** Sección INVITACIONES del prompt: las que le han hecho y siguen en pie. */
export function companySections(
  ctx: SimContext,
  agent: Agent,
): { title: string; lines: string[] }[] {
  const lines = [...companyState(ctx).invitations.values()]
    .filter((v) => v.responses[agent.id] === "pending")
    .map((v) => {
      const place = ctx.world.places.find((p) => p.id === v.placeId)?.name ?? v.placeId;
      return `Invitación ${v.id}: ${nameOf(ctx, v.fromId)} te invita a ir ahora a ${place} (${v.placeId}) a ${v.activity}. Responde con accept_invite o decline_invite.`;
    });
  const f = ctx.rt(agent.id).following;
  if (f) lines.push(`Estás acompañando a ${nameOf(ctx, f.who)}.`);
  return [{ title: "INVITACIONES", lines }];
}
