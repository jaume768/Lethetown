/**
 * Practicar, enseñar y aprender, ayudar y enseñar lo hecho (sistema `skills`, ver sim/skills.ts).
 * Enseñar a un menor o ayudarle: solo en un sitio público (la escuela incluida) o en su casa con
 * su familia (`teachingRule`).
 */
import { applySocialUpdate, skillDef } from "@lethetown/agent-core";
import {
  seedIsMinor,
  type AcceptTeachingAction,
  type AskToLearnAction,
  type DeclineTeachingAction,
  type HelpAction,
  type PracticeAction,
  type ShowResultAction,
  type TeachAction,
} from "@lethetown/shared";
import type { z } from "zod";
import type { SimContext } from "../context";
import { itemsState, saveItem } from "../items";
import { mayEnter } from "../norms";
import { goOrDo, setAction } from "../routines";
import {
  labelOf,
  levelOf,
  mastersHere,
  mayRepeatSession,
  pendingSession,
  practiceNow,
  proposeSession,
  resultsOf,
  sessionsAwaiting,
  skillLabel,
  skillState,
  skillsCfg,
  skillsState,
  startSession,
  tasteResult,
  SESSION_ANSWER_MINUTES,
} from "../skills";
import { minorMeetingRule } from "./meetings";
import { isHere, registerAction, type ActionContext } from "./registry";

const nameOf = (ctx: SimContext, id: string) => ctx.agents.get(id)?.seed.name ?? id;
const firstOf = (ctx: SimContext, id: string) => nameOf(ctx, id).split(" ")[0]!;
const someoneHere = (c: ActionContext) => [...c.ctx.agents.keys()].some((id) => isHere(c, id));

/**
 * Con un menor de por medio: un sitio público (también la escuela) o su casa, y en su casa solo
 * si el adulto es de la familia o hay alguien de la familia (un adulto que vive allí).
 */
export function teachingRule(ctx: SimContext, people: string[], placeId: string): string | null {
  const base = minorMeetingRule(ctx, people, placeId);
  if (base) return base;
  const seeds = people.map((p) => ctx.agents.get(p)?.seed).filter((s) => s !== undefined);
  const minors = seeds.filter(seedIsMinor);
  const adults = seeds.filter((s) => !seedIsMinor(s));
  if (!minors.length || !adults.length) return null;
  if (!minors.some((m) => m.homeId === placeId)) return null;
  const family = (adultId: string) =>
    adultId === placeId ||
    ctx.agents.get(adultId)?.seed.homeId === placeId ||
    minors.some((m) => m.relationships.some((r) => r.with === adultId && r.bond === "family"));
  if (adults.every((a) => family(a.id))) return null;
  const relative = [...ctx.agents.values()].some(
    (a) => !seedIsMinor(a.seed) && a.seed.homeId === placeId && a.state.locationId === placeId,
  );
  return relative
    ? null
    : `con ${minors.map((m) => m.name.split(" ")[0]).join(" y ")}, en su casa solo con su familia delante`;
}

function knownSkill(ctx: SimContext, id: string): string | null {
  return skillDef(skillsCfg(ctx), id) ? null : `no sé qué es «${id}»`;
}

registerAction<z.infer<typeof PracticeAction>>({
  type: "practice",
  // Solo con tiempo libre (cada acción ofrecida cuesta tokens en cada decisión).
  available: (c) =>
    skillsCfg(c.ctx).enabled &&
    !c.ctx.rt(c.agent.id).travelling &&
    (!c.agent.currentPlanItem(c.now) || c.agent.state.action === "tiempo libre") &&
    !practiceNow(c.ctx, c.agent, c.now),
  check: ({ ctx, agent, now }, a) => {
    const unknown = knownSkill(ctx, a.skill);
    if (unknown) return unknown;
    const placeId = a.placeId ?? agent.state.locationId;
    if (!ctx.world.has(placeId) || !agent.knows(placeId)) return `no conozco "${placeId}"`;
    if (a.spotId && ctx.world.spot(a.spotId)?.placeId !== placeId) {
      return `en ${ctx.world.place(placeId).name} no hay ningún "${a.spotId}"`;
    }
    return placeId === agent.state.locationId ? null : mayEnter(ctx, agent, placeId, now);
  },
  describe: ({ ctx }, a) => `practicar ${skillLabel(ctx, a.skill)}`,
  execute: ({ ctx, agent, now }, a) => {
    const def = skillDef(skillsCfg(ctx), a.skill)!;
    const placeId = a.placeId ?? agent.state.locationId;
    // El objeto con el que se practica (el horno, la cafetera), si lo hay en ese sitio.
    const spotId =
      a.spotId ??
      ctx.world.place(placeId).objects.find((o) => def.objects.some((t) => o.id.startsWith(t)))
        ?.id ??
      null;
    const minutes = skillsCfg(ctx).sessionMinutes;
    skillsState(ctx).practicing.set(agent.id, { skill: a.skill, until: now + minutes });
    ctx.rt(agent.id).overrideUntil = now + minutes;
    goOrDo(ctx, agent, placeId, spotId, `practicar ${def.label}`, "work");
    ctx.emit(
      "action",
      agent.id,
      `🎯 ${agent.seed.name} se pone a practicar ${def.label} (${labelOf(skillState(ctx, agent.id, a.skill, now))})`,
      [agent.id],
      undefined,
      { action: "practice", ok: true },
    );
  },
});

/** Común a pedir y ofrecer: está aquí, la habilidad existe, el que enseña sabe y los menores. */
function checkTeaching(
  c: ActionContext,
  who: string,
  skill: string,
  teacherId: string,
  learnerId: string,
): string | null {
  const { ctx, agent } = c;
  if (!isHere(c, who)) return `${nameOf(ctx, who)} no está aquí`;
  const unknown = knownSkill(ctx, skill);
  if (unknown) return unknown;
  const cfg = skillsCfg(ctx);
  const t = levelOf(ctx, teacherId, skill);
  if (t < cfg.promptMinLevel) {
    return teacherId === agent.id
      ? `no sé lo bastante de ${skillLabel(ctx, skill)} para enseñarlo`
      : `${firstOf(ctx, teacherId)} no sabe lo bastante de ${skillLabel(ctx, skill)}`;
  }
  if (t - levelOf(ctx, learnerId, skill) < cfg.masterGap) {
    return `${firstOf(ctx, learnerId === agent.id ? teacherId : learnerId)} y yo sabemos más o menos lo mismo de eso`;
  }
  if (sessionsAwaiting(ctx, who, c.now).some((v) => v.proposedBy === agent.id)) {
    return `ya le he propuesto algo a ${firstOf(ctx, who)}`;
  }
  if (!mayRepeatSession(ctx, teacherId, learnerId, skill, c.now)) {
    return `${firstOf(ctx, who)} y yo ya hemos tenido hoy bastantes sesiones de ${skillLabel(ctx, skill)}`;
  }
  return teachingRule(ctx, [teacherId, learnerId], agent.state.locationId);
}

function propose(
  c: ActionContext,
  who: string,
  skill: string,
  teacherId: string,
  learnerId: string,
) {
  const { ctx, agent, now } = c;
  const v = proposeSession(
    ctx,
    { teacherId, learnerId, skill, proposedBy: agent.id, placeId: agent.state.locationId },
    now,
  );
  const what = skillLabel(ctx, skill);
  ctx.rt(agent.id).overrideUntil = now + SESSION_ANSWER_MINUTES;
  setAction(ctx, agent, `esperando a ver si ${firstOf(ctx, who)} quiere`, "idle");
  const asking = learnerId === agent.id;
  ctx.rt(who).pending.push({
    kind: "world",
    text: asking
      ? `${agent.seed.name} me pide que le enseñe ${what} (sesión ${v.id}).`
      : `${agent.seed.name} se ofrece a enseñarme ${what} (sesión ${v.id}).`,
    placeId: agent.state.locationId,
  });
  ctx.emit(
    "action",
    agent.id,
    asking
      ? `🙋 ${agent.seed.name} le pide a ${firstOf(ctx, who)} que le enseñe ${what}`
      : `🧑‍🏫 ${agent.seed.name} se ofrece a enseñarle ${what} a ${firstOf(ctx, who)}`,
    [agent.id, who],
    undefined,
    { action: asking ? "ask_to_learn" : "teach", ok: true },
  );
}

/** ¿Hay aquí alguien a quien pueda enseñarle algo que sé (le saco ventaja)? */
function canTeachHere(c: ActionContext): boolean {
  const cfg = skillsCfg(c.ctx);
  const mine = [...skillsState(c.ctx).skills.values()].filter(
    (s) => s.agentId === c.agent.id && s.level >= cfg.promptMinLevel + cfg.masterGap,
  );
  return [...c.ctx.agents.keys()].some(
    (id) =>
      isHere(c, id) &&
      mine.some(
        (s) =>
          s.level - levelOf(c.ctx, id, s.skill) >= cfg.masterGap * 2 &&
          mayRepeatSession(c.ctx, c.agent.id, id, s.skill, c.now),
      ),
  );
}

registerAction<z.infer<typeof AskToLearnAction>>({
  type: "ask_to_learn",
  available: (c) => mastersHere(c.ctx, c.agent, c.now).length > 0,
  check: (c, a) => checkTeaching(c, a.who, a.skill, a.who, c.agent.id),
  describe: ({ ctx }, a) =>
    `pedirle a ${firstOf(ctx, a.who)} que me enseñe ${skillLabel(ctx, a.skill)}`,
  execute: (c, a) => propose(c, a.who, a.skill, a.who, c.agent.id),
});

registerAction<z.infer<typeof TeachAction>>({
  type: "teach",
  available: canTeachHere,
  check: (c, a) => checkTeaching(c, a.who, a.skill, c.agent.id, a.who),
  describe: ({ ctx }, a) => `enseñarle ${skillLabel(ctx, a.skill)} a ${firstOf(ctx, a.who)}`,
  execute: (c, a) => propose(c, a.who, a.skill, c.agent.id, a.who),
});

const awaiting = (c: ActionContext) => sessionsAwaiting(c.ctx, c.agent.id, c.now).length > 0;

registerAction<z.infer<typeof AcceptTeachingAction>>({
  type: "accept_teaching",
  available: awaiting,
  check: (c, a) => {
    const v = pendingSession(c.ctx, c.agent.id, a.sessionId, c.now);
    if (typeof v === "string") return v;
    if (!isHere(c, v.proposedBy)) return `${nameOf(c.ctx, v.proposedBy)} ya no está aquí`;
    return teachingRule(c.ctx, [v.teacherId, v.learnerId], c.agent.state.locationId);
  },
  describe: () => "aceptar la sesión de enseñanza",
  execute: ({ ctx, agent, now }, a) => {
    const v = skillsState(ctx).sessions.get(a.sessionId)!;
    v.placeId = agent.state.locationId;
    startSession(ctx, v, now);
    const what = skillLabel(ctx, v.skill);
    for (const id of [v.teacherId, v.learnerId]) {
      const who = ctx.agents.get(id)!;
      ctx.rt(id).overrideUntil = v.until;
      setAction(
        ctx,
        who,
        id === v.teacherId
          ? `enseñándole ${what} a ${firstOf(ctx, v.learnerId)}`
          : `aprendiendo ${what} con ${firstOf(ctx, v.teacherId)}`,
        "work",
      );
    }
    ctx.rt(v.proposedBy).pending.push({
      kind: "world",
      text: `${agent.seed.name} ha dicho que sí: ${what}, ahora.`,
      placeId: agent.state.locationId,
    });
    ctx.emit(
      "action",
      v.teacherId,
      `📚 ${nameOf(ctx, v.teacherId)} le enseña ${what} a ${nameOf(ctx, v.learnerId)}`,
      [v.teacherId, v.learnerId],
      undefined,
      { action: "accept_teaching", ok: true },
    );
  },
});

registerAction<z.infer<typeof DeclineTeachingAction>>({
  type: "decline_teaching",
  available: awaiting,
  check: (c, a) => {
    const v = pendingSession(c.ctx, c.agent.id, a.sessionId, c.now);
    return typeof v === "string" ? v : null;
  },
  describe: () => "rechazar la sesión de enseñanza",
  execute: ({ ctx, agent }, a) => {
    const v = skillsState(ctx).sessions.get(a.sessionId)!;
    v.status = "declined";
    const why = a.reason ? `: ${a.reason}` : "";
    ctx.rt(v.proposedBy).pending.push({
      kind: "world",
      text: `${agent.seed.name} no quiere lo de ${skillLabel(ctx, v.skill)}${why}.`,
      placeId: agent.state.locationId,
    });
    ctx.emit(
      "action",
      agent.id,
      `✖ ${agent.seed.name} no quiere lo de ${skillLabel(ctx, v.skill)}${why}`,
      [agent.id, v.proposedBy],
      undefined,
      { action: "decline_teaching", ok: true },
    );
  },
});

registerAction<z.infer<typeof HelpAction>>({
  type: "help",
  // Solo si alguien de aquí está haciendo algo en lo que se pueda echar una mano.
  available: (c) =>
    [...c.ctx.agents.values()].some(
      (o) => isHere(c, o.id) && practiceNow(c.ctx, o, c.now) !== null,
    ),
  check: (c, a) => {
    if (!isHere(c, a.who)) return `${nameOf(c.ctx, a.who)} no está aquí`;
    const other = c.ctx.agents.get(a.who)!;
    if (other.state.activityKind === "idle" && !practiceNow(c.ctx, other, c.now)) {
      return `${firstOf(c.ctx, a.who)} no está haciendo nada en lo que ayudar`;
    }
    return teachingRule(c.ctx, [c.agent.id, a.who], c.agent.state.locationId);
  },
  describe: ({ ctx }, a) => `ayudar a ${firstOf(ctx, a.who)}`,
  execute: ({ ctx, agent, now }, a) => {
    const cfg = skillsCfg(ctx);
    const other = ctx.agents.get(a.who)!;
    const doing = practiceNow(ctx, other, now);
    const until = now + cfg.helpMinutes;
    // Practica lo de la otra persona (que, si sabe más, hace de maestra sin querer).
    if (doing) {
      skillsState(ctx).coached.set(agent.id, { skill: doing.skill, masterId: other.id, until });
    }
    skillsState(ctx).counts.helps++;
    ctx.rt(agent.id).overrideUntil = until;
    setAction(ctx, agent, `ayudando a ${firstOf(ctx, a.who)} (${other.state.action})`, "work");
    ctx.rt(a.who).pending.push({
      kind: "world",
      text: `${agent.seed.name} me está ayudando con lo que hago.`,
      placeId: agent.state.locationId,
    });
    for (const [me, them] of [
      [agent.id, a.who],
      [a.who, agent.id],
    ] as const) {
      ctx.deps.track?.(
        applySocialUpdate(ctx.deps.social, {
          ownerId: me,
          aboutId: them,
          affinityDelta: cfg.helpAffinity,
          now,
          reason: me === agent.id ? "le ayudé" : "me ayudó",
          config: ctx.deps.memory.config.social,
        }).then(() => undefined),
      );
    }
    ctx.emit(
      "action",
      agent.id,
      `🤲 ${agent.seed.name} ayuda a ${firstOf(ctx, a.who)}${doing ? ` (${skillLabel(ctx, doing.skill)})` : ""}`,
      [agent.id, a.who],
      undefined,
      { action: "help", ok: true },
    );
  },
});

registerAction<z.infer<typeof ShowResultAction>>({
  type: "show_result",
  available: (c) => someoneHere(c) && resultsOf(c.ctx, c.agent.id).length > 0,
  check: (c, a) => {
    if (!isHere(c, a.who)) return `${nameOf(c.ctx, a.who)} no está aquí`;
    const mine = resultsOf(c.ctx, c.agent.id);
    if (a.itemId && !mine.includes(a.itemId)) return `no tengo nada mío "${a.itemId}" que enseñar`;
    return teachingRule(c.ctx, [c.agent.id, a.who], c.agent.state.locationId);
  },
  describe: ({ ctx }, a) => `enseñarle lo que he hecho a ${firstOf(ctx, a.who)}`,
  execute: ({ ctx, agent, now }, a) => {
    const st = skillsState(ctx);
    const id =
      a.itemId ??
      resultsOf(ctx, agent.id).sort(
        (x, y) => (st.results.get(y)?.quality ?? 0) - (st.results.get(x)?.quality ?? 0),
      )[0]!;
    const item = itemsState(ctx).items.get(id)!;
    const r = st.results.get(id)!;
    item.ownerId = a.who;
    item.holderId = a.who;
    saveItem(ctx, item);
    st.counts.shown++;
    tasteResult(
      ctx,
      a.who,
      agent.id,
      item.name,
      r.quality,
      now,
      `${agent.seed.name} me ha regalado ${item.name}`,
    );
    ctx.emit(
      "action",
      agent.id,
      `🎁 ${agent.seed.name} le enseña y le regala a ${firstOf(ctx, a.who)} ${item.name}`,
      [agent.id, a.who],
      undefined,
      { action: "show_result", ok: true },
    );
  },
});
