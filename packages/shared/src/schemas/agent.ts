import { z } from "zod";

export const AgentSeed = z.object({
  id: z.string(),
  name: z.string(),
  age: z.number().int().positive(),
  /** Rasgos estables: forman el prefijo fijo del prompt (cacheable). */
  traits: z.array(z.string()),
  description: z.string(),
  homeId: z.string(),
  /** Recuerdos iniciales (semánticos) con los que arranca el agente. */
  initialMemories: z.array(z.string()).default([]),
});
export type AgentSeed = z.infer<typeof AgentSeed>;

export const Needs = z.object({
  energy: z.number().min(0).max(1),
  hunger: z.number().min(0).max(1),
  social: z.number().min(0).max(1),
});
export type Needs = z.infer<typeof Needs>;

export const Mood = z.object({
  /** -1 (muy negativo) .. 1 (muy positivo) */
  valence: z.number().min(-1).max(1),
  label: z.string(),
});
export type Mood = z.infer<typeof Mood>;

export const PlanItem = z.object({
  /** Minuto del día (0..1439) en que empieza. */
  startMinute: z.number().int().min(0).max(1439),
  durationMin: z.number().int().positive(),
  activity: z.string(),
  placeId: z.string(),
});
export type PlanItem = z.infer<typeof PlanItem>;

export const AgentState = z.object({
  id: z.string(),
  name: z.string(),
  locationId: z.string(),
  /** Destino si se está desplazando. */
  targetId: z.string().nullable(),
  action: z.string(),
  mood: Mood,
  needs: Needs,
  plan: z.array(PlanItem),
  /** Lo último que ha dicho, para el bocadillo. */
  lastUtterance: z.string().nullable(),
});
export type AgentState = z.infer<typeof AgentState>;
