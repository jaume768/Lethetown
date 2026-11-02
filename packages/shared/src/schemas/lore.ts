/**
 * Saberes del pueblo (sistema `lore`): recetas, técnicas, sitios, historias y canciones que se
 * transmiten de unos a otros, se deforman al contarse y pueden perderse. Cada uno tiene su
 * versión (`LoreHolder`). Ver docs/decisiones/lore.md.
 */
import { z } from "zod";

export const LoreKind = z.enum(["recipe", "technique", "place", "story", "song"]);
export type LoreKind = z.infer<typeof LoreKind>;

/** Un elemento de un saber (un ingrediente, un paso, un detalle). */
export const LoreElement = z.object({
  id: z.string(),
  text: z.string().min(1).max(160),
  /** Cómo se suele deformar al contarse (sin LLM: se elige una). */
  variants: z.array(z.string().max(160)).default([]),
});
export type LoreElement = z.infer<typeof LoreElement>;

/** De dónde viene: un vecino o una persona que existe (gente de fuera de la semilla). */
export const LoreOrigin = z.object({
  agentId: z.string().nullable().default(null),
  /** Nombre de alguien de fuera que existe (offstagePeople) o null. */
  person: z.string().nullable().default(null),
});
export type LoreOrigin = z.infer<typeof LoreOrigin>;

export const Lore = z.object({
  /** Id corto («l3»). */
  id: z.string(),
  kind: LoreKind,
  title: z.string().min(2).max(80),
  /** Habilidad con la que se usa (la receta de pan, con «baking»). */
  skill: z.string().nullable().default(null),
  /** Sitio al que se refiere o donde se usa (el sitio de pesca: el lago). */
  placeId: z.string().nullable().default(null),
  /** La versión original (la de quien lo sabe al empezar). */
  elements: z.array(LoreElement).min(1).max(8),
  origin: LoreOrigin,
  createdAt: z.number(),
  /** Cuándo dejó de saberlo nadie con fidelidad suficiente (se perdió para el pueblo). */
  lostAt: z.number().nullable().default(null),
});
export type Lore = z.infer<typeof Lore>;

/** La versión de alguien: lo que conserva de cada elemento (y si lo cambió). */
export const HeldElement = z.object({
  id: z.string(),
  text: z.string(),
  altered: z.boolean().default(false),
});
export type HeldElement = z.infer<typeof HeldElement>;

export const LoreHolder = z.object({
  loreId: z.string(),
  agentId: z.string(),
  /** 0..1: lo bien que lo sabe (baja sin uso y al contarse). */
  fidelity: z.number().min(0).max(1),
  /** Los elementos que conserva (los que faltan, se le olvidaron o no se los contaron). */
  elements: z.array(HeldElement),
  /** De quién lo aprendió (null: lo sabe de siempre). */
  learnedFrom: z.string().nullable(),
  learnedAt: z.number(),
  lastUsedAt: z.number().nullable(),
  /** Si ya no recuerda cómo era (fidelidad por debajo del mínimo). */
  forgottenAt: z.number().nullable().default(null),
});
export type LoreHolder = z.infer<typeof LoreHolder>;

/** Un saber de partida en la semilla de quien lo sabe. */
export const SeedLore = z.object({
  kind: LoreKind,
  title: z.string().min(2).max(80),
  skill: z.string().nullable().default(null),
  placeId: z.string().nullable().default(null),
  /** De quién lo aprendió esa persona (alguien de su gente de fuera o un vecino), si se sabe. */
  from: z.string().nullable().default(null),
  elements: z
    .array(
      z.object({ text: z.string().min(1).max(160), variants: z.array(z.string()).default([]) }),
    )
    .min(2)
    .max(8),
});
export type SeedLore = z.infer<typeof SeedLore>;

/** Vista de un saber con la versión de cada uno (Rashomon). */
export const LoreView = z.object({
  lore: Lore,
  holders: z.array(LoreHolder),
});
export type LoreView = z.infer<typeof LoreView>;

export const LoreResponse = z.object({ now: z.number(), items: z.array(LoreView) });
export type LoreResponse = z.infer<typeof LoreResponse>;
