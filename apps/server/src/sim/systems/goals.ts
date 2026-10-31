/**
 * Sistema de metas: vital, proyectos y pasos medibles; psicología de la ambición; metas en
 * conflicto; marcharse del pueblo y volver de visita (lógica en sim/goals.ts; psicología en
 * agent-core/goals). Sin llamadas nuevas al LLM: lo variable va al plan y a la decisión, y la
 * revisión con el modelo va en la consolidación nocturna. Ver docs/decisiones/metas.md.
 */
import { Departure, Goal } from "@lethetown/shared";
import { z } from "zod";
import {
  applyProposals,
  consolidationPrompt,
  decideLine,
  detectConflicts,
  goalsOnEvent,
  goalsState,
  isAway,
  measureTick,
  planLines,
  relationshipTick,
  restoreAway,
  reviewNight,
  seedGoals,
  visitsTick,
} from "../goals";
import { presentWith } from "../perception";
import { registerSystem } from "./registry";
import { REVIEW_MINUTES } from "./types";

/** Cada cuánto se miran las fichas (metas de relación) y los conflictos. */
const HOURLY = 60;

registerSystem({
  id: "goals",
  description:
    "Metas vitales, proyectos y pasos medibles; motivación y frustración; irse del pueblo.",
  snapshot: {
    version: 1,
    schema: z.object({
      goals: z.array(Goal),
      seq: z.number().int().nonnegative(),
      departures: z.array(Departure),
      lastPlace: z.record(z.string(), z.string()),
      conflicts: z.array(z.string()),
    }),
    save: (ctx) => {
      const s = goalsState(ctx);
      return {
        goals: structuredClone([...s.goals.values()]),
        seq: s.seq,
        departures: structuredClone([...s.departures.values()]),
        lastPlace: Object.fromEntries(s.lastPlace),
        conflicts: [...s.conflicts],
      };
    },
    restore: (ctx, d) => {
      const s = goalsState(ctx);
      s.goals = new Map(d.goals.map((g) => [g.id, g]));
      s.seq = d.seq;
      s.departures = new Map(d.departures.map((x) => [x.agentId, x]));
      s.lastPlace = new Map(Object.entries(d.lastPlace));
      s.conflicts = new Set(d.conflicts);
    },
  },
  load: async (ctx, { restored, now }) => {
    const s = goalsState(ctx);
    if (!restored) {
      const stored = await s.store.list();
      if (stored.length) {
        s.goals = new Map(stored.map((g) => [g.id, g]));
        s.seq = Math.max(0, ...stored.map((g) => Number(g.id.slice(1)) || 0));
      } else {
        // Mundo nuevo: las metas de partida de cada semilla.
        for (const agent of ctx.agents.values()) {
          if (agent.seed.goals) await seedGoals(ctx, agent, agent.seed.goals, now);
        }
      }
      s.departures = new Map((await s.departureStore.list()).map((d) => [d.agentId, d]));
      restoreAway(ctx);
      await detectConflicts(ctx, now);
    }
    if (!s.listening) {
      s.listening = true;
      ctx.onEvent((e) => goalsOnEvent(ctx, e));
    }
  },
  tick: {
    every: REVIEW_MINUTES,
    run: (ctx, now) => {
      measureTick(ctx, now, REVIEW_MINUTES);
      visitsTick(ctx, now);
      // Solo cada hora hay algo que esperar (las fichas sociales).
      if (now % HOURLY !== 0) return;
      return relationshipTick(ctx, now).then(() => detectConflicts(ctx, now));
    },
  },
  holds: (ctx, agentId) => isAway(ctx, agentId),
  planSections: (ctx, agent) => [
    {
      title: "TUS METAS Y PROYECTOS AHORA (si encaja hoy, dedícale tiempo a alguno)",
      lines: planLines(ctx, agent),
      order: 10,
    },
  ],
  promptSections: (ctx, agent, now) => {
    const line = decideLine(
      ctx,
      agent,
      now,
      presentWith(ctx, agent).map((p) => p.id),
    );
    return line ? [{ title: "TU PROYECTO", lines: [line], order: 60 }] : [];
  },
  consolidation: (ctx, agent) =>
    ctx.deps.memory.config.goals.enabled
      ? {
          key: "goals",
          prompt: consolidationPrompt(ctx, agent),
          apply: async (value, now) => {
            reviewNight(ctx, agent, now);
            await applyProposals(ctx, agent, value, now);
            await detectConflicts(ctx, now);
          },
        }
      : null,
  retention: {
    table: "goals",
    keep: "son la trayectoria de cada vecino: pocas filas por agente y el historial de cada meta ya va acotado (60 entradas); departures, una fila por quien se fue",
  },
  metrics: (ctx) => {
    const goals = [...goalsState(ctx).goals.values()];
    const active = goals.filter((g) => g.status === "active");
    const mean = (xs: number[]) =>
      xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100 : 0;
    return {
      active: active.length,
      achieved: goals.filter((g) => g.status === "achieved").length,
      abandoned: goals.filter((g) => g.status === "abandoned").length,
      postponed: goals.filter((g) => g.status === "postponed").length,
      meanProgress: mean(active.map((g) => g.progress)),
      meanFrustration: mean(active.map((g) => g.frustration)),
      conflicts: goalsState(ctx).conflicts.size,
      away: [...goalsState(ctx).departures.values()].filter((d) => !d.visiting).length,
    };
  },
  admin: (ctx) => ({
    goals: [...goalsState(ctx).goals.values()],
    departures: [...goalsState(ctx).departures.values()],
  }),
});
