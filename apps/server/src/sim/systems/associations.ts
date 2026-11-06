/**
 * Sistema de pensamiento por asociación (fase 3.6; sim/associations.ts). Sigue al interruptor
 * `cognition.associations` del mundo (ver SimContext.enabled). Sin LLM.
 */
import { z } from "zod";
import { associationsState, associationsTick } from "../associations";
import { registerSystem } from "./registry";

const Counts = z.record(z.string(), z.number());

registerSystem({
  id: "associations",
  description: "Pensamiento por asociación: un sitio, una persona o un objeto trae un recuerdo.",
  snapshot: {
    version: 1,
    schema: z.object({
      perHour: z.array(z.tuple([z.string(), z.object({ hour: z.number(), n: z.number() })])),
      lastPlace: z.array(z.tuple([z.string(), z.string()])),
      lastSpot: z.array(z.tuple([z.string(), z.string()])),
      totals: Counts,
      byDay: z.array(z.tuple([z.number(), Counts])),
    }),
    save: (ctx) => {
      const s = associationsState(ctx);
      return {
        perHour: structuredClone([...s.perHour]),
        lastPlace: [...s.lastPlace],
        lastSpot: [...s.lastSpot],
        totals: { ...s.totals },
        byDay: [...s.byDay]
          .slice(-60)
          .map(([d, c]) => [d, { ...c }] as [number, Record<string, number>]),
      };
    },
    restore: (ctx, d) => {
      const s = associationsState(ctx);
      s.perHour = new Map(d.perHour);
      s.lastPlace = new Map(d.lastPlace);
      s.lastSpot = new Map(d.lastSpot);
      s.totals = { ...d.totals };
      s.byDay = new Map(d.byDay);
    },
  },
  tick: {
    every: 1,
    run: (ctx, now) =>
      Math.floor(now) % ctx.cognition.params.scanEveryMinutes === 0
        ? associationsTick(ctx, now)
        : undefined,
  },
  metrics: (ctx) => {
    const s = associationsState(ctx);
    const days = Math.max(1, s.byDay.size);
    const total = s.totals.associations ?? 0;
    return {
      associations: total,
      associationsPerDay: Math.round((total / days) * 10) / 10,
      intrusive: s.totals.intrusive ?? 0,
      byPlace: s.totals["by.place"] ?? 0,
      byPerson: s.totals["by.person"] ?? 0,
      byObject: s.totals["by.object"] ?? 0,
    };
  },
});
