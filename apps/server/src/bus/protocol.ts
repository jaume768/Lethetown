import { CostSummary, ServerMessage } from "@lethetown/shared";
import { z } from "zod";
import { WorldCommand } from "../worlds/gateway";

/** Estado vivo de un mundo tal como viaja por el bus (misma forma que `LiveState`). */
const LiveStateMsg = z.object({
  time: z.number(),
  speed: z.number(),
  rate: z.number().optional(),
  agents: z.array(z.unknown()),
  weather: z.string(),
  status: z.unknown(),
  spots: z.array(z.object({ id: z.string(), state: z.string() })),
  workingMemory: z.record(z.string(), z.array(z.string())),
});

/** worker → api. */
export const WorldBusMessage = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("live"), w: z.string(), live: LiveStateMsg }),
  z.object({ kind: z.literal("signal"), w: z.string(), signal: ServerMessage }),
  z.object({
    kind: z.literal("cost"),
    w: z.string(),
    summary: CostSummary,
    unpricedModels: z.array(z.string()),
  }),
]);
export type WorldBusMessage = z.infer<typeof WorldBusMessage>;

/** api → worker. */
export const CommandBusMessage = z.object({
  requestId: z.string(),
  worldId: z.string(),
  cmd: WorldCommand,
});

/** api → workers, cada pocos segundos. */
export const ViewersBusMessage = z.object({
  from: z.string(),
  counts: z.record(z.string(), z.number().int().nonnegative()),
});

/** api → workers. */
export const AdminBusMessage = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("kill"), on: z.boolean() }),
  z.object({ kind: z.literal("budget"), requestId: z.string() }),
]);
