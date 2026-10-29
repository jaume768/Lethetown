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
  Commitment,
  ServerMessage,
  SimEvent,
  SimEventKind,
  TilePoint,
} from "@lethetown/shared";
import type { ChronicleStore, EventStore } from "../db/stores";
import { InMemoryCommitmentStore, type CommitmentStore } from "../db/commitments";
import { InMemoryKnownPlaceStore, type KnownPlaceStore } from "../db/known-places";
import type { GameClock } from "./clock";
import type { WorldMap } from "./world";

export interface Heard {
  fromId: string;
  fromName: string;
  text: string;
  eventId: string;
  /** En un grupo: a quién iba dirigido (si no era a quien lo oye). */
  toName?: string;
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
  /** Última vez que se le avisó de que su plan es al aire libre con mal tiempo ("hora:tiempo"). */
  weatherChecked: string | null;
  /** Bloque del plan ya avisado de que choca con una conversación ("inicio:conversación"). */
  convWarned: string | null;
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
    weatherChecked: null,
    convWarned: null,
  };
}

/** Una conversación de dos o más (un grupo). */
export interface Conversation {
  id: string;
  /** Quienes están en ella, por orden de llegada. */
  members: string[];
  turns: number;
  lastAt: number;
  transcript: string[];
  /** Frases de cada uno a cada otro ("a>b" → n): con quién habló más (fichas sociales). */
  pairs: Record<string, number>;
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
  /** Citas entre agentes (si no se pasa, en RAM). */
  commitments?: CommitmentStore;
  /** Lugares que conoce cada agente (si no se pasa, en RAM). */
  knownPlaces?: KnownPlaceStore;
  /** Radio (baldosas) en que se ven los lugares al pasar (por defecto, 4). */
  discoveryRadius?: number;
  /** Escrituras en segundo plano (para esperarlas al cerrar). */
  track?: (write: Promise<unknown>) => void;
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
  /** Citas vivas (propuestas o aceptadas) y recientes; también en la instantánea. */
  readonly meetings = new Map<string, Commitment>();
  /** Contador de ids cortos de cita ("c1", "c2"…). */
  meetingSeq = 0;
  readonly commitments: CommitmentStore;
  readonly knownPlaces: KnownPlaceStore;
  private readonly eventListeners: ((e: SimEvent) => void)[] = [];
  private readonly signalListeners: ((s: SimSignal) => void)[] = [];

  constructor(readonly deps: SimulationDeps) {
    this.commitments = deps.commitments ?? new InMemoryCommitmentStore();
    this.knownPlaces = deps.knownPlaces ?? new InMemoryKnownPlaceStore();
  }

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
    /** Datos del evento (p. ej. la acción del catálogo y si salió bien). */
    meta?: SimEvent["meta"],
  ): void {
    const event: SimEvent = {
      id,
      time: this.clock.now(),
      agentId,
      kind,
      text,
      participants,
      ...(meta ? { meta } : {}),
    };
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

export function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
