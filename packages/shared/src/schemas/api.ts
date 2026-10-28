import { z } from "zod";
import { AgentState } from "./agent";
import {
  Clarity,
  MemoryAuditEntry,
  MemoryVersion,
  MemoryView,
  ScoredMemoryView,
  SocialProfile,
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
  memories: z.array(ScoredMemoryView),
  /** Decisiones de olvido/transformación recientes ("olvidó X porque..."). */
  audit: z.array(MemoryAuditEntry),
  social: z.array(SocialProfile),
});

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
