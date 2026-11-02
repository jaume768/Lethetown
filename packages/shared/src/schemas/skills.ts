/**
 * Habilidades de los vecinos (sistema `skills`): lo que sabe hacer cada uno y cuánto, cómo lo ha
 * ido aprendiendo y de quién. El catálogo y la lógica, en agent-core (skills/skills.ts). Ver
 * docs/decisiones/skills.md.
 */
import { z } from "zod";

export const SkillHistoryEntry = z.object({
  /** Minuto de juego. */
  at: z.number(),
  level: z.number(),
  /** Por qué cambió (legible). */
  reason: z.string(),
});
export type SkillHistoryEntry = z.infer<typeof SkillHistoryEntry>;

export const SkillState = z.object({
  agentId: z.string(),
  /** Id del catálogo ("baking"). */
  skill: z.string(),
  /** 0..1. */
  level: z.number().min(0).max(1),
  /** Lo más alto que llegó (lo aprendido a fondo se pierde menos). */
  peak: z.number().min(0).max(1),
  /** Minutos de práctica acumulados. */
  practiceMinutes: z.number().nonnegative(),
  /** Última vez que la practicó (minuto de juego). */
  lastUsedAt: z.number().nullable(),
  /** De quién aprendió (un vecino), si alguien le enseñó. */
  learnedFrom: z.string().nullable(),
  /** Una entrada al día que cambia y en cada hito (acotado). */
  history: z.array(SkillHistoryEntry).default([]),
  updatedAt: z.number(),
});
export type SkillState = z.infer<typeof SkillState>;

/** Niveles de partida de una semilla (habilidad → 0..1). */
export const SeedSkills = z.record(z.string(), z.number().min(0).max(1));
export type SeedSkills = z.infer<typeof SeedSkills>;

export const AgentSkillsResponse = z.object({
  agentId: z.string(),
  now: z.number(),
  /** Etiquetas del catálogo (id → «panadería»). */
  labels: z.record(z.string(), z.string()),
  skills: z.array(SkillState),
});
export type AgentSkillsResponse = z.infer<typeof AgentSkillsResponse>;
