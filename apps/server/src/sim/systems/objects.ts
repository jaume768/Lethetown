/** Sistema de objetos del mapa con estado que dura (sim/actions/objects.ts; mock en agent/mock/decide.ts). */
import { z } from "zod";
import { objectsState, objectsTick } from "../actions/objects";
import { registerSystem } from "./registry";
import { REVIEW_MINUTES } from "./types";

const Timer = z.object({ at: z.number(), state: z.string(), from: z.string() });

registerSystem({
  id: "objects",
  description: "Usar los objetos del mapa; lo que dura (la cafetera en uso) vuelve solo.",
  actions: ["use_object"],
  snapshot: {
    version: 1,
    schema: z.object({ timers: z.record(z.string(), Timer) }),
    save: (ctx) => ({
      timers: Object.fromEntries(structuredClone([...objectsState(ctx).timers])),
    }),
    restore: (ctx, data) => {
      const timers = objectsState(ctx).timers;
      timers.clear();
      for (const [id, t] of Object.entries(data.timers)) timers.set(id, t);
    },
  },
  tick: { every: REVIEW_MINUTES, run: objectsTick },
  metrics: (ctx) => ({ running: objectsState(ctx).timers.size }),
});
