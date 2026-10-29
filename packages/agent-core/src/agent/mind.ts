import { KnownPlaceInfo } from "@lethetown/shared";
import { z } from "zod";
import { HabitTracker } from "../memory/habits";
import { IntentionState } from "../memory/prospective";

/**
 * Estado interno del agente que no viaja al cliente (no está en `AgentState`) pero sí se guarda
 * en las instantáneas: rutinas vistas y recuerdos del diario de los últimos días.
 */
export const AgentMind = z.object({
  habits: HabitTracker.default({}),
  /** Recuerdos "El día N: …" de los últimos días (el último es el de ayer). */
  diaryMemoryIds: z.array(z.string()).default([]),
  /** Calidad del sueño de esta noche (0..1): techo de la energía que recupera durmiendo. */
  sleepQuality: z.number().min(0).max(1).default(1),
  /** Deuda de sueño de hoy (0..1): peor memoria y peor ánimo. */
  sleepDebt: z.number().min(0).max(1).default(0),
  /** Minutos que ha pasado hoy en el mismo sitio que cada vecino (mera exposición). */
  exposure: z.record(z.string(), z.number()).default({}),
  /** Intenciones abiertas (memoria prospectiva), con su pista y su estado. */
  intentions: z.array(IntentionState).default([]),
  /** Lugares que conoce (id → cómo y cuándo lo conoció). */
  knownPlaces: z.record(z.string(), KnownPlaceInfo).default({}),
});
export type AgentMind = z.infer<typeof AgentMind>;

export function newMind(): AgentMind {
  return AgentMind.parse({});
}
