/** Sistema de normas: casas privadas y horarios (sim/norms.ts; `mayEnter` lo usan las acciones). */
import { z } from "zod";
import { normsState, normsTick } from "../norms";
import { registerSystem } from "./registry";
import { REVIEW_MINUTES } from "./types";

registerSystem({
  id: "norms",
  description: "Casas privadas (residentes e invitados) y horarios: abrir, cerrar e intrusos.",
  snapshot: {
    version: 1,
    schema: z.object({ guests: z.record(z.string(), z.record(z.string(), z.number())) }),
    save: (ctx) => ({
      guests: Object.fromEntries(
        [...normsState(ctx).guests].map(([placeId, g]) => [placeId, Object.fromEntries(g)]),
      ),
    }),
    restore: (ctx, data) => {
      const guests = normsState(ctx).guests;
      guests.clear();
      for (const [placeId, g] of Object.entries(data.guests)) {
        guests.set(placeId, new Map(Object.entries(g)));
      }
    },
  },
  tick: { every: REVIEW_MINUTES, run: normsTick },
  metrics: (ctx) => ({
    guests: [...normsState(ctx).guests.values()].reduce((n, g) => n + g.size, 0),
  }),
});
