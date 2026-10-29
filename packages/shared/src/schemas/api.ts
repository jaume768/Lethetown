import { z } from "zod";
import { AgentState } from "./agent";
import {
  Clarity,
  MemoryAuditEntry,
  MemoryVersion,
  MemoryView,
  RelationshipType,
  ScoredMemoryView,
  SocialProfile,
  SocialProfileChange,
} from "./memory";
import { SimSpeed, Weather, World } from "./world";

export const TokenUsage = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative(),
  cacheWriteTokens: z.number().int().nonnegative(),
});
export type TokenUsage = z.infer<typeof TokenUsage>;

export const CostBucket = TokenUsage.extend({
  calls: z.number().int().nonnegative(),
  usd: z.number().nonnegative(),
});
export type CostBucket = z.infer<typeof CostBucket>;

export const CostSummary = z.object({
  total: CostBucket,
  byAgent: z.record(z.string(), CostBucket),
  byTask: z.record(z.string(), CostBucket),
  byModel: z.record(z.string(), CostBucket),
});
export type CostSummary = z.infer<typeof CostSummary>;

export const SimEventKind = z.enum([
  "action",
  "speech",
  "observation",
  "plan",
  "system",
  "world",
  "thought",
  "memory",
  "chronicle",
]);
export type SimEventKind = z.infer<typeof SimEventKind>;

export const SimEvent = z.object({
  id: z.string(),
  time: z.number(),
  agentId: z.string().nullable(),
  kind: SimEventKind,
  text: z.string(),
  /** Agentes implicados (hablante, oyente, quien lo oyó a escondidas...). */
  participants: z.array(z.string()).default([]),
  /** Acción del catálogo que lo produjo (para iconos y filtros) y si salió bien. */
  meta: z.object({ action: z.string().optional(), ok: z.boolean().optional() }).optional(),
});
export type SimEvent = z.infer<typeof SimEvent>;

export const ClockState = z.object({
  time: z.number(),
  speed: SimSpeed,
});
export type ClockState = z.infer<typeof ClockState>;

/**
 * Estado de ejecución de un mundo. `paused` con motivo: presupuesto superado, kill switch, sin
 * espectadores o pausa manual.
 */
export const WorldRunStatus = z.object({
  state: z.enum(["running", "paused"]),
  reason: z.enum(["budget", "kill_switch", "no_viewers", "manual"]).nullable(),
  /** Texto legible (p. ej. "Presupuesto diario del mundo superado: $2.01 de $2.00"). */
  detail: z.string().nullable(),
});
export type WorldRunStatus = z.infer<typeof WorldRunStatus>;

export const RUNNING: WorldRunStatus = { state: "running", reason: null, detail: null };

export const WorldSnapshot = z.object({
  world: World,
  clock: ClockState,
  agents: z.array(AgentState),
  provider: z.string(),
  weather: Weather,
  status: WorldRunStatus.default(RUNNING),
});
export type WorldSnapshot = z.infer<typeof WorldSnapshot>;

export const AgentMemoryResponse = z.object({
  agentId: z.string(),
  now: z.number(),
  workingMemory: z.array(z.string()),
  /** Página de recuerdos, ordenados por puntuación. */
  memories: z.array(ScoredMemoryView),
  /** Total de recuerdos del agente (para paginar) y posición de esta página. */
  total: z.number().int().nonnegative().default(0),
  offset: z.number().int().nonnegative().default(0),
  /** Decisiones de olvido/transformación recientes ("olvidó X porque..."). */
  audit: z.array(MemoryAuditEntry),
  social: z.array(SocialProfile),
});

/** Persona que conoce un agente: su ficha y la recíproca (lo que la otra piensa de él). */
export const RelationshipEntry = z.object({
  name: z.string(),
  profile: SocialProfile,
  /** Lo que la otra persona piensa de este agente (null si nada): no tiene por qué coincidir. */
  reciprocal: SocialProfile.nullable(),
  /** Últimos valores de la afinidad (mini gráfica de su evolución). */
  trend: z.array(z.object({ at: z.number(), value: z.number() })).default([]),
});
export type RelationshipEntry = z.infer<typeof RelationshipEntry>;

export const RelationshipsQuery = z.object({
  /** Busca por nombre (sin distinguir mayúsculas ni tildes). */
  q: z.string().max(100).optional(),
  type: RelationshipType.optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});

export const RelationshipsResponse = z.object({
  agentId: z.string(),
  now: z.number(),
  /** Página de relaciones, de más a menos afinidad. */
  items: z.array(RelationshipEntry),
  total: z.number().int().nonnegative(),
  offset: z.number().int().nonnegative(),
  /** Vecinos de los que aún no piensa nada. */
  unknown: z.array(z.object({ id: z.string(), name: z.string() })),
});
export type RelationshipsResponse = z.infer<typeof RelationshipsResponse>;

export const RelationshipHistoryResponse = z.object({
  ownerId: z.string(),
  aboutId: z.string(),
  /** Cómo ha cambiado lo que `ownerId` piensa de `aboutId` (del más antiguo al más reciente). */
  changes: z.array(SocialProfileChange),
  /** Y lo que `aboutId` piensa de `ownerId`. */
  reciprocal: z.array(SocialProfileChange),
});
export type RelationshipHistoryResponse = z.infer<typeof RelationshipHistoryResponse>;

/** Red del pueblo: agentes y lo que piensa cada uno de cada otro ahora. */
export const SocialGraphResponse = z.object({
  now: z.number(),
  nodes: z.array(z.object({ id: z.string(), name: z.string() })),
  profiles: z.array(SocialProfile),
});
export type SocialGraphResponse = z.infer<typeof SocialGraphResponse>;

/** Historial de toda la red (para el deslizador de tiempo), paginado por `since`. */
export const SocialHistoryResponse = z.object({
  changes: z.array(SocialProfileChange),
  /** `since` para la página siguiente, o null si no hay más. */
  next: z.number().nullable(),
});
export type SocialHistoryResponse = z.infer<typeof SocialHistoryResponse>;

/** Vista Rashomon: cómo recuerda un evento cada agente implicado, y cómo ha cambiado. */
export const RashomonAccount = z.object({
  agentId: z.string(),
  name: z.string(),
  memories: z.array(
    z.object({
      memory: MemoryView,
      clarity: Clarity,
      strength: z.number(),
      versions: z.array(MemoryVersion),
    }),
  ),
});
export type RashomonAccount = z.infer<typeof RashomonAccount>;

export const RashomonResponse = z.object({
  event: SimEvent.nullable(),
  now: z.number(),
  accounts: z.array(RashomonAccount),
});
export type RashomonResponse = z.infer<typeof RashomonResponse>;

export const Chronicle = z.object({
  day: z.number().int(),
  title: z.string(),
  text: z.string(),
});
export type Chronicle = z.infer<typeof Chronicle>;

export const ThoughtRequest = z.object({ text: z.string().min(1).max(500) });
export const SpotStateRequest = z.object({ state: z.string().min(1).max(80) });
export const WeatherRequest = z.object({ weather: Weather });
export type AgentMemoryResponse = z.infer<typeof AgentMemoryResponse>;

export const SetSpeedRequest = z.object({ speed: SimSpeed });
export type SetSpeedRequest = z.infer<typeof SetSpeedRequest>;
