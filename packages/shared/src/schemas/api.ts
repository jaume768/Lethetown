import { z } from "zod";
import { AgentState } from "./agent";
import { ScoredMemoryView } from "./memory";
import { SimSpeed, World } from "./world";

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

export const SimEvent = z.object({
  id: z.string(),
  time: z.number(),
  agentId: z.string().nullable(),
  kind: z.enum(["action", "speech", "observation", "plan", "system"]),
  text: z.string(),
});
export type SimEvent = z.infer<typeof SimEvent>;

export const ClockState = z.object({
  time: z.number(),
  speed: SimSpeed,
});
export type ClockState = z.infer<typeof ClockState>;

export const WorldSnapshot = z.object({
  world: World,
  clock: ClockState,
  agents: z.array(AgentState),
  provider: z.string(),
});
export type WorldSnapshot = z.infer<typeof WorldSnapshot>;

export const AgentMemoryResponse = z.object({
  agentId: z.string(),
  now: z.number(),
  workingMemory: z.array(z.string()),
  memories: z.array(ScoredMemoryView),
});
export type AgentMemoryResponse = z.infer<typeof AgentMemoryResponse>;

export const SetSpeedRequest = z.object({ speed: SimSpeed });
export type SetSpeedRequest = z.infer<typeof SetSpeedRequest>;
