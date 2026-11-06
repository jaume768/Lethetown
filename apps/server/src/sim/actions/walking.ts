/**
 * Por el camino (fase 3.6, sistema `encounters`): saludar al pasar (`greet`) y pararse a charlar
 * (`stop_to_chat`). Ver sim/encounters.ts y sim/walking.ts.
 */
import type { GreetAction, StopToChatAction } from "@lethetown/shared";
import type { z } from "zod";
import { activeConversationOf, joinBlocked, talk } from "../conversations";
import {
  canSee,
  countStat,
  encountersState,
  moving,
  salienceFor,
  sighted,
  standStill,
  stopWalking,
  walkTurnAvailable,
} from "../encounters";
import { awake, inCallRange, tileNow } from "../presence";
import { minorMeetingRule } from "./meetings";
import { registerAction, type ActionContext } from "./registry";

const nameOf = (c: ActionContext, id: string) => c.ctx.agents.get(id)?.seed.name ?? id;

/** ¿Lo tiene al alcance de la voz (o lo ve venir), despierto y a la vista? */
function inSight(c: ActionContext, id: string): boolean {
  const other = c.ctx.agents.get(id);
  return Boolean(
    other &&
    other.id !== c.agent.id &&
    awake(c.ctx, other) &&
    (inCallRange(c.ctx, c.agent, other) || sighted(c.ctx, c.agent.id, id, c.now)) &&
    canSee(c.ctx, c.agent, other),
  );
}

/** Lo de siempre de las dos: a quién, y que siga cerca. */
function checkTarget(c: ActionContext, to: string): string | null {
  const other = c.ctx.agents.get(to);
  if (!other || to === c.agent.id) return `no conozco a "${to}"`;
  if (!awake(c.ctx, other)) return `${other.seed.name} no está para nadie`;
  if (!inSight(c, to) || !inCallRange(c.ctx, c.agent, other)) {
    return `${other.seed.name} ya no está cerca`;
  }
  return null;
}

/** ¿Le acaban de saludar al pasar y quien le saludó sigue cerca? (para devolverlo) */
function greetedBy(c: ActionContext): string | null {
  const g = encountersState(c.ctx).greeted.get(c.agent.id);
  return g && inSight(c, g.from) ? g.from : null;
}

registerAction<z.infer<typeof GreetAction>>({
  type: "greet",
  // Andando, a quien tenga cerca; quieto, solo para devolver un saludo.
  available: (c) =>
    c.ctx.rt(c.agent.id).travelling
      ? [...c.ctx.agents.keys()].some((id) => inSight(c, id))
      : greetedBy(c) !== null,
  check: (c, a) => checkTarget(c, a.to),
  describe: (c, a) => `saludar a ${nameOf(c, a.to)}`,
  execute: async (c, a) => {
    const { ctx, agent, now } = c;
    const st = encountersState(ctx);
    const other = ctx.agents.get(a.to)!;
    const rt = ctx.rt(agent.id);
    const reply = st.greeted.get(agent.id)?.from === a.to;
    if (reply) st.greeted.delete(agent.id);
    rt.utteredAt = now;
    agent.state.lastUtterance = a.text;
    countStat(ctx, "greetings");
    ctx.emit(
      "action",
      agent.id,
      `👋 ${agent.seed.name} ${reply ? "devuelve el saludo a" : "saluda al pasar a"} ${other.seed.name}: «${a.text}»`,
      [agent.id, other.id],
      undefined,
      { action: "greet", ok: true, ...(reply ? { reply: true } : {}) },
    );
    await agent.rememberOwnSpeech(other.id, other.seed.name, a.text, now);
    // Quien lo recibe: si le importa (y puede pensar ahora), lo oye y puede devolverlo; si no,
    // o si era la respuesta a su saludo, solo un recuerdo de poca importancia (sin LLM).
    const importance = ctx.deps.memory.config.encounter.lowImportance;
    const s = reply ? null : await salienceFor(ctx, other, agent, now);
    const canThink = !ctx.rt(other.id).travelling || walkTurnAvailable(ctx, other.id, now);
    if (s?.salient && canThink) {
      st.greeted.set(other.id, { from: agent.id, at: now });
      ctx.rt(other.id).inbox.push({
        fromId: agent.id,
        fromName: agent.seed.name,
        text: a.text,
        eventId: `greet:${agent.id}:${now}`,
        greeting: true,
      });
      ctx.wake(other.id, now + (ctx.deps.replyDelayMinutes || 1));
      return;
    }
    await other.deps.memory.tryRemember(
      {
        agentId: other.id,
        text: reply
          ? `${agent.seed.name} me devolvió el saludo: "${a.text}"`
          : `${agent.seed.name} me saludó al pasar: "${a.text}"`,
        type: "observation",
        importance,
        emotionalValence: 0.1,
        people: [agent.id],
        placeId: ctx.world.publicPlaceNear(tileNow(ctx, other)).id,
      },
      now,
    );
  },
});

registerAction<z.infer<typeof StopToChatAction>>({
  type: "stop_to_chat",
  available: (c) =>
    c.ctx.cognition.stopToChat &&
    moving(c.ctx, c.agent.id) &&
    [...c.ctx.agents.keys()].some((id) => inSight(c, id)),
  check: (c, a) => {
    if (!c.ctx.cognition.stopToChat) return "eso no se puede hacer en este pueblo";
    if (!moving(c.ctx, c.agent.id)) return "no voy de camino";
    const far = checkTarget(c, a.to);
    if (far) return far;
    // Pararse en el camino es un sitio público; las reglas de menores, igual que siempre.
    const place = c.ctx.world.publicPlaceNear(tileNow(c.ctx, c.agent)).id;
    return (
      minorMeetingRule(c.ctx, [c.agent.id, a.to], place) ?? joinBlocked(c.ctx, c.agent.id, a.to)
    );
  },
  describe: (c, a) => `pararme a charlar con ${nameOf(c, a.to)}`,
  execute: (c, a) => {
    const { ctx, agent, now } = c;
    const other = ctx.agents.get(a.to)!;
    stopWalking(ctx, agent, now);
    countStat(ctx, "stops");
    ctx.emit(
      "action",
      agent.id,
      `🛑 ${agent.seed.name} se para a charlar con ${other.seed.name} en el camino`,
      [agent.id, other.id],
      undefined,
      { action: "stop_to_chat", ok: true },
    );
    talk(ctx, agent, a.to, a.text, { road: true });
    if (!activeConversationOf(ctx, agent.id)) standStill(ctx, agent);
  },
});
