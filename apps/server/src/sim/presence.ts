/**
 * Presencia por proximidad (fase 3.6, cognición en movimiento). Sin ella, «estar aquí» es estar
 * en el mismo `locationId`, quieto y despierto. Con ella, además:
 *  - en una conversación en el camino o andando (`Conversation.road`), quien está en ella cuenta
 *    como presente si está a `callRadius` baldosas o menos («a voces»), aunque camine;
 *  - quienes van juntos (invitación aceptada o acompañar) pueden hablarse mientras caminan
 *    (`walkingTalk`).
 * Con la cognición apagada, todo esto devuelve «no» y el mundo funciona como antes.
 */
import type { Agent } from "@lethetown/agent-core";
import { isNear, tileAt, type TilePoint } from "@lethetown/shared";
import type { Conversation, SimContext } from "./context";
import { systemsHold } from "./systems/registry";

/** Baldosa en la que está ahora (también a mitad de camino). */
export function tileNow(ctx: SimContext, agent: Agent): TilePoint {
  return tileAt(agent.state, ctx.clock.now());
}

/** ¿Están a `radius` baldosas o menos ahora mismo? (por defecto, «cerca»). */
export function nearNow(ctx: SimContext, a: Agent, b: Agent, radius?: number): boolean {
  return isNear(tileNow(ctx, a), tileNow(ctx, b), radius ?? ctx.cognition.params.nearRadius);
}

/** ¿Al alcance de la voz? (`callRadius`: saludar, llamar, una charla en el camino). */
export function inCallRange(ctx: SimContext, a: Agent, b: Agent): boolean {
  return nearNow(ctx, a, b, ctx.cognition.params.callRadius);
}

/** Despierto y en el pueblo. */
export function awake(ctx: SimContext, agent: Agent): boolean {
  return agent.state.activityKind !== "sleep" && !systemsHold(ctx, agent.id);
}

/** La conversación (en el camino o andando) en la que está, si es de ese tipo. */
export function roadConversationOf(ctx: SimContext, agentId: string): Conversation | undefined {
  if (!ctx.cognition.enabled) return undefined;
  for (const conv of ctx.conversations.values()) {
    if (conv.members.includes(agentId)) return conv.road ? conv : undefined;
  }
  return undefined;
}

/** ¿Está `otherId` en su conversación en el camino y al alcance de la voz? */
export function nearInRoadConversation(ctx: SimContext, agentId: string, otherId: string): boolean {
  const conv = roadConversationOf(ctx, agentId);
  if (!conv?.members.includes(otherId) || otherId === agentId) return false;
  const a = ctx.agents.get(agentId);
  const b = ctx.agents.get(otherId);
  return Boolean(a && b && awake(ctx, b) && inCallRange(ctx, a, b));
}

/**
 * ¿Van juntos de camino? (los dos caminan y uno acompaña al otro, o comparten ruta tras una
 * invitación) y están cerca. Solo con `walkingTalk`.
 */
export function walkingTogether(ctx: SimContext, a: Agent, b: Agent): boolean {
  if (!ctx.cognition.walkingTalk || a.id === b.id) return false;
  if (!ctx.rt(a.id).travelling || !ctx.rt(b.id).travelling) return false;
  const linked =
    a.state.companionId === b.id ||
    b.state.companionId === a.id ||
    ctx.rt(a.id).following?.who === b.id ||
    ctx.rt(b.id).following?.who === a.id;
  return linked && nearNow(ctx, a, b);
}

/** Presencia clásica: el mismo sitio, quieto y despierto. */
function sameSpot(ctx: SimContext, agent: Agent, other: Agent): boolean {
  return (
    other.id !== agent.id &&
    other.state.locationId === agent.state.locationId &&
    other.state.activityKind !== "sleep" &&
    !ctx.rt(other.id).travelling
  );
}

/**
 * ¿Puede hablarle ahora? (`say`): en el mismo sitio; o, con la cognición en movimiento, en su
 * conversación en el camino y cerca, o yendo juntos.
 */
export function reachable(ctx: SimContext, agent: Agent, other: Agent): boolean {
  if (sameSpot(ctx, agent, other)) return true;
  if (!ctx.cognition.enabled || !awake(ctx, other)) return false;
  return nearInRoadConversation(ctx, agent.id, other.id) || walkingTogether(ctx, agent, other);
}
