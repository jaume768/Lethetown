import { z } from "zod";

export const MemoryType = z.enum(["observation", "reflection", "plan", "semantic"]);
export type MemoryType = z.infer<typeof MemoryType>;

/** "vivido" | "contado por <agentId>" | "inferido" */
export const MemorySource = z.union([
  z.literal("vivido"),
  z.literal("inferido"),
  z.string().regex(/^contado por .+$/),
]);
export type MemorySource = z.infer<typeof MemorySource>;

/** Recuerdo tal como viaja por la API (sin el vector de embedding). */
export const MemoryView = z.object({
  id: z.string(),
  agentId: z.string(),
  text: z.string(),
  /** Esencia comprimida (fase 2); si existe y el recuerdo es vago, se muestra esto. */
  gist: z.string().nullable(),
  createdAt: z.number(),
  lastAccessedAt: z.number(),
  importance: z.number().min(1).max(10),
  emotionalValence: z.number().min(-1).max(1),
  strength: z.number().min(0).max(1),
  source: MemorySource,
  type: MemoryType,
  people: z.array(z.string()),
  placeId: z.string().nullable(),
  /** Evento de la simulación del que procede (conversación...), para la vista Rashomon. */
  eventId: z.string().nullable(),
  /** Recuerdos de los que deriva (citas de una reflexión, episodios resumidos). */
  links: z.array(z.string()),
  /** "archived": resumido en otro recuerdo; ya no se recupera ni cuenta para el presupuesto. */
  status: z.enum(["active", "archived"]),
  /** Instante en que cruzó el umbral de olvido (null si no se ha olvidado). */
  forgottenAt: z.number().nullable(),
});
export type MemoryView = z.infer<typeof MemoryView>;

export const Clarity = z.enum(["clear", "vague", "forgotten"]);
export type Clarity = z.infer<typeof Clarity>;

export const MemoryScores = z.object({
  recency: z.number(),
  importance: z.number(),
  relevance: z.number(),
  moodMatch: z.number(),
  strength: z.number(),
  total: z.number(),
  clarity: Clarity,
});
export type MemoryScores = z.infer<typeof MemoryScores>;

export const ScoredMemoryView = z.object({
  memory: MemoryView,
  scores: MemoryScores,
});
export type ScoredMemoryView = z.infer<typeof ScoredMemoryView>;

/** Versión anterior de un recuerdo (reconsolidación, confusión de fuente...). */
export const MemoryVersion = z.object({
  memoryId: z.string(),
  version: z.number().int().nonnegative(),
  text: z.string(),
  emotionalValence: z.number(),
  source: z.string(),
  at: z.number(),
  reason: z.string(),
});
export type MemoryVersion = z.infer<typeof MemoryVersion>;

export const MemoryAuditAction = z.enum([
  "forgotten",
  "deleted",
  "archived",
  "summarized",
  "gist",
  "reconsolidated",
  "source_changed",
  "weakened",
  "reinforced",
  /** Una rutina repetida se convirtió en hábito (recuerdo semántico). */
  "habit",
]);
export type MemoryAuditAction = z.infer<typeof MemoryAuditAction>;

/** Registro de cada decisión de olvido o transformación, con su motivo. */
export const MemoryAuditEntry = z.object({
  agentId: z.string(),
  memoryId: z.string(),
  memoryText: z.string(),
  action: MemoryAuditAction,
  reason: z.string(),
  at: z.number(),
});
export type MemoryAuditEntry = z.infer<typeof MemoryAuditEntry>;

/** Ficha social: lo que un agente cree saber de otro. */
export const SocialProfile = z.object({
  ownerId: z.string(),
  aboutId: z.string(),
  summary: z.string(),
  /** -1 (aversión) .. 1 (afecto) */
  affinity: z.number().min(-1).max(1),
  /** 0..1 */
  trust: z.number().min(0).max(1),
  lastUpdated: z.number(),
});
export type SocialProfile = z.infer<typeof SocialProfile>;
