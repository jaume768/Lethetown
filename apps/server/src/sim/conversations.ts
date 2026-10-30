import { randomUUID } from "node:crypto";
import { updateSocialAfterConversation, type Agent } from "@lethetown/agent-core";
import { facingOf } from "@lethetown/shared";
import { errorMessage, type Conversation, type SimContext } from "./context";
import { setAction } from "./routines";
import { learnFromSpeech } from "./places";

/**
 * Conversaciones de dos o más (grupos): turnos, unirse y marcharse, rumores oídos a escondidas
 * y cierre con actualización social. Hablarle a alguien que está en una conversación es unirse a
 * ella; seguir con el plan sin contestar es marcharse (si quedan menos de dos, se acaba).
 */

/** La conversación en la que está (y con quién habla más en ella). */
export function activeConversationOf(
  ctx: SimContext,
  agentId: string,
): { conv: Conversation; other: string; others: string[] } | undefined {
  for (const conv of ctx.conversations.values()) {
    if (!conv.members.includes(agentId)) continue;
    const others = conv.members.filter((m) => m !== agentId);
    return { conv, other: partnersOf(conv, agentId, 1)[0] ?? others[0]!, others };
  }
  return undefined;
}

/** Con quién ha hablado más (en los dos sentidos), de más a menos. */
function partnersOf(conv: Conversation, agentId: string, n: number): string[] {
  const score = new Map<string, number>();
  for (const [pair, count] of Object.entries(conv.pairs)) {
    const [from, to] = pair.split(">") as [string, string];
    if (from === agentId) score.set(to, (score.get(to) ?? 0) + count);
    if (to === agentId) score.set(from, (score.get(from) ?? 0) + count);
  }
  return [...score.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n)
    .map(([id]) => id);
}

/** Nombres de pila de una lista ("Lucía, Mateo y Carmen"). */
function names(ctx: SimContext, ids: string[]): string {
  const list = ids.map((id) => ctx.agents.get(id)?.seed.name.split(" ")[0] ?? id);
  return list.length > 1 ? `${list.slice(0, -1).join(", ")} y ${list.at(-1)}` : (list[0] ?? "");
}

/** Máximo de turnos de seguridad (más cuanto más grande es el grupo). */
function maxTurns(ctx: SimContext, conv: Conversation): number {
  const cfg = ctx.deps.memory.config.conversation;
  return cfg.safetyMaxTurns + cfg.turnsPerExtraMember * Math.max(0, conv.members.length - 2);
}

/**
 * ¿Puede `agentId` hablarle a `targetId` sin pasarse del tamaño máximo de un grupo (unirse al
 * suyo o meterle en el propio)? Si no, el motivo.
 */
export function joinBlocked(ctx: SimContext, agentId: string, targetId: string): string | null {
  const max = ctx.deps.memory.config.conversation.maxMembers;
  const theirs = activeConversationOf(ctx, targetId)?.conv;
  const mine = activeConversationOf(ctx, agentId)?.conv;
  if (theirs && theirs !== mine && theirs.members.length >= max) {
    return `${names(ctx, theirs.members)} ya son muchos hablando`;
  }
  if (!theirs && mine && mine.members.length >= max) return "ya somos muchos hablando";
  return null;
}

/** Entra en una conversación (aviso en el log y para los que ya estaban). */
function join(ctx: SimContext, conv: Conversation, agent: Agent): void {
  const before = [...conv.members];
  conv.members.push(agent.id);
  ctx.emit(
    "action",
    agent.id,
    `👥 ${agent.seed.name} se une a la conversación de ${names(ctx, before)}`,
    conv.members,
    undefined,
    { action: "join_conversation", ok: true },
  );
}

export function talk(ctx: SimContext, agent: Agent, toId: string, utterance: string): void {
  const target = ctx.agents.get(toId);
  const targetRt = ctx.runtime.get(toId);
  if (
    !target ||
    !targetRt ||
    target.state.locationId !== agent.state.locationId ||
    targetRt.travelling
  ) {
    return;
  }
  const now = ctx.clock.now();
  const mine = activeConversationOf(ctx, agent.id)?.conv;
  const theirs = activeConversationOf(ctx, toId)?.conv;
  let conv: Conversation;
  if (theirs && theirs !== mine) {
    // Se une a la conversación de quien le habla (y deja la suya).
    if (joinBlocked(ctx, agent.id, toId)) return;
    if (mine) {
      ctx.deps.track?.(
        leaveConversation(ctx, agent.id, `se fue con ${names(ctx, theirs.members)}`),
      );
    }
    conv = theirs;
    join(ctx, conv, agent);
  } else if (mine && !theirs) {
    // Mete a alguien más en su conversación.
    if (joinBlocked(ctx, agent.id, toId)) return;
    conv = mine;
    join(ctx, conv, target);
  } else if (mine) {
    conv = mine;
  } else {
    conv = {
      id: randomUUID(),
      members: [agent.id, toId],
      turns: 0,
      lastAt: now,
      transcript: [],
      pairs: {},
    };
    ctx.conversations.set(conv.id, conv);
  }
  if (conv.turns >= maxTurns(ctx, conv)) {
    void endConversation(ctx, conv.id, `máximo de seguridad (${maxTurns(ctx, conv)} turnos)`);
    return;
  }
  conv.turns++;
  conv.lastAt = now;
  const group = conv.members.length > 2;
  conv.transcript.push(
    group
      ? `${agent.seed.name} (a ${target.seed.name}): "${utterance}"`
      : `${agent.seed.name}: "${utterance}"`,
  );
  const pair = `${agent.id}>${toId}`;
  conv.pairs[pair] = (conv.pairs[pair] ?? 0) + 1;

  const rt = ctx.rt(agent.id);
  rt.overrideUntil = now + 15;
  rt.utteredAt = now;
  agent.state.lastUtterance = utterance;
  agent.state.needs.social = Math.min(1, agent.state.needs.social + 0.08);
  setAction(
    ctx,
    agent,
    group
      ? `hablando con ${names(
          ctx,
          conv.members.filter((m) => m !== agent.id),
        )}`
      : `hablando con ${target.seed.name}`,
    "talk",
  );
  agent.state.facing = facingOf(agent.state.tile, target.state.tile);
  targetRt.inbox.push({
    fromId: agent.id,
    fromName: agent.seed.name,
    text: utterance,
    eventId: conv.id,
  });
  // El resto del grupo lo oye entero (están en la conversación).
  const rest = conv.members.filter((m) => m !== agent.id && m !== toId);
  for (const m of rest) {
    ctx.rt(m).inbox.push({
      fromId: agent.id,
      fromName: agent.seed.name,
      text: utterance,
      eventId: conv.id,
      toName: target.seed.name,
    });
  }
  // Turno reactivo: quien recibe la frase piensa enseguida (no a su siguiente tick).
  const delay = ctx.deps.replyDelayMinutes ?? 0;
  if (delay > 0) ctx.wake(toId, now + delay);
  const overhearers = eavesdrop(ctx, agent, target, conv, utterance);
  // Si nombra un sitio que quien escucha no conoce, quizá se lo crea y lo aprenda.
  for (const listener of [toId, ...rest]) {
    ctx.deps.track?.(learnFromSpeech(ctx, ctx.agents.get(listener)!, agent, utterance, now));
  }
  ctx.emit(
    "speech",
    agent.id,
    `${agent.seed.name} → ${target.seed.name}: "${utterance}"`,
    [agent.id, toId, ...rest, ...overhearers],
    `${conv.id}:${conv.turns}`,
    rest.length ? { group: rest } : undefined,
  );
  void agent.rememberOwnSpeech(toId, target.seed.name, utterance, now, conv.id);
}

/** Quien esté cerca (y no en la conversación) puede captar fragmentos: así se propagan rumores. */
function eavesdrop(
  ctx: SimContext,
  speaker: Agent,
  target: Agent,
  conv: Conversation,
  utterance: string,
): string[] {
  const cfg = ctx.deps.memory.config.eavesdrop;
  const rng = ctx.deps.rng;
  const out: string[] = [];
  for (const other of ctx.agents.values()) {
    if (conv.members.includes(other.id)) continue;
    const rt = ctx.rt(other.id);
    if (rt.travelling || other.state.locationId !== speaker.state.locationId) continue;
    if (other.state.activityKind === "sleep" || rng() >= cfg.probability) continue;
    const words = utterance.split(/\s+/);
    const keep = Math.max(1, Math.round(words.length * cfg.fragmentRatio));
    const start = Math.floor(rng() * Math.max(1, words.length - keep + 1));
    const recognized = rng() < cfg.recognizeSpeaker;
    rt.pending.push({
      kind: "overheard",
      fromId: recognized ? speaker.id : null,
      fromName: recognized ? speaker.seed.name : "alguien",
      toName: target.seed.name,
      fragment: `…${words.slice(start, start + keep).join(" ")}…`,
      placeId: speaker.state.locationId,
      eventId: conv.id,
    });
    out.push(other.id);
  }
  return out;
}

export function endIdleConversations(ctx: SimContext, now: number): void {
  const idle = ctx.deps.memory.config.conversation.idleMinutes;
  for (const [id, conv] of ctx.conversations) {
    if (now - conv.lastAt > idle) void endConversation(ctx, id, "se quedaron sin tema");
  }
}

/**
 * Se marcha de su conversación: revisa lo que piensa de con quienes más habló. Si quedan menos
 * de dos, la conversación se acaba.
 */
export async function leaveConversation(
  ctx: SimContext,
  agentId: string,
  reason: string,
): Promise<void> {
  const conv = activeConversationOf(ctx, agentId)?.conv;
  if (!conv) return;
  if (conv.members.length <= 2) return endConversation(ctx, conv.id, reason);
  conv.members = conv.members.filter((m) => m !== agentId);
  const agent = ctx.agents.get(agentId)!;
  ctx.emit(
    "action",
    agentId,
    `👋 ${agent.seed.name} deja la conversación con ${names(ctx, conv.members)} (${reason})`,
    [agentId, ...conv.members],
    undefined,
    { action: "leave_conversation", ok: true },
  );
  await updateSocial(ctx, conv, [agentId]);
}

/** Cierra la conversación y actualiza las fichas sociales de quienes siguen en ella. */
export async function endConversation(ctx: SimContext, id: string, reason: string): Promise<void> {
  const conv = ctx.conversations.get(id);
  if (!conv) return;
  ctx.conversations.delete(id);
  ctx.emit(
    "action",
    null,
    `${names(ctx, conv.members)} terminan de hablar (${conv.turns} turnos; ${reason})`,
    [...conv.members],
  );
  await updateSocial(ctx, conv, conv.members);
}

/** Cada uno revisa lo que piensa de con quienes más habló (como mucho `socialPartners`). */
async function updateSocial(ctx: SimContext, conv: Conversation, owners: string[]): Promise<void> {
  const now = ctx.clock.now();
  const n = ctx.deps.memory.config.conversation.socialPartners;
  for (const ownerId of owners) {
    const owner = ctx.agents.get(ownerId);
    if (!owner) continue;
    const partners = partnersOf(conv, ownerId, n);
    // Si no dijo ni le dijeron nada, al menos con quien estaba (conversaciones de dos).
    const others = partners.length
      ? partners
      : conv.members.filter((m) => m !== ownerId).slice(0, 1);
    for (const otherId of others) {
      const other = ctx.agents.get(otherId);
      if (!other) continue;
      try {
        await updateSocialAfterConversation(ctx.deps.llm, ctx.deps.social, {
          owner: owner.owner,
          other: { id: other.id, name: other.seed.name },
          transcript: conv.transcript,
          now,
          guard: ctx.deps.memory.guard,
          eventId: conv.id,
          config: ctx.deps.memory.config.social,
          onIntentions: async (list) => {
            for (const i of list) {
              if (await owner.intend(now, i)) {
                ctx.emit("memory", owner.id, `📝 ${owner.seed.name} se propone ${i.text}`, [
                  owner.id,
                  ...(i.personId ? [i.personId] : []),
                ]);
              }
            }
          },
        });
      } catch (error) {
        ctx.emit("system", owner.id, `⚠ Error en "social": ${errorMessage(error)}`);
      }
    }
  }
}
