import { z } from "zod";
import { TilePoint } from "./world";

/** Aspecto del personaje: hoja de sprites del manifest y colores para recolorear el placeholder. */
export const Appearance = z.object({
  /** Clave de personaje en el manifest de assets. */
  sheet: z.string().default("default"),
  skin: z.string().default("#f1c27d"),
  hair: z.string().default("#4a3020"),
  shirt: z.string().default("#3d6fb4"),
  pants: z.string().default("#2b2b3b"),
});
export type Appearance = z.infer<typeof Appearance>;

/**
 * Receta de retrato para `pnpm portraits:compose` (piezas del Portrait Generator de LimeZu):
 * se apilan piel, ojos, peinado y accesorios en ese orden.
 */
export const PortraitRecipe = z.object({
  /** "Skin N" (1–9). */
  skin: z.number().int().min(1),
  /** "Eyes NN" (1–7). */
  eyes: z.number().int().min(1),
  /** Peinado y color: "Hairstyle NN C" (color 1–7; el 5 es canoso). */
  hair: z.object({ style: z.number().int().min(1), color: z.number().int().min(1) }),
  /** Nombres de archivo de Accessories sin extensión, p. ej. "Accessory 15 Glasses 1". */
  accessories: z.array(z.string()).default([]),
});
export type PortraitRecipe = z.infer<typeof PortraitRecipe>;

export const AgentSeed = z.object({
  id: z.string(),
  name: z.string(),
  age: z.number().int().positive(),
  /** Rasgos estables: forman el prefijo fijo del prompt (cacheable). */
  traits: z.array(z.string()),
  description: z.string(),
  homeId: z.string(),
  appearance: Appearance.default({
    sheet: "default",
    skin: "#f1c27d",
    hair: "#4a3020",
    shirt: "#3d6fb4",
    pants: "#2b2b3b",
  }),
  portrait: PortraitRecipe.optional(),
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

/** Tipo de actividad: decide animación, pose y emote en el cliente. */
export const ActivityKind = z.enum([
  "walk",
  "idle",
  "sit",
  "sleep",
  "talk",
  "read",
  "work",
  "eat",
  "cook",
]);
export type ActivityKind = z.infer<typeof ActivityKind>;

export const Facing = z.enum(["down", "left", "right", "up"]);
export type Facing = z.infer<typeof Facing>;

export const PlanItem = z.object({
  /** Minuto del día (0..1439) en que empieza. */
  startMinute: z.number().int().min(0).max(1439),
  durationMin: z.number().int().positive(),
  activity: z.string(),
  activityKind: ActivityKind.default("idle"),
  placeId: z.string(),
  /** Objeto concreto del lugar (cama, barra...), si aplica. */
  spotId: z.string().nullable().default(null),
});
export type PlanItem = z.infer<typeof PlanItem>;

/** Desplazamiento en curso: el cliente interpola la posición por el reloj de juego. */
export const Movement = z.object({
  waypoints: z.array(TilePoint).min(1),
  startTime: z.number(),
  endTime: z.number(),
});
export type Movement = z.infer<typeof Movement>;

export const AgentState = z.object({
  id: z.string(),
  name: z.string(),
  appearance: Appearance,
  locationId: z.string(),
  /** Destino si se está desplazando. */
  targetId: z.string().nullable(),
  /** Spot en el que está (o al que va). */
  spotId: z.string().nullable(),
  tile: TilePoint,
  facing: Facing,
  movement: Movement.nullable(),
  action: z.string(),
  activityKind: ActivityKind,
  mood: Mood,
  needs: Needs,
  plan: z.array(PlanItem),
  /** Lo último que ha dicho, para el bocadillo. */
  lastUtterance: z.string().nullable(),
});
export type AgentState = z.infer<typeof AgentState>;
