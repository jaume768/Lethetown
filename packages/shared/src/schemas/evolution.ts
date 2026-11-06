/**
 * Métricas de evolución de un mundo por día de juego (`GET /api/worlds/:id/evolution`, pestaña
 * de admin «Evolución», y `pnpm study:analyze`). Las calcula apps/server/src/analysis/.
 */
import { z } from "zod";

const Counts = z.record(z.string(), z.number());

const GoalFigures = z.object({
  active: z.number(),
  meanProgress: z.number(),
  achieved: z.number(),
  abandoned: z.number(),
  meanFrustration: z.number(),
});
/** Metas de un día: las cifras del pueblo y las de cada agente. */
const GoalDay = GoalFigures.extend({ byAgent: z.record(z.string(), GoalFigures) });

export const DayMetrics = z.object({
  /** Día de juego (o -1 para el total de la partida). */
  day: z.number().int(),
  utterances: z.number(),
  /** Parejas (sin orden) que han hablado, y en % de las posibles. */
  pairsTalked: z.number(),
  pairsPct: z.number(),
  /** Parejas que han hablado alguna vez hasta ese día (acumulado). */
  pairsEver: z.number(),
  /** Parte de las frases de las 4 parejas que más hablan (concentración de la red). */
  top4Share: z.number(),
  /** Gini de las frases por agente (0 = todos igual; 1 = habla uno solo). */
  gini: z.number(),
  /** Interlocutores distintos por agente: media y mínimo. */
  partnersMean: z.number(),
  partnersMin: z.number(),
  conversations: z.object({
    total: z.number(),
    group: z.number(),
    pair: z.number(),
    meanTurns: z.number(),
    endReasons: Counts,
  }),
  intentions: z.object({
    proposed: z.number(),
    kept: z.number(),
    missed: z.number(),
    late: z.number(),
  }),
  /** Por acción del catálogo: formales, acordadas hablando y que no salieron. */
  actions: z.record(
    z.string(),
    z.object({ done: z.number(), agreed: z.number(), failed: z.number() }),
  ),
  relationshipChanges: z.number(),
  memory: z.object({
    reconsolidated: z.number(),
    forgotten: z.number(),
    archived: z.number(),
    deleted: z.number(),
  }),
  llmErrors: Counts,
  usd: z.number(),
  /** Registro de conocimiento externo: anacronismos y referencias externas del día. */
  knowledge: Counts.optional(),
  /** Metas al final del día (o ahora, en el total) y lo conseguido o abandonado ese día. */
  goals: GoalDay.optional(),
  /**
   * Aprender (sistemas skills, lore y personality): hitos de habilidad hacia arriba y hacia
   * abajo, sesiones de enseñanza, ayudas, saberes contados, olvidados y perdidos, y cambios de
   * personalidad.
   */
  learning: z
    .object({
      skillUps: z.number(),
      skillRust: z.number(),
      sessions: z.number(),
      helps: z.number(),
      transmissions: z.number(),
      loreForgotten: z.number(),
      loreLost: z.number(),
      personality: z.number(),
    })
    .optional(),
  /**
   * Cognición en movimiento (fase 3.6, de los eventos y de las llamadas `decide_walking`):
   * encuentros por el camino (y los que hacen pensar), reencuentros, decisiones andando (y las
   * descartadas por llegar tarde), saludos, paradas a charlar, charlas nacidas en el camino
   * (paradas o andando), parejas que hablaron por primera vez en el camino, pasar de largo y
   * asociaciones. Todo a 0 en un mundo de control.
   */
  cognition: z
    .object({
      encounters: z.number(),
      salient: z.number(),
      reunions: z.number(),
      walkDecisions: z.number(),
      lateDiscarded: z.number(),
      greetings: z.number(),
      stops: z.number(),
      roadConversations: z.number(),
      walkingConversations: z.number(),
      firstTalksOnRoad: z.number(),
      passedBy: z.number(),
      associations: z.number(),
    })
    .optional(),
});
export type DayMetrics = z.infer<typeof DayMetrics>;

export const EvolutionReport = z.object({
  agents: z.number(),
  days: z.array(DayMetrics),
  total: DayMetrics,
  cost: z.object({
    total: z.number(),
    byTask: z.record(
      z.string(),
      z.object({
        calls: z.number(),
        usd: z.number(),
        cacheReadPct: z.number(),
        inPerCall: z.number(),
        outPerCall: z.number(),
      }),
    ),
    bySystem: Counts,
  }),
  replyLatency: z.object({
    replies: z.number(),
    meanMinutes: z.number(),
    p90Minutes: z.number(),
    meanSeconds: z.number().nullable(),
  }),
  /** Longitud de lo que se dice según el estilo (corta, media, larga; los menores aparte). */
  speechByStyle: z.record(
    z.string(),
    z.object({ n: z.number(), meanChars: z.number(), maxChars: z.number(), short: z.number() }),
  ),
  topPairs: z.array(z.object({ pair: z.string(), utterances: z.number() })),
  utterancesByAgent: Counts,
  relationshipTransitions: Counts,
  /** Conocimiento externo: por tipo, por agente y ejemplos recientes (los más nuevos primero). */
  knowledge: z
    .object({
      byKind: Counts,
      byAgent: z.record(z.string(), Counts),
      examples: z.array(
        z.object({
          at: z.number(),
          agentId: z.string().nullable(),
          kind: z.string(),
          term: z.string(),
          label: z.string(),
          text: z.string(),
          source: z.string(),
        }),
      ),
    })
    .optional(),
  /** Cifras vivas de cada sistema (y del guardián de menores), solo en la pestaña de admin. */
  systems: z.record(z.string(), Counts).optional(),
});
export type EvolutionReport = z.infer<typeof EvolutionReport>;
