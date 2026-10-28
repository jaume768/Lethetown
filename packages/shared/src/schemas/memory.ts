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
