/**
 * Sistema de personalidad: la deriva lenta de los Big Five (lógica en
 * agent-core/agent/personality-drift.ts). Cuenta lo que vive cada uno (de los eventos: metas,
 * aprender y enseñar, conflictos, apoyo) y, cada semana de juego, aplica unas centésimas como
 * mucho, auditadas con su motivo. Si cambia cómo se describe en el prompt fijo, se rehace (una
 * vez). Sin LLM. Ver docs/decisiones/psicologia.md.
 */
import {
  applyDrift,
  driftText,
  personalityLine,
  weeklyDrift,
  type Experience,
} from "@lethetown/agent-core";
import { BigFive, type SimEvent } from "@lethetown/shared";
import { z } from "zod";
import type { SimContext } from "../context";
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
  listening: boolean;
}

export const personalityState = (ctx: SimContext) =>
  ctx.state<PersonalityState>("personality", () => ({
    base: new Map(),
    lived: new Map(),
    lastWeek: -1,
    history: new Map(),
    listening: false,
  }));

function note(ctx: SimContext, agentId: string | null | undefined, e: Experience): void {
  if (!agentId || !ctx.agents.has(agentId)) return;
  const lived = personalityState(ctx).lived;
  const mine = lived.get(agentId) ?? {};
  mine[e] = (mine[e] ?? 0) + 1;
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
      if (!ok && e.text.startsWith("💔")) for (const p of e.participants) note(ctx, p, "conflict");
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
};

/** Cada semana de juego: la deriva de cada uno según lo vivido y su edad. */
export function personalityTick(ctx: SimContext, now: number): void {
  const cfg = ctx.deps.memory.config.drift;
  const s = personalityState(ctx);
  const week = Math.floor(now / WEEK);
  if (s.lastWeek < 0) s.lastWeek = week;
  if (!cfg.enabled || week <= s.lastWeek) return;
  s.lastWeek = week;
  for (const agent of ctx.agents.values()) {
    const before = { ...agent.seed.personality };
    const base = s.base.get(agent.id) ?? before;
    const lived = s.lived.get(agent.id) ?? {};
    const after = applyDrift(before, base, weeklyDrift(lived, agent.seed.age, cfg), cfg);
    const text = driftText(before, after);
    if (!text) continue;
    agent.seed.personality = after;
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
}

const Entry = z.object({ at: z.number(), before: BigFive, after: BigFive, reason: z.string() });
const Lived = z.partialRecord(
  z.enum(["goalAchieved", "goalAbandoned", "learned", "taught", "conflict", "support"]),
  z.number(),
);

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
      };
    },
    restore: (ctx, d) => {
      const s = personalityState(ctx);
      s.base = new Map(Object.entries(d.base));
      s.lived = new Map(Object.entries(d.lived));
      s.lastWeek = d.lastWeek;
      s.history = new Map(Object.entries(d.history));
      for (const [id, p] of Object.entries(d.current)) {
        const agent = ctx.agents.get(id);
        if (!agent) continue;
        agent.seed.personality = p;
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
