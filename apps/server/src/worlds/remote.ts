import { MemorySystem, profilesFor } from "@lethetown/agent-core";
import { PgCommitmentStore } from "../db/commitments";
import { PgKnownPlaceStore } from "../db/known-places";
import { PgItemStore } from "../db/items";
import {
  AgentState,
  RUNNING,
  SimSpeed,
  Weather,
  WorldRunStatus,
  parseTiledMap,
  type CostSummary,
} from "@lethetown/shared";
import type { Services } from "../bootstrap";
import { CHANNELS, type Bus } from "../bus/pg-bus";
import { WorldBusMessage } from "../bus/protocol";
import { PgMemoryStore } from "../db/pg-memory-store";
import { PgChronicleStore, PgDramaStore, PgEventStore, PgSocialProfileStore } from "../db/stores";
import type { WorldRow } from "../db/worlds";
import { parseSnapshot } from "../sim/snapshot";
import type { SimSignal } from "../sim/simulation";
import { WorldMap } from "../sim/world";
import type { CommandResult, LiveState, WorldCommand, WorldGateway } from "./gateway";

const COMMAND_TIMEOUT_MS = 15_000;
/**
 * El estado vivo del worker llega cada medio segundo; entre medias se extrapola el reloj (si no,
 * se mandaría a los clientes un tiempo atrasado). Más allá de este margen no se extrapola: el
 * worker pudo pararse.
 */
const MAX_EXTRAPOLATION_MS = 5_000;

const emptyCosts = (): CostSummary => ({
  total: {
    calls: 0,
    usd: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  },
  byAgent: {},
  byTask: {},
  byModel: {},
});

type Listener = (s: SimSignal | { type: "cost"; summary: CostSummary }) => void;

/**
 * Un mundo que corre en un sim-worker: el estado vivo, las señales y los costes llegan por el
 * bus; las lecturas de memoria, eventos y crónicas van directas a Postgres; las órdenes se
 * mandan al worker y se espera su respuesta.
 */
export class RemoteWorldGateway implements WorldGateway {
  readonly id: string;
  readonly name: string;
  readonly memory: MemorySystem;
  readonly social: PgSocialProfileStore;
  readonly events: PgEventStore;
  readonly chronicles: PgChronicleStore;
  readonly dramas: PgDramaStore;
  readonly commitments: PgCommitmentStore;
  readonly knownPlaces: PgKnownPlaceStore;
  readonly items: PgItemStore;
  private readonly map: WorldMap;
  private state: LiveState;
  /** Date.now() al recibir el último estado vivo. */
  private stateAt = Date.now();
  private costSummary = emptyCosts();
  private unpriced: string[] = [];
  private readonly listeners = new Set<Listener>();

  private constructor(
    row: WorldRow,
    readonly tmj: unknown,
    services: Services,
    private readonly bus: Bus,
    initial: LiveState,
  ) {
    const db = services.db!.db;
    this.id = row.id;
    this.name = row.name;
    this.map = new WorldMap(parseTiledMap(tmj));
    this.memory = new MemorySystem({
      store: new PgMemoryStore(db, row.id),
      embedder: services.embedder,
      config: services.memoryConfig,
      profiles: profilesFor(services.seeds, services.memoryConfig.profile),
    });
    this.social = new PgSocialProfileStore(db, row.id);
    this.events = new PgEventStore(db, row.id);
    this.chronicles = new PgChronicleStore(db, row.id);
    this.dramas = new PgDramaStore(db, row.id);
    this.commitments = new PgCommitmentStore(db, row.id);
    this.knownPlaces = new PgKnownPlaceStore(db, row.id);
    this.items = new PgItemStore(db, row.id);
    this.state = initial;
    this.applySpots(initial.spots);
  }

  /** Arranca con la última instantánea del mundo (hasta que el worker publique su estado). */
  static async open(
    row: WorldRow,
    tmj: unknown,
    services: Services,
    bus: Bus,
  ): Promise<RemoteWorldGateway> {
    const saved = await services.snapshots.latest(row.id);
    const snap = saved ? parseSnapshot(saved.data) : null;
    const initial: LiveState = {
      time: snap?.time ?? 0,
      speed: 0,
      agents: snap?.agents.map((a) => a.state) ?? [],
      weather: snap?.weather ?? "sunny",
      status: { state: "paused", reason: null, detail: "Esperando al simulador…" },
      spots: snap?.spots ?? [],
      workingMemory: Object.fromEntries(
        snap?.agents.map((a) => [a.id, a.workingMemory.map((i) => i.text)]) ?? [],
      ),
    };
    const gw = new RemoteWorldGateway(row, tmj, services, bus, initial);
    await bus.subscribe(CHANNELS.world, (raw) => gw.onBusMessage(raw));
    return gw;
  }

  get world() {
    return this.map.world;
  }

  live(): LiveState {
    const elapsed = Math.min(MAX_EXTRAPOLATION_MS, Math.max(0, Date.now() - this.stateAt));
    const running = this.state.status.state === "running";
    const time = running
      ? this.state.time + (elapsed / 60_000) * this.state.speed
      : this.state.time;
    return { ...this.state, time };
  }

  costs() {
    return { ...this.costSummary, unpricedModels: this.unpriced };
  }

  async command(cmd: WorldCommand): Promise<CommandResult> {
    try {
      return await this.bus.request<CommandResult>(
        CHANNELS.command,
        { worldId: this.id, cmd },
        COMMAND_TIMEOUT_MS,
      );
    } catch (error) {
      return {
        ok: false,
        status: 503,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  onSignal(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private onBusMessage(raw: unknown) {
    const parsed = WorldBusMessage.safeParse(raw);
    if (!parsed.success || parsed.data.w !== this.id) return;
    const msg = parsed.data;
    if (msg.kind === "live") {
      const l = msg.live;
      this.stateAt = Date.now();
      this.state = {
        time: l.time,
        speed: SimSpeed.catch(0).parse(l.speed),
        agents: l.agents.flatMap((a) => {
          const p = AgentState.safeParse(a);
          return p.success ? [p.data] : [];
        }),
        weather: Weather.catch("sunny").parse(l.weather),
        status: WorldRunStatus.catch(RUNNING).parse(l.status),
        spots: l.spots,
        workingMemory: l.workingMemory,
      };
      this.applySpots(l.spots);
      return;
    }
    if (msg.kind === "cost") {
      this.costSummary = msg.summary;
      this.unpriced = msg.unpricedModels;
      for (const l of this.listeners) l({ type: "cost", summary: msg.summary });
      return;
    }
    const signal = msg.signal;
    if (signal.type === "status") this.state = { ...this.state, status: signal.status };
    if (signal.type === "world") this.applySpots(signal.spots);
    if (
      signal.type === "event" ||
      signal.type === "thinking" ||
      signal.type === "memory_effect" ||
      signal.type === "chronicle" ||
      signal.type === "world" ||
      signal.type === "status" ||
      signal.type === "drama"
    ) {
      for (const l of this.listeners) l(signal);
    }
  }

  private applySpots(spots: { id: string; state: string }[]) {
    for (const s of spots) if (this.map.spot(s.id)) this.map.setSpotState(s.id, s.state);
  }
}
