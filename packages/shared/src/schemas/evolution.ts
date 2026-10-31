/**
 * Métricas de evolución de un mundo por día de juego (`GET /api/worlds/:id/evolution`, pestaña
 * de admin «Evolución», y `pnpm study:analyze`). Las calcula apps/server/src/analysis/.
 */
import { z } from "zod";

const Counts = z.record(z.string(), z.number());

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
  /** Cifras vivas de cada sistema (y del guardián de menores), solo en la pestaña de admin. */
  systems: z.record(z.string(), Counts).optional(),
});
export type EvolutionReport = z.infer<typeof EvolutionReport>;
