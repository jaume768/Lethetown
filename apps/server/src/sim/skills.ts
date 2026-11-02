/**
 * Habilidades (sistema `skills`): lo que sabe hacer cada vecino y cuánto. El motor mira cada rato
 * qué hace cada uno (el objeto que usa, la actividad, lo que se propuso practicar, una sesión de
 * enseñanza o una ayuda) y le suma práctica con la lógica de agent-core (skills/skills.ts):
 * rendimientos decrecientes y más deprisa con un maestro delante. Cada día sin práctica, se oxida
 * despacio. Los hitos (subir o bajar de etiqueta) quedan en la auditoría y como evento. Sin LLM.
 * Ver docs/decisiones/skills.md.
 */
import {
  levelLabel,
  practiceGain,
  skillAfterIdle,
  skillDef,
  skillForActivity,
  type Agent,
  type SkillsConfig,
} from "@lethetown/agent-core";
import type { SkillState } from "@lethetown/shared";
import { InMemorySkillStore, type SkillStore } from "../db/skills";
import { errorMessage, type SimContext } from "./context";
import { presentWith } from "./perception";
import { systemsHold } from "./systems/registry";

/** Entradas de historial por habilidad (lo más antiguo se descarta). */
const MAX_HISTORY = 40;
/** Cambio de nivel desde la última escritura que merece guardarse. */
const PERSIST_STEP = 0.01;
/** Tras sacar sus habilidades en una decisión, no vuelven a salir en este rato (min de juego). */
const DECIDE_COOLDOWN = 180;
/** Días hacia atrás en que una habilidad que sube cuenta como «aprendiendo». */
const LEARNING_DAYS = 3;

/** Lo que alguien hace a propósito para practicar (acción `practice`) hasta una hora. */
export interface Practicing {
  skill: string;
  until: number;
}

/** Quién le enseña o a quién ayuda ahora (lo ponen las sesiones y las ayudas). */
export interface Coached {
  skill: string;
  /** El maestro (o a quien ayuda, que hace de maestro si sabe más). */
  masterId: string | null;
  until: number;
}

export interface SkillsState {
  skills: Map<string, SkillState>;
  store: SkillStore;
  practicing: Map<string, Practicing>;
  coached: Map<string, Coached>;
  /** Último nivel escrito en el almacén (para no escribir cada 5 minutos). */
  written: Map<string, number>;
  /** Último día en que se aplicó el olvido. */
  lastDecayDay: number;
  /** Cuándo se le mostraron sus habilidades en una decisión. */
  shownAt: Map<string, number>;
  /** Minutos de práctica (para «Evolución»). */
  practiceMinutes: number;
  /** Quien escucha cuándo alguien practica (los resultados, la calidad, los saberes). */
  onPractice: ((p: PracticeTick) => void)[];
}

/** Lo que ha practicado alguien en una revisión. */
export interface PracticeTick {
  agent: Agent;
  skill: string;
  minutes: number;
  level: number;
  now: number;
}

const key = (agentId: string, skill: string) => `${agentId}:${skill}`;

export const skillsState = (ctx: SimContext) =>
  ctx.state<SkillsState>("skills", () => ({
    skills: new Map(),
    store: ctx.deps.skills ?? new InMemorySkillStore(),
    practicing: new Map(),
    coached: new Map(),
    written: new Map(),
    lastDecayDay: -1,
    shownAt: new Map(),
    practiceMinutes: 0,
    onPractice: [],
  }));

export const skillsCfg = (ctx: SimContext): SkillsConfig => ctx.deps.memory.config.skills;

/** La etiqueta de una habilidad («panadería»). */
export const skillLabel = (ctx: SimContext, id: string) =>
  skillDef(skillsCfg(ctx), id)?.label ?? id;

const firstName = (ctx: SimContext, id: string) =>
  ctx.agents.get(id)?.seed.name.split(" ")[0] ?? id;

/** Nivel de alguien en una habilidad (0 si nunca la ha practicado). */
export function levelOf(ctx: SimContext, agentId: string, skill: string): number {
  return skillsState(ctx).skills.get(key(agentId, skill))?.level ?? 0;
}

export function skillsOf(ctx: SimContext, agentId: string): SkillState[] {
  return [...skillsState(ctx).skills.values()].filter((s) => s.agentId === agentId);
}

function persist(ctx: SimContext, s: SkillState, force = false): void {
  const st = skillsState(ctx);
  const k = key(s.agentId, s.skill);
  const last = st.written.get(k);
  if (!force && last !== undefined && Math.abs(last - s.level) < PERSIST_STEP) return;
  st.written.set(k, s.level);
  ctx.deps.track?.(
    st.store
      .upsert(structuredClone(s))
      .catch((e: unknown) =>
        ctx.emit("system", s.agentId, `⚠ No se pudo guardar la habilidad: ${errorMessage(e)}`),
      ),
  );
}

function historyEntry(s: SkillState, now: number, reason: string): void {
  s.history = [...s.history, { at: now, level: round(s.level), reason }].slice(-MAX_HISTORY);
  s.updatedAt = now;
}

const round = (x: number) => Math.round(x * 1000) / 1000;

function audit(ctx: SimContext, s: SkillState, reason: string, now: number): void {
  ctx.deps.track?.(
    ctx.deps.memory.audit({
      agentId: s.agentId,
      memoryId: `skill:${s.skill}`,
      memoryText: skillLabel(ctx, s.skill),
      action: "skill",
      reason,
      at: now,
    }),
  );
}

/** El estado de una habilidad (lo crea a 0 si no la tenía). */
export function skillState(ctx: SimContext, agentId: string, skill: string, now: number) {
  const st = skillsState(ctx);
  const k = key(agentId, skill);
  let s = st.skills.get(k);
  if (!s) {
    s = {
      agentId,
      skill,
      level: 0,
      peak: 0,
      practiceMinutes: 0,
      lastUsedAt: null,
      learnedFrom: null,
      history: [],
      updatedAt: now,
    };
    st.skills.set(k, s);
  }
  return s;
}

/** Siembra las habilidades de partida (mundo nuevo). */
export function seedSkills(ctx: SimContext, now: number): void {
  for (const agent of ctx.agents.values()) {
    for (const [skill, level] of Object.entries(agent.seed.skills)) {
      if (!skillDef(skillsCfg(ctx), skill)) continue;
      const s = skillState(ctx, agent.id, skill, now);
      s.level = level;
      s.peak = level;
      s.lastUsedAt = now;
      historyEntry(s, now, "de partida");
      persist(ctx, s, true);
    }
  }
}

/**
 * Suma práctica a alguien (con la lógica de agent-core) y anota los hitos: si cambia de
 * etiqueta («ya se defiende»), auditoría, evento y recuerdo. `masterId`: quien le enseña o está
 * delante haciéndolo mejor.
 */
export function addPractice(
  ctx: SimContext,
  agent: Agent,
  skill: string,
  minutes: number,
  now: number,
  masterId: string | null = null,
): number {
  const cfg = skillsCfg(ctx);
  const s = skillState(ctx, agent.id, skill, now);
  const before = s.level;
  const masterLevel = masterId ? levelOf(ctx, masterId, skill) : null;
  const gain = practiceGain(
    before,
    minutes,
    { age: agent.seed.age, openness: agent.seed.personality.openness, masterLevel },
    cfg,
  );
  s.level = Math.min(1, before + gain);
  s.peak = Math.max(s.peak, s.level);
  s.practiceMinutes += minutes;
  s.lastUsedAt = now;
  s.updatedAt = now;
  skillsState(ctx).practiceMinutes += minutes;
  const helped = masterLevel !== null && masterLevel - before >= cfg.masterGap;
  if (helped && masterId && !s.learnedFrom) s.learnedFrom = masterId;
  if (levelLabel(s.level) !== levelLabel(before)) {
    const who = helped && masterId ? ` (con ${firstName(ctx, masterId)})` : "";
    const why = `practicando${who}: ahora «${levelLabel(s.level)}» (${s.level.toFixed(2)})`;
    historyEntry(s, now, why);
    audit(ctx, s, `${skillLabel(ctx, skill)}: ${why}`, now);
    ctx.emit(
      "action",
      agent.id,
      `🎓 ${agent.seed.name} ya es «${levelLabel(s.level)}» en ${skillLabel(ctx, skill)}${who}`,
      [agent.id, ...(helped && masterId ? [masterId] : [])],
      undefined,
      { action: "skill", ok: true },
    );
    persist(ctx, s, true);
  } else {
    persist(ctx, s);
  }
  for (const l of skillsState(ctx).onPractice) {
    l({ agent, skill, minutes, level: s.level, now });
  }
  return gain;
}

/** Qué practica alguien ahora y con quién (o null). */
export function practiceNow(
  ctx: SimContext,
  agent: Agent,
  now: number,
): { skill: string; masterId: string | null } | null {
  const st = skillsState(ctx);
  const coached = st.coached.get(agent.id);
  if (coached && coached.until > now) return { skill: coached.skill, masterId: coached.masterId };
  const planned = st.practicing.get(agent.id);
  if (planned && planned.until > now) return { skill: planned.skill, masterId: null };
  const skill = skillForActivity(
    { action: agent.state.action, spotId: agent.state.spotId },
    skillsCfg(ctx),
  );
  return skill ? { skill, masterId: null } : null;
}

/**
 * Revisión periódica: quien está haciendo algo que practica una habilidad suma práctica; si hay
 * alguien delante haciendo lo mismo que le saca ventaja, hace de maestro sin querer. Al cambiar
 * de día, el olvido.
 */
export function skillsTick(ctx: SimContext, now: number, minutes: number): void {
  const cfg = skillsCfg(ctx);
  if (!cfg.enabled) return;
  const st = skillsState(ctx);
  for (const [id, p] of st.practicing) if (p.until <= now) st.practicing.delete(id);
  for (const [id, c] of st.coached) if (c.until <= now) st.coached.delete(id);
  const doing = new Map<string, string>();
  for (const agent of ctx.agents.values()) {
    if (systemsHold(ctx, agent.id) || ctx.rt(agent.id).travelling) continue;
    if (agent.state.activityKind === "sleep") continue;
    const p = practiceNow(ctx, agent, now);
    if (p) doing.set(agent.id, p.skill);
  }
  for (const [id, skill] of doing) {
    const agent = ctx.agents.get(id)!;
    const coached = practiceNow(ctx, agent, now)?.masterId ?? null;
    // Alguien aquí que hace lo mismo y lo hace mejor: se aprende mirando.
    const master =
      coached ??
      presentWith(ctx, agent)
        .filter((o) => doing.get(o.id) === skill)
        .map((o) => o.id)
        .sort((a, b) => levelOf(ctx, b, skill) - levelOf(ctx, a, skill))[0] ??
      null;
    addPractice(ctx, agent, skill, minutes, now, master);
  }
  const day = Math.floor(now / 1440);
  if (st.lastDecayDay < 0) st.lastDecayDay = day;
  if (day > st.lastDecayDay) {
    decayAll(ctx, now, day - st.lastDecayDay);
    st.lastDecayDay = day;
  }
}

/** El olvido de un día (o varios): lo que no se practica se oxida despacio. */
export function decayAll(ctx: SimContext, now: number, days: number): void {
  const cfg = skillsCfg(ctx);
  for (const s of skillsState(ctx).skills.values()) {
    const idle = (now - (s.lastUsedAt ?? now)) / 1440;
    const before = s.level;
    const after = skillAfterIdle(before, s.peak, idle, days, cfg);
    if (before - after < 0.0005) continue;
    s.level = after;
    s.updatedAt = now;
    if (levelLabel(after) !== levelLabel(before)) {
      const why = `${Math.floor(idle)} días sin practicar: ahora «${levelLabel(after)}» (${after.toFixed(2)})`;
      historyEntry(s, now, why);
      audit(ctx, s, `${skillLabel(ctx, s.skill)}: ${why}`, now);
      const agent = ctx.agents.get(s.agentId);
      if (agent) {
        ctx.emit(
          "action",
          agent.id,
          `🕸 A ${agent.seed.name} se le ha oxidado ${skillLabel(ctx, s.skill)}`,
          [agent.id],
          undefined,
          { action: "skill", ok: false },
        );
      }
      persist(ctx, s, true);
    } else {
      persist(ctx, s);
    }
  }
}

/** Lo que se le da bien (desde `promptMinLevel`) y lo que está aprendiendo, en una línea. */
export function skillsLine(ctx: SimContext, agent: Agent, now: number): string | null {
  const cfg = skillsCfg(ctx);
  const mine = skillsOf(ctx, agent.id);
  const good = mine
    .filter((s) => s.level >= cfg.promptMinLevel)
    .sort((a, b) => b.level - a.level)
    .slice(0, cfg.maxInPrompt);
  // Aprendiendo: la practicó estos días y ha subido desde que empezó (no solo la de partida).
  const start = (s: SkillState) => (s.history[0]?.reason === "de partida" ? s.history[0].level : 0);
  const learning = mine.filter(
    (s) =>
      s.level < cfg.promptMinLevel &&
      s.lastUsedAt !== null &&
      now - s.lastUsedAt < LEARNING_DAYS * 1440 &&
      s.level - start(s) > 0.01,
  );
  const parts = [
    ...(good.length
      ? [
          `Se te da bien: ${good.map((s) => `${skillLabel(ctx, s.skill)} (${levelLabel(s.level)})`).join(", ")}`,
        ]
      : []),
    ...(learning.length
      ? [
          `Estás aprendiendo: ${learning
            .slice(0, 2)
            .map(
              (s) =>
                `${skillLabel(ctx, s.skill)}${s.learnedFrom ? ` (con ${firstName(ctx, s.learnedFrom)})` : ""}`,
            )
            .join(", ")}`,
        ]
      : []),
  ];
  return parts.length ? `${parts.join(". ")}.` : null;
}

/** En la decisión, sus habilidades, como mucho cada 3 h (lo variable cuesta tokens). */
export function decideSkillsLine(ctx: SimContext, agent: Agent, now: number): string | null {
  const st = skillsState(ctx);
  const last = st.shownAt.get(agent.id);
  if (last !== undefined && now - last < DECIDE_COOLDOWN) return null;
  const line = skillsLine(ctx, agent, now);
  if (line) st.shownAt.set(agent.id, now);
  return line;
}
