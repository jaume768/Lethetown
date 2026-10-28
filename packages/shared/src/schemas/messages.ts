import { z } from "zod";
import { AgentState } from "./agent";
import { Chronicle, ClockState, CostSummary, SimEvent, WorldRunStatus, WorldSnapshot } from "./api";
import { SimSpeed, Weather } from "./world";

/** Mensajes servidor → cliente por WebSocket. */
export const ServerMessage = z.discriminatedUnion("type", [
  z.object({ type: z.literal("snapshot"), snapshot: WorldSnapshot }),
  z.object({ type: z.literal("tick"), clock: ClockState, agents: z.array(AgentState) }),
  z.object({ type: z.literal("event"), event: SimEvent }),
  z.object({ type: z.literal("cost"), summary: CostSummary }),
  /** Llamada al LLM en curso para un agente (indicador "pensando"). */
  z.object({
    type: z.literal("thinking"),
    agentId: z.string(),
    task: z.string(),
    phase: z.enum(["start", "end"]),
  }),
  /** Efecto visual de memoria: destello al recordar, nube "…" si es vago, partículas al olvidar. */
  z.object({
    type: z.literal("memory_effect"),
    agentId: z.string(),
    memoryId: z.string(),
    kind: z.enum(["recall", "vague", "forget", "gist", "reconsolidate", "consolidate", "archive"]),
    text: z.string(),
  }),
  z.object({ type: z.literal("chronicle"), chronicle: Chronicle }),
  /** El mundo se pausó o se reanudó (presupuesto, kill switch, sin espectadores, manual). */
  z.object({ type: z.literal("status"), status: WorldRunStatus }),
  /** Cambio del estado del mundo (tiempo, objetos). */
  z.object({
    type: z.literal("world"),
    weather: Weather,
    spots: z.array(z.object({ id: z.string(), state: z.string() })),
  }),
]);
export type ServerMessage = z.infer<typeof ServerMessage>;

/** Mensajes cliente → servidor por WebSocket. */
export const ClientMessage = z.discriminatedUnion("type", [
  z.object({ type: z.literal("setSpeed"), speed: SimSpeed }),
  z.object({ type: z.literal("requestSnapshot") }),
]);
export type ClientMessage = z.infer<typeof ClientMessage>;
