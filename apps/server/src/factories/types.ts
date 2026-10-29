/** Tipos compartidos del arranque: servicios del proceso y runtime de cada mundo. */
import type {
  CostTracker,
  LLMClient,
  MemoryConfig,
  MemorySystem,
  ResilientProvider,
} from "@lethetown/agent-core";
import {
  type SocialProfileStore,
  type Embedder,
  type LLMProvider,
  type PricingTable,
} from "@lethetown/agent-core";
import type { AgentSeed } from "@lethetown/shared";
import { type WorldRunStatus } from "@lethetown/shared";
import { type AppConfig } from "../config";
import { type SessionStore, type UserStore } from "../security/auth";
import { type DbHandle } from "../db/client";
import {
  type DramaStore,
  type ModerationLog,
  type ChronicleStore,
  type EventStore,
} from "../db/stores";
import { type SnapshotStore, type WorldRepo } from "../db/worlds";
import type { Metrics } from "../observability";
import type { CommitmentStore } from "../db/commitments";
import type { KnownPlaceStore } from "../db/known-places";
import type { ItemStore } from "../db/items";
import type { NoteStore } from "../db/notes";
import type { RetentionConfig, RetentionReport } from "../retention";
import type { GameClock } from "../sim/clock";
import type { LimitedProvider } from "../sim/llm-queue";
import type { Simulation } from "../sim/simulation";
import type { BudgetGuard } from "../security/budget";
import type { WorldMap } from "../sim/world";

/** Servicios compartidos por todos los mundos de un proceso. */
export interface Services {
  config: AppConfig;
  /** Proveedor compartido: lotes → cola de concurrencia → reintentos/breaker → API. */
  provider: LLMProvider;
  /** La cola de concurrencia (para métricas: llamadas activas y en espera). */
  llmQueue: LimitedProvider;
  /** El decorador de reintentos (para el estado del circuit breaker). */
  llmResilience: ResilientProvider;
  /** Lo fija bootstrap: ¿se puede usar la Batch API ahora? (según la velocidad de los mundos). */
  setBatchGate(gate: () => boolean): void;
  models: { fast: string; reflection: string };
  pricing: PricingTable;
  embedder: Embedder;
  memoryConfig: MemoryConfig;
  /** Política de retención de datos (ver retention.ts). */
  retention: RetentionConfig;
  seeds: AgentSeed[];
  db?: DbHandle;
  storeKind: "postgres" | "memory";
  worldRepo: WorldRepo;
  snapshots: SnapshotStore;
  budget: BudgetGuard;
  moderationLog: ModerationLog;
  metrics: Metrics;
  users: UserStore;
  sessions: SessionStore;
  log: (msg: string) => void;
  /** Escrituras a la BD en vuelo (se esperan al cerrar). */
  track(write: Promise<unknown>): void;
  flush(): Promise<void>;
}

/** Un mundo en ejecución: su mapa, reloj, simulación y almacenes (todos filtrados por mundo). */
export interface WorldRuntime {
  id: string;
  name: string;
  /** El .tmj tal cual, para que el cliente lo pinte. */
  tmj: unknown;
  world: WorldMap;
  sim: Simulation;
  clock: GameClock;
  memory: MemorySystem;
  llm: LLMClient;
  social: SocialProfileStore;
  events: EventStore;
  chronicles: ChronicleStore;
  dramas: DramaStore;
  costs: CostTracker;
  /** Instante de juego de la instantánea restaurada (null = arranque limpio). */
  restoredFrom: number | null;
  status(): WorldRunStatus;
  /** Pausa el mundo (velocidad 0) recordando la velocidad anterior. */
  pause(reason: NonNullable<WorldRunStatus["reason"]>, detail: string): void;
  /** Reanuda; falla si el presupuesto o el kill switch lo impiden. */
  resume(): { ok: true } | { ok: false; error: string };
  /**
   * Sanea y modera un texto de usuario. Si se rechaza, lo registra y devuelve el motivo.
   */
  vetUserText(
    kind: "thought" | "spot",
    text: string,
    userId: string | null,
    /** Agente al que va dirigido (voz interior), para la protección de menores. */
    agentId?: string,
  ): Promise<{ ok: true; text: string } | { ok: false; error: string }>;
  /** Programa la simulación y las instantáneas horarias (no arranca el reloj real). */
  start(): void;
  saveSnapshot(reason: string): Promise<void>;
  /** Citas de los agentes de este mundo. */
  commitments: CommitmentStore;
  knownPlaces: KnownPlaceStore;
  items: ItemStore;
  notes: NoteStore;
  /** Retención: poda lo más antiguo de este mundo (ver retention.ts). */
  prune(): Promise<RetentionReport>;
  /** Guarda una instantánea de apagado y para el reloj. */
  close(): Promise<void>;
}

export interface App extends Services {
  worlds: Map<string, WorldRuntime>;
  defaultWorld: WorldRuntime;
  close(): Promise<void>;
}
