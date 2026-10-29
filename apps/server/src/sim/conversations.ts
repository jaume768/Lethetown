import { randomUUID } from "node:crypto";
import { updateSocialAfterConversation, type Agent } from "@lethetown/agent-core";
import { facingOf } from "@lethetown/shared";
import { convKey, errorMessage, type Conversation, type SimContext } from "./context";
import { setAction } from "./routines";

/** Conversaciones: turnos, rumores oídos a escondidas y cierre con actualización social. */

export function activeConversationOf(
  ctx: SimContext,
  agentId: string,
): { conv: Conversation; other: string } | undefined {
  for (const conv of ctx.conversations.values()) {
    if (conv.a === agentId) return { conv, other: conv.b };
    if (conv.b === agentId) return { conv, other: conv.a };
  }
  return undefined;
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
  const key = convKey(agent.id, toId);
  let conv = ctx.conversations.get(key);
  if (!conv) {
    conv = { id: randomUUID(), a: agent.id, b: toId, turns: 0, lastAt: now, transcript: [] };
    ctx.conversations.set(key, conv);
  }
  const max = ctx.deps.memory.config.conversation.safetyMaxTurns;
  if (conv.turns >= max) {
    void endConversation(ctx, key, `máximo de seguridad (${max} turnos)`);
    return;
  }
  conv.turns++;
  conv.lastAt = now;
  conv.transcript.push(`${agent.seed.name}: "${utterance}"`);

  const rt = ctx.rt(agent.id);
  rt.overrideUntil = now + 15;
  rt.utteredAt = now;
  agent.state.lastUtterance = utterance;
  agent.state.needs.social = Math.min(1, agent.state.needs.social + 0.08);
  setAction(ctx, agent, `hablando con ${target.seed.name}`, "talk");
  agent.state.facing = facingOf(agent.state.tile, target.state.tile);
  targetRt.inbox.push({
    fromId: agent.id,
    fromName: agent.seed.name,
    text: utterance,
    eventId: conv.id,
  });
  const overhearers = eavesdrop(ctx, agent, target, utterance, conv.id);
  ctx.emit(
    "speech",
    agent.id,
    `${agent.seed.name} → ${target.seed.name}: "${utterance}"`,
    [agent.id, toId, ...overhearers],
    `${conv.id}:${conv.turns}`,
  );
  void agent.rememberOwnSpeech(toId, target.seed.name, utterance, now, conv.id);
}

/** Quien esté cerca puede captar fragmentos (con fuente difusa): así se propagan rumores. */
function eavesdrop(
  ctx: SimContext,
  speaker: Agent,
  target: Agent,
  utterance: string,
  eventId: string,
): string[] {
  const cfg = ctx.deps.memory.config.eavesdrop;
  const rng = ctx.deps.rng;
  const out: string[] = [];
  for (const other of ctx.agents.values()) {
    if (other.id === speaker.id || other.id === target.id) continue;
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
      eventId,
    });
    out.push(other.id);
  }
  return out;
}

export function endIdleConversations(ctx: SimContext, now: number): void {
  const idle = ctx.deps.memory.config.conversation.idleMinutes;
  for (const [key, conv] of ctx.conversations) {
    if (now - conv.lastAt > idle) void endConversation(ctx, key, "se quedaron sin tema");
  }
}

/** Cierra la conversación y actualiza la ficha social de ambos. */
export async function endConversation(ctx: SimContext, key: string, reason: string): Promise<void> {
  const conv = ctx.conversations.get(key);
  if (!conv) return;
  ctx.conversations.delete(key);
  const a = ctx.agents.get(conv.a)!;
  const b = ctx.agents.get(conv.b)!;
  ctx.emit(
    "action",
    null,
    `${a.seed.name} y ${b.seed.name} terminan de hablar (${conv.turns} turnos; ${reason})`,
    [a.id, b.id],
  );
  const now = ctx.clock.now();
  for (const [owner, other] of [
    [a, b],
    [b, a],
  ] as const) {
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
