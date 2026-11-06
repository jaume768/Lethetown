/**
 * Sistema de personalidad: la deriva lenta de los Big Five (lógica en
 * agent-core/agent/personality-drift.ts). Cuenta lo que vive cada uno (de los eventos: metas,
 * aprender y enseñar, conflictos, apoyo, plantones, préstamos sin devolver; y al acabar la
 * semana, sus fichas sociales, sus metas estancadas y la soledad) y, cada semana de juego,
 * aplica unas centésimas como mucho respecto a la media del pueblo, auditadas con su motivo.
 * Tras cambiar, recalcula su perfil de memoria (el ánimo base ya sale de la personalidad de
 * ahora) y, si cambia cómo se describe en el prompt fijo, lo rehace (una vez). Sin LLM. Ver
 * docs/decisiones/psicologia.md.
 */
import {
  applyDrift,
  driftText,
  EXPERIENCES,
  personalityLine,
  resolveProfile,
  townWeeklyDrift,
  type Experience,
} from "@lethetown/agent-core";
import { BigFive, type SimEvent } from "@lethetown/shared";
import { z } from "zod";
import type { SimContext } from "../context";
import { goalsOf } from "../goals";
import { registerSystem } from "./registry";
import { REVIEW_MINUTES } from "./types";

const WEEK = 7 * 1440;
/** Cambios guardados por agente (lo más antiguo se descarta). */
const MAX_HISTORY = 20;

interface DriftEntry {
  at: number;
  before: BigFive;
  after: BigFive;
  reason: string;
}

interface PersonalityState {
  /** La de la semilla (la deriva no se aleja más de `maxTotal` de ella). */
  base: Map<string, BigFive>;
  /** Lo vivido esta semana por cada uno. */
  lived: Map<string, Partial<Record<Experience, number>>>;
  lastWeek: number;
  history: Map<string, DriftEntry[]>;
  /** Minutos de soledad de esta semana (despierto, con la necesidad social baja). */
  lonely: Map<string, number>;
  listening: boolean;
}

export const personalityState = (ctx: SimContext) =>
  ctx.state<PersonalityState>("personality", () => ({
    base: new Map(),
    lived: new Map(),
    lastWeek: -1,
    history: new Map(),
    lonely: new Map(),
    listening: false,
  }));

function note(ctx: SimContext, agentId: string | null | undefined, e: Experience, n = 1): void {
  if (!agentId || !ctx.agents.has(agentId) || n <= 0) return;
  const lived = personalityState(ctx).lived;
  const mine = lived.get(agentId) ?? {};
  mine[e] = (mine[e] ?? 0) + n;
  lived.set(agentId, mine);
}

/** Lo que pasa y cuenta para la personalidad (de los eventos con `meta.action`). */
export function personalityOnEvent(ctx: SimContext, e: SimEvent): void {
  const action = e.meta?.action;
  const ok = e.meta?.ok === true;
  const [a, b] = e.participants;
  switch (action) {
    case "goal":
    case "goal_life":
      note(ctx, e.agentId, ok ? "goalAchieved" : "goalAbandoned");
      return;
    case "skill":
      if (ok) note(ctx, e.agentId, "learned");
      return;
    case "teach":
      note(ctx, a, "taught");
      note(ctx, b, "learned");
      return;
    case "goal_conflict":
    case "intruder":
      for (const p of e.participants) note(ctx, p, "conflict");
      return;
    case "meeting":
      // Un plantón lo sufre quien fue y esperó (no quien no apareció).
      if (!ok && e.text.startsWith("💔")) {
        for (const p of e.meta?.affected ?? e.participants) note(ctx, p, "stoodUp");
      }
      return;
    case "loan":
      // Préstamo vencido: [quien lo tiene, su dueño].
      if (!ok) note(ctx, b, "unpaidLoan");
      return;
    case "help":
    case "show_result":
      note(ctx, b, "support");
      return;
  }
}

const LIVED_LABEL: Record<Experience, string> = {
  goalAchieved: "metas conseguidas",
  goalAbandoned: "metas abandonadas",
  learned: "aprender algo",
  taught: "enseñar",
  conflict: "conflictos",
  support: "ayuda de otros",
  stoodUp: "plantones",
  goalStalled: "metas estancadas",
  lonely: "soledad",
  unpaidLoan: "préstamos sin devolver",
};

/** Bajada de afinidad entre dos entradas seguidas de una ficha que cuenta como conflicto. */
const AFFINITY_DROP = 0.1;

/**
 * Lo que se mira al acabar la semana: conflictos en sus fichas (pasar a rivalidad, bajadas de
 * afinidad), metas estancadas y la soledad acumulada.
 */
async function weekSignals(ctx: SimContext, since: number): Promise<void> {
  const cfg = ctx.deps.memory.config.drift;
  const s = personalityState(ctx);
  for (const agent of ctx.agents.values()) {
    const changes = await ctx.deps.social.history(agent.id, undefined, { since });
    const last = new Map<string, (typeof changes)[number]>();
    let conflicts = 0;
    for (const c of changes) {
      const prev = last.get(c.aboutId);
      if (prev) {
        const rival = c.relationshipType === "rivalry" && prev.relationshipType !== "rivalry";
        if (rival || prev.affinity - c.affinity >= AFFINITY_DROP) conflicts++;
      }
      last.set(c.aboutId, c);
    }
    note(ctx, agent.id, "conflict", conflicts);
    const stalled = goalsOf(ctx, agent.id, "active").filter(
      (g) => g.frustration >= cfg.stalledFrustration,
    ).length;
    note(ctx, agent.id, "goalStalled", stalled);
    const lonelyMin = s.lonely.get(agent.id) ?? 0;
    note(ctx, agent.id, "lonely", Math.floor(lonelyMin / (cfg.lonelyHoursPerCount * 60)));
  }
}

/** Cada revisión: quien está despierto con la necesidad social baja suma soledad. */
function noteLoneliness(ctx: SimContext, minutes: number): void {
  const cfg = ctx.deps.memory.config.drift;
  const s = personalityState(ctx);
  for (const agent of ctx.agents.values()) {
    if (agent.state.activityKind === "sleep" || agent.state.needs.social >= cfg.lonelyBelow)
      continue;
    s.lonely.set(agent.id, (s.lonely.get(agent.id) ?? 0) + minutes);
  }
}

/**
 * Cada semana de juego: la deriva de cada uno según lo vivido (respecto a la media del pueblo
 * esa semana) y su edad.
 */
export async function personalityTick(ctx: SimContext, now: number): Promise<void> {
  const cfg = ctx.deps.memory.config.drift;
  const s = personalityState(ctx);
  const week = Math.floor(now / WEEK);
  if (s.lastWeek < 0) s.lastWeek = week;
  if (!cfg.enabled) return;
  if (week <= s.lastWeek) {
    noteLoneliness(ctx, REVIEW_MINUTES);
    return;
  }
  const since = s.lastWeek * WEEK;
  s.lastWeek = week;
  await weekSignals(ctx, since);
  const deltas = townWeeklyDrift(
    [...ctx.agents.values()].map((a) => ({
      id: a.id,
      age: a.seed.age,
      lived: s.lived.get(a.id) ?? {},
    })),
    cfg,
  );
  for (const agent of ctx.agents.values()) {
    const before = { ...agent.seed.personality };
    const base = s.base.get(agent.id) ?? before;
    const lived = s.lived.get(agent.id) ?? {};
    const after = applyDrift(before, base, deltas[agent.id] ?? {}, cfg);
    const text = driftText(before, after);
    if (!text) continue;
    agent.seed.personality = after;
    followDrift(ctx, agent.id);
    // El prompt fijo, solo si cambia cómo se describe (rompe la caché de ese agente una vez).
    if (personalityLine(before) !== personalityLine(after)) agent.refreshIdentity();
    const why = Object.entries(lived)
      .filter(([, n]) => n)
      .map(([k, n]) => `${LIVED_LABEL[k as Experience]} (${n})`)
      .join(", ");
    const reason = `esta semana, ${text}${why ? `: ${why}` : ": la edad"}`;
    s.history.set(
      agent.id,
      [...(s.history.get(agent.id) ?? []), { at: now, before, after, reason }].slice(-MAX_HISTORY),
    );
    ctx.deps.track?.(
      ctx.deps.memory.audit({
        agentId: agent.id,
        memoryId: "personality",
        memoryText: personalityLine(after),
        action: "personality",
        reason,
        at: now,
      }),
    );
  }
  s.lived.clear();
  s.lonely.clear();
}

/**
 * El perfil de memoria sigue a la personalidad, con la misma función que al arrancar
 * (`resolveProfile`). El ánimo base ya se calcula con la personalidad de ahora (`baselineMood`).
 */
function followDrift(ctx: SimContext, agentId: string): void {
  const agent = ctx.agents.get(agentId);
  if (!agent) return;
  ctx.deps.memory.setProfile(agentId, resolveProfile(agent.seed, ctx.deps.memory.config.profile));
}

const Entry = z.object({ at: z.number(), before: BigFive, after: BigFive, reason: z.string() });
const Lived = z.partialRecord(z.enum(EXPERIENCES), z.number());

registerSystem({
  id: "personality",
  description:
    "La personalidad cambia muy despacio con lo vivido y la edad (unas centésimas por semana).",
  snapshot: {
    version: 1,
    schema: z.object({
      base: z.record(z.string(), BigFive),
      current: z.record(z.string(), BigFive),
      lived: z.record(z.string(), Lived),
      lastWeek: z.number(),
      history: z.record(z.string(), z.array(Entry)),
      /** Corrección 3.5 (sin ella, a cero: las instantáneas viejas siguen valiendo). */
      lonely: z.record(z.string(), z.number()).default({}),
    }),
    save: (ctx) => {
      const s = personalityState(ctx);
      return {
        base: Object.fromEntries(s.base),
        current: Object.fromEntries(
          [...ctx.agents.values()].map((a) => [a.id, { ...a.seed.personality }]),
        ),
        lived: Object.fromEntries(s.lived),
        lastWeek: s.lastWeek,
        history: Object.fromEntries(s.history),
        lonely: Object.fromEntries(s.lonely),
      };
    },
    restore: (ctx, d) => {
      const s = personalityState(ctx);
      s.base = new Map(Object.entries(d.base));
      s.lived = new Map(Object.entries(d.lived));
      s.lastWeek = d.lastWeek;
      s.history = new Map(Object.entries(d.history));
      s.lonely = new Map(Object.entries(d.lonely));
      for (const [id, p] of Object.entries(d.current)) {
        const agent = ctx.agents.get(id);
        if (!agent) continue;
        agent.seed.personality = p;
        followDrift(ctx, id);
        agent.refreshIdentity();
      }
    },
  },
  load: (ctx) => {
    const s = personalityState(ctx);
    for (const a of ctx.agents.values()) {
      if (!s.base.has(a.id)) s.base.set(a.id, { ...a.seed.personality });
    }
    if (!s.listening) {
      s.listening = true;
      ctx.onEvent((e) => personalityOnEvent(ctx, e));
    }
  },
  tick: { every: REVIEW_MINUTES, run: personalityTick },
  metrics: (ctx) => {
    const s = personalityState(ctx);
    let total = 0;
    let max = 0;
    for (const a of ctx.agents.values()) {
      const base = s.base.get(a.id);
      if (!base) continue;
      const d = (
        ["openness", "conscientiousness", "extraversion", "agreeableness", "neuroticism"] as const
      ).reduce((acc, t) => acc + Math.abs(a.seed.personality[t] - base[t]), 0);
      total += d;
      max = Math.max(max, d);
    }
    return {
      meanDrift: Math.round((total / Math.max(1, ctx.agents.size)) * 1000) / 1000,
      maxDrift: Math.round(max * 1000) / 1000,
      changes: [...s.history.values()].reduce((a, h) => a + h.length, 0),
    };
  },
  admin: (ctx) => Object.fromEntries(personalityState(ctx).history),
});
