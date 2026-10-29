import { randomUUID } from "node:crypto";
import type {
  Agent,
  Consolidator,
  LLMClient,
  MemoryMaintenance,
  MemorySystem,
  Perception,
  PromptLanguage,
  Rng,
  SocialProfileStore,
} from "@lethetown/agent-core";
import type {
  ActivityKind,
  AgentSeed,
  ServerMessage,
  SimEvent,
  SimEventKind,
  TilePoint,
} from "@lethetown/shared";
import type { ChronicleStore, EventStore } from "../db/stores";
import type { GameClock } from "./clock";
import type { WorldMap } from "./world";

export interface Heard {
  fromId: string;
  fromName: string;
  text: string;
  eventId: string;
}

/** Llegada pendiente de un viaje (se reprograma al restaurar una instantánea). */
export interface Arrival {
  destId: string;
  goal: TilePoint;
  thenAction: string;
  thenKind: ActivityKind;
  at: number;
}

/** Estado de simulación de un agente que no forma parte de su `AgentState`. */
export interface Runtime {
  travelling: boolean;
  arrival: Arrival | null;
  plannedDay: number;
  /** Quién estaba en el mismo lugar en el último tick (para detectar llegadas). */
  seenHere: Set<string>;
  /** Frases dirigidas a este agente. */
  inbox: Heard[];
  /** Otras percepciones pendientes (oído a escondidas, voz interior, cambios del mundo). */
  pending: Perception[];
  /** Estado de los objetos que ya conoce (para notar cambios). */
  knownStates: Map<string, string>;
  /** Hasta cuándo prevalece una reacción/conversación sobre el plan. */
  overrideUntil: number;
  utteredAt: number;
  lastMaintenance: number;
  /** Instante de la última consolidación (los recuerdos posteriores entran en la siguiente). */
  lastConsolidation: number;
  consolidatedNight: number;
}

export function newRuntime(): Runtime {
  return {
    travelling: false,
    arrival: null,
    plannedDay: -1,
    seenHere: new Set(),
    inbox: [],
    pending: [],
    knownStates: new Map(),
    overrideUntil: 0,
    utteredAt: -Infinity,
    lastMaintenance: -Infinity,
    lastConsolidation: 0,
    consolidatedNight: -1,
  };
}

export interface Conversation {
  id: string;
  a: string;
  b: string;
  turns: number;
  lastAt: number;
  transcript: string[];
}

export interface SimulationDeps {
  world: WorldMap;
  seeds: AgentSeed[];
  llm: LLMClient;
  memory: MemorySystem;
  clock: GameClock;
  tickMinutes: number;
  /** Velocidad de paseo en baldosas por minuto de juego. */
  walkSpeed: number;
  social: SocialProfileStore;
  events: EventStore;
  chronicles: ChronicleStore;
  consolidator?: Consolidator;
  maintenance?: MemoryMaintenance;
  rng: Rng;
  /** Idioma de los agentes y del cronista. */
  language?: PromptLanguage;
  /** Modo demostración: minutos de juego entre sucesos (sin definir = apagado). */
  demoEveryMinutes?: number;
}

/** Señales que la simulación emite hacia los clientes (además de los eventos del log). */
export type SimSignal = Extract<
  ServerMessage,
  { type: "event" | "thinking" | "memory_effect" | "chronicle" | "world" | "status" | "drama" }
>;

/**
 * Estado compartido por los módulos de la simulación (percepción, conversaciones, rutinas,
 * mantenimiento e intervención): dependencias, agentes, runtime y emisión de eventos.
 */
export class SimContext {
  readonly agents = new Map<string, Agent>();
  readonly runtime = new Map<string, Runtime>();
  readonly conversations = new Map<string, Conversation>();
  private readonly eventListeners: ((e: SimEvent) => void)[] = [];
  private readonly signalListeners: ((s: SimSignal) => void)[] = [];

  constructor(readonly deps: SimulationDeps) {}

  get clock(): GameClock {
    return this.deps.clock;
  }

  get world(): WorldMap {
    return this.deps.world;
  }

  rt(agentId: string): Runtime {
    return this.runtime.get(agentId)!;
  }

  onEvent(listener: (e: SimEvent) => void): () => void {
    this.eventListeners.push(listener);
    return () => remove(this.eventListeners, listener);
  }

  onSignal(listener: (s: SimSignal) => void): () => void {
    this.signalListeners.push(listener);
    return () => remove(this.signalListeners, listener);
  }

  signal(s: SimSignal): void {
    for (const l of this.signalListeners) l(s);
  }

  emit(
    kind: SimEventKind,
    agentId: string | null,
    text: string,
    participants: string[] = [],
    id: string = randomUUID(),
  ): void {
    const event: SimEvent = { id, time: this.clock.now(), agentId, kind, text, participants };
    for (const l of this.eventListeners) l(event);
    this.signal({ type: "event", event });
  }

  /** Avisa a los clientes del estado de los objetos y el clima. */
  signalWorld(): void {
    this.signal({
      type: "world",
      weather: this.world.weather,
      spots: this.world.places.flatMap((p) => p.objects.map((o) => ({ id: o.id, state: o.state }))),
    });
  }
}

function remove<T>(list: T[], item: T): void {
  const i = list.indexOf(item);
  if (i >= 0) list.splice(i, 1);
}

export function convKey(a: string, b: string): string {
  return [a, b].sort().join("|");
}

export function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
