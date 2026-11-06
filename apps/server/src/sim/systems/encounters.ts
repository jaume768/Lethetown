/**
 * Sistema de encuentros por el camino (fase 3.6): sim/encounters.ts (revisión, saliencia, viajes
 * pendientes), sim/walking.ts (pensar andando), sim/actions/walking.ts (saludar, pararse a
 * charlar) y presencia por proximidad (sim/presence.ts). Sigue al interruptor
 * `cognition.encounters` del mundo (ver SimContext.enabled). Ver docs/decisiones/cognicion.md.
 */
import { ActivityKind } from "@lethetown/shared";
import { z } from "zod";
import {
  ENCOUNTER_STATS,
  encountersState,
  encountersTick,
  countStat,
  moving,
  noteTalk,
} from "../encounters";
import { registerSystem } from "./registry";

const Trip = z.object({
  destId: z.string(),
  spotId: z.string().nullable(),
  thenAction: z.string(),
  thenKind: ActivityKind,
  planStart: z.number().nullable(),
  stoppedAt: z.number(),
});

const Counts = z.record(z.string(), z.number());

/** Días de juego de cifras que se guardan (las de antes ya están en los totales). */
const KEEP_DAYS = 60;

registerSystem({
  id: "encounters",
  description:
    "Encuentros por el camino: quién se cruza con quién, saludar, pararse a charlar y retomar el camino.",
  actions: ["greet", "stop_to_chat"],
  snapshot: {
    version: 1,
    schema: z.object({
      cooldown: z.array(z.tuple([z.string(), z.number()])),
      lastSeen: z.array(z.tuple([z.string(), z.number()])),
      trips: z.array(z.tuple([z.string(), Trip])),
      talked: z.array(z.string()),
      totals: Counts,
      byDay: z.array(z.tuple([z.number(), Counts])),
    }),
    save: (ctx) => {
      const s = encountersState(ctx);
      return {
        cooldown: [...s.cooldown],
        lastSeen: [...s.lastSeen],
        trips: structuredClone([...s.trips]),
        talked: [...s.talked],
        totals: { ...s.totals },
        byDay: [...s.byDay]
          .slice(-KEEP_DAYS)
          .map(([d, c]) => [d, { ...c }] as [number, Record<string, number>]),
      };
    },
    restore: (ctx, d) => {
      const s = encountersState(ctx);
      s.cooldown = new Map(d.cooldown);
      s.lastSeen = new Map(d.lastSeen);
      s.trips = new Map(d.trips);
      s.talked = new Set(d.talked);
      s.totals = { ...d.totals };
      s.byDay = new Map(d.byDay);
    },
  },
  // Quién ha hablado con quién (para «hablaron por primera vez en el camino»): de los eventos.
  load: (ctx) => {
    ctx.onEvent((e) => {
      if (e.kind !== "speech" || !e.agentId) return;
      const to = e.participants[1];
      if (!to || to === e.agentId) return;
      const conv = ctx.conversations.get(e.id.split(":")[0] ?? "");
      noteTalk(ctx, e.agentId, to, conv?.road === true);
      // Una charla que nace en el camino: andando (los dos caminan) o parados a charlar.
      if (conv?.road && conv.turns === 1) {
        countStat(ctx, moving(ctx, e.agentId) ? "walkingConversations" : "roadConversations");
      }
    });
  },
  // Cada minuto, pero solo trabaja cada `scanEveryMinutes` (es un parámetro del mundo).
  tick: {
    every: 1,
    run: (ctx, now) =>
      Math.floor(now) % ctx.cognition.params.scanEveryMinutes === 0
        ? encountersTick(ctx, now)
        : undefined,
  },
  metrics: (ctx) => {
    const s = encountersState(ctx);
    const days = Math.max(1, s.byDay.size);
    const out: Record<string, number> = {};
    for (const k of ENCOUNTER_STATS) {
      out[k] = s.totals[k] ?? 0;
      out[`${k}PerDay`] = Math.round(((s.totals[k] ?? 0) / days) * 10) / 10;
    }
    out.pendingTrips = s.trips.size;
    out.talkedPairs = s.talked.size;
    return out;
  },
});
