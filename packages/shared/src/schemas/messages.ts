import { z } from "zod";
import { AgentState } from "./agent";
import { ClockState, CostSummary, SimEvent, WorldSnapshot } from "./api";
import { SimSpeed } from "./world";

/** Mensajes servidor → cliente por WebSocket. */
export const ServerMessage = z.discriminatedUnion("type", [
  z.object({ type: z.literal("snapshot"), snapshot: WorldSnapshot }),
  z.object({ type: z.literal("tick"), clock: ClockState, agents: z.array(AgentState) }),
  z.object({ type: z.literal("event"), event: SimEvent }),
  z.object({ type: z.literal("cost"), summary: CostSummary }),
]);
export type ServerMessage = z.infer<typeof ServerMessage>;

/** Mensajes cliente → servidor por WebSocket. */
export const ClientMessage = z.discriminatedUnion("type", [
  z.object({ type: z.literal("setSpeed"), speed: SimSpeed }),
  z.object({ type: z.literal("requestSnapshot") }),
]);
export type ClientMessage = z.infer<typeof ClientMessage>;
