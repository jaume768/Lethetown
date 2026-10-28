import type { MemorySystem, SocialProfileStore } from "@lethetown/agent-core";
import {
  SimSpeed,
  Weather,
  type AgentState,
  type Chronicle,
  type CostSummary,
  type World,
  type WorldRunStatus,
} from "@lethetown/shared";
import { z } from "zod";
import type { WorldRuntime } from "../bootstrap";
import type { ChronicleStore, EventStore } from "../db/stores";
import type { SimSignal } from "../sim/simulation";

/** Órdenes que cambian un mundo. Las ejecuta quien tenga la simulación (este proceso o el worker). */
export const WorldCommand = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("thought"),
    agentId: z.string(),
    text: z.string(),
    userId: z.string().nullable(),
  }),
  z.object({
    type: z.literal("spot"),
    spotId: z.string(),
    state: z.string(),
    userId: z.string().nullable(),
  }),
  z.object({ type: z.literal("weather"), weather: Weather }),
  z.object({ type: z.literal("speed"), speed: SimSpeed }),
  z.object({ type: z.literal("chronicle"), day: z.number().int().nonnegative() }),
  z.object({ type: z.literal("pause") }),
  z.object({ type: z.literal("resume") }),
]);
export type WorldCommand = z.infer<typeof WorldCommand>;

export type CommandResult =
  { ok: true; value?: unknown } | { ok: false; status: number; error: string };

/** Estado vivo de un mundo (lo que se manda por WS cada medio segundo). */
export interface LiveState {
  time: number;
  speed: SimSpeed;
  agents: AgentState[];
  weather: Weather;
  status: WorldRunStatus;
  /** Estado de los objetos (el resto del mapa es fijo). */
  spots: { id: string; state: string }[];
  /** Memoria de trabajo por agente (para el inspector). */
  workingMemory: Record<string, string[]>;
}

/** Lo que la API necesita de un mundo, venga de una simulación local o de un worker remoto. */
export interface WorldGateway {
  readonly id: string;
  readonly name: string;
  readonly tmj: unknown;
  readonly world: World;
  live(): LiveState;
  memory: MemorySystem;
  social: SocialProfileStore;
  events: EventStore;
  chronicles: ChronicleStore;
  costs(): CostSummary & { unpricedModels: string[] };
  command(cmd: WorldCommand): Promise<CommandResult>;
  onSignal(listener: (s: SimSignal | { type: "cost"; summary: CostSummary }) => void): () => void;
}

const notFound = (what: string): CommandResult => ({ ok: false, status: 404, error: what });

/** Ejecuta una orden sobre un mundo que corre en este proceso. */
export async function runCommand(w: WorldRuntime, cmd: WorldCommand): Promise<CommandResult> {
  switch (cmd.type) {
    case "thought": {
      if (!w.sim.agents.has(cmd.agentId)) return notFound("Agente no encontrado");
      const vetted = await w.vetUserText("thought", cmd.text, cmd.userId);
      if (!vetted.ok) return { ok: false, status: 422, error: vetted.error };
      w.sim.injectThought(cmd.agentId, vetted.text);
      return { ok: true };
    }
    case "spot": {
      if (!w.world.spot(cmd.spotId)) return notFound("Objeto no encontrado");
      const vetted = await w.vetUserText("spot", cmd.state, cmd.userId);
      if (!vetted.ok) return { ok: false, status: 422, error: vetted.error };
      w.sim.setSpotState(cmd.spotId, vetted.text);
      return { ok: true };
    }
    case "weather":
      w.sim.setWeather(cmd.weather);
      return { ok: true };
    case "speed": {
      const st = w.status();
      if (st.state === "paused" && cmd.speed > 0) {
        // Cambiar la velocidad de un mundo pausado equivale a reanudarlo.
        const r = w.resume();
        if (!r.ok) return { ok: false, status: 409, error: r.error };
      }
      w.clock.setSpeed(cmd.speed);
      return { ok: true, value: { time: w.clock.now(), speed: w.clock.speed } };
    }
    case "pause":
      w.pause("manual", "Pausado por un director");
      return { ok: true };
    case "resume": {
      const r = w.resume();
      return r.ok ? { ok: true } : { ok: false, status: 409, error: r.error };
    }
    case "chronicle": {
      const c: Chronicle | null = await w.sim.writeChronicle(cmd.day);
      return c ? { ok: true, value: c } : { ok: false, status: 500, error: "no se pudo generar" };
    }
  }
}

export function liveState(w: WorldRuntime): LiveState {
  return {
    time: w.clock.now(),
    speed: w.clock.speed,
    agents: w.sim.agentStates(),
    weather: w.world.weather,
    status: w.status(),
    spots: w.world.places.flatMap((p) => p.objects.map((o) => ({ id: o.id, state: o.state }))),
    workingMemory: Object.fromEntries(
      [...w.sim.agents.values()].map((a) => [a.id, a.workingMemory.contents.map((i) => i.text)]),
    ),
  };
}

/** Gateway de un mundo que corre en este mismo proceso (modo `pnpm dev` todo en uno). */
export class LocalWorldGateway implements WorldGateway {
  constructor(private readonly w: WorldRuntime) {}

  get id() {
    return this.w.id;
  }
  get name() {
    return this.w.name;
  }
  get tmj() {
    return this.w.tmj;
  }
  get world() {
    return this.w.world.world;
  }
  get memory() {
    return this.w.memory;
  }
  get social() {
    return this.w.social;
  }
  get events() {
    return this.w.events;
  }
  get chronicles() {
    return this.w.chronicles;
  }

  live() {
    return liveState(this.w);
  }

  costs() {
    return { ...this.w.costs.summary(), unpricedModels: [...this.w.costs.unpricedModels] };
  }

  command(cmd: WorldCommand) {
    return runCommand(this.w, cmd);
  }

  onSignal(listener: (s: SimSignal | { type: "cost"; summary: CostSummary }) => void) {
    return this.w.sim.onSignal(listener);
  }
}
