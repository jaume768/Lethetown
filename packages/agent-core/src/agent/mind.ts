import { z } from "zod";
import { HabitTracker } from "../memory/habits";

/**
 * Estado interno del agente que no viaja al cliente (no está en `AgentState`) pero sí se guarda
 * en las instantáneas: rutinas vistas y recuerdos del diario de los últimos días.
 */
export const AgentMind = z.object({
  habits: HabitTracker.default({}),
  /** Recuerdos "El día N: …" de los últimos días (el último es el de ayer). */
  diaryMemoryIds: z.array(z.string()).default([]),
});
export type AgentMind = z.infer<typeof AgentMind>;

export function newMind(): AgentMind {
  return AgentMind.parse({});
}
