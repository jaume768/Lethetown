import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import {
  AnthropicProvider,
  CostTracker,
  formatGameTime,
  InMemorySocialProfileStore,
  InMemoryStore,
  LLMClient,
  LLMConsolidator,
  LLMEpisodeSummarizer,
  LLMGistCompressor,
  LLMReconsolidator,
  MemoryConfig,
  MemoryMaintenance,
  MemorySystem,
  RandomSourceConfuser,
  seededRng,
  type SocialProfileStore,
  MockProvider,
  ModelRouter,
  OpenAIProvider,
  agentMockResponder,
  type Embedder,
  type LLMProvider,
  type MemoryStore,
  type PricingTable,
} from "@lethetown/agent-core";
import { AgentSeed, SIM_SPEEDS, parseTiledMap, type SimSpeed } from "@lethetown/shared";
import { z } from "zod";
import { modelsFor, type AppConfig } from "./config";
import { checkDb, createDb, type DbHandle } from "./db/client";
import { PgMemoryStore } from "./db/pg-memory-store";
import {
  InMemoryChronicleStore,
  InMemoryEventStore,
  PgChronicleStore,
  PgEventStore,
  PgSocialProfileStore,
  type ChronicleStore,
  type EventStore,
} from "./db/stores";
import { DEFAULT_WORLD_ID, llmCalls } from "./db/schema";
import {
  InMemorySnapshotStore,
  InMemoryWorldRepo,
  PgSnapshotStore,
  PgWorldRepo,
  type SnapshotStore,
  type WorldRepo,
  type WorldRow,
} from "./db/worlds";
import { createEmbedder } from "./embeddings";
import { fromRoot } from "./paths";
import { GameClock } from "./sim/clock";
import { LimitedProvider } from "./sim/llm-queue";
import { Simulation } from "./sim/simulation";
import { parseSnapshot } from "./sim/snapshot";
import { WorldMap } from "./sim/world";

/** Mapa Tiled: fuente única de verdad del mundo (lo genera `pnpm map:generate`). */
export const MAP_FILE = "seeds/town.tmj";

/** Cada cuántos minutos de juego se guarda una instantánea. */
const SNAPSHOT_EVERY = 60;

/** La simulación arranca a las 06:50 del día 0 (o al día siguiente del último recuerdo guardado). */
const START_MINUTE_OF_DAY = 6 * 60 + 50;

/** Servicios compartidos por todos los mundos de un proceso. */
export interface Services {
  config: AppConfig;
  provider: LimitedProvider;
  models: { fast: string; reflection: string };
  pricing: PricingTable;
  embedder: Embedder;
  memoryConfig: MemoryConfig;
  seeds: AgentSeed[];
  db?: DbHandle;
  storeKind: "postgres" | "memory";
  worldRepo: WorldRepo;
  snapshots: SnapshotStore;
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
  costs: CostTracker;
  /** Instante de juego de la instantánea restaurada (null = arranque limpio). */
  restoredFrom: number | null;
  /** Programa la simulación y las instantáneas horarias (no arranca el reloj real). */
  start(): void;
  saveSnapshot(reason: string): Promise<void>;
  /** Guarda una instantánea de apagado y para el reloj. */
  close(): Promise<void>;
}

export interface App extends Services {
  worlds: Map<string, WorldRuntime>;
  defaultWorld: WorldRuntime;
  close(): Promise<void>;
}

async function readJson<T>(schema: z.ZodType<T>, file: string): Promise<T> {
  return schema.parse(JSON.parse(await readFile(fromRoot(file), "utf8")));
}

export async function loadPricing(): Promise<PricingTable> {
  const Pricing = z.object({
    models: z.record(
      z.string(),
      z.object({
        input: z.number(),
        output: z.number(),
        cacheRead: z.number(),
        cacheWrite: z.number(),
      }),
    ),
  });
  return (await readJson(Pricing, "config/pricing.json")).models;
}

/** Config de memoria: valores por defecto + config/memory.json si existe. */
export async function loadMemoryConfig(log: (msg: string) => void): Promise<MemoryConfig> {
  const file = "config/memory.json";
  if (!existsSync(fromRoot(file))) return MemoryConfig.parse({});
  log(`Config de memoria: ${file}`);
  return readJson(MemoryConfig, file);
}

export function createProvider(config: AppConfig): LLMProvider {
  switch (config.LLM_PROVIDER) {
    case "mock":
      return new MockProvider(agentMockResponder);
    case "anthropic":
      return new AnthropicProvider({ apiKey: config.ANTHROPIC_API_KEY });
    case "openai":
      if (!config.OPENAI_API_KEY)
        throw new Error("LLM_PROVIDER=openai requiere OPENAI_API_KEY en .env");
      return new OpenAIProvider({ apiKey: config.OPENAI_API_KEY });
  }
}

async function connectDb(
  config: AppConfig,
  log: (msg: string) => void,
): Promise<DbHandle | undefined> {
  if (!config.DATABASE_URL) {
    log("DATABASE_URL vacía: uso almacén en RAM (se pierde al reiniciar).");
    return undefined;
  }
  const db = createDb(config.DATABASE_URL);
  const status = await checkDb(db);
  if (!status.ok) {
    log(`⚠ Postgres no disponible (${status.reason}). Uso almacén en RAM.`);
    await db.pool.end().catch(() => {});
    return undefined;
  }
  log("Conectado a Postgres + pgvector.");
  return db;
}

export async function createServices(
  config: AppConfig,
  log: (msg: string) => void,
): Promise<Services> {
  const [seeds, pricing] = await Promise.all([
    readJson(z.array(AgentSeed), "seeds/agents.json"),
    loadPricing(),
  ]);
  const provider = new LimitedProvider(createProvider(config), config.LLM_CONCURRENCY);
  const models = modelsFor(config);
  log(`Proveedor LLM: ${provider.name} (fast=${models.fast}, reflection=${models.reflection})`);
  const db = await connectDb(config, log);
  const embedder = await createEmbedder(config, log);
  log(`Embeddings: ${embedder.name}`);
  const pending = new Set<Promise<unknown>>();
  return {
    config,
    provider,
    models,
    pricing,
    embedder,
    memoryConfig: await loadMemoryConfig(log),
    seeds,
    db,
    storeKind: db ? "postgres" : "memory",
    worldRepo: db ? new PgWorldRepo(db.db) : new InMemoryWorldRepo(),
    snapshots: db ? new PgSnapshotStore(db.db) : new InMemorySnapshotStore(),
    log,
    track(write) {
      const p = write.finally(() => pending.delete(p));
      pending.add(p);
    },
    async flush() {
      await Promise.all(pending);
    },
  };
}

/** Ruta de mapa segura: solo .tmj dentro de seeds/ (la ruta sale de la BD o de la API). */
export function safeMapPath(map: string): string {
  if (!/^seeds\/[\w-]+\.tmj$/.test(map)) throw new Error(`Mapa no permitido: ${map}`);
  return map;
}

/** Crea el runtime de un mundo y, si hay una instantánea, restaura su estado. */
export async function openWorld(services: Services, row: WorldRow): Promise<WorldRuntime> {
  const { config, db, log } = services;
  const worldLog = (msg: string) => log(`[${row.id}] ${msg}`);
  const tmj = await readJson(z.unknown(), safeMapPath(row.map));
  const worldMap = new WorldMap(parseTiledMap(tmj));
  const costs = new CostTracker(services.pricing);
  const llm = new LLMClient(services.provider, new ModelRouter(services.models), costs);
  if (db) {
    costs.onRecord((r) =>
      services.track(
        db.db
          .insert(llmCalls)
          .values({
            worldId: row.id,
            model: r.model,
            task: r.task,
            agentId: r.agentId ?? null,
            usd: r.usd,
            ...r.usage,
          })
          .catch((e: unknown) => worldLog(`⚠ No se pudo guardar el coste: ${String(e)}`)),
      ),
    );
  }
  const store: MemoryStore = db ? new PgMemoryStore(db.db, row.id) : new InMemoryStore();
  const memoryConfig = services.memoryConfig;
  const rng = seededRng(row.seed ?? config.SIM_SEED ?? Date.now());
  const memory = new MemorySystem({
    store,
    embedder: services.embedder,
    config: memoryConfig,
    reconsolidator: new LLMReconsolidator(llm),
    rng,
  });
  const social: SocialProfileStore = db
    ? new PgSocialProfileStore(db.db, row.id)
    : new InMemorySocialProfileStore();
  const events: EventStore = db ? new PgEventStore(db.db, row.id) : new InMemoryEventStore();
  const chronicles: ChronicleStore = db
    ? new PgChronicleStore(db.db, row.id)
    : new InMemoryChronicleStore();
  const seeds = services.seeds;
  const names = () => seeds.map((s) => ({ id: s.id, name: s.name }));
  const maintenance = new MemoryMaintenance({
    memory,
    gist: new LLMGistCompressor(llm),
    confuser: new RandomSourceConfuser(rng, memoryConfig.sourceConfusion.toLivedShare),
    summarizer: new LLMEpisodeSummarizer(llm),
    onError: (task, e) => worldLog(`⚠ Error en "${task}": ${String(e)}`),
  });

  const saved = await services.snapshots.latest(row.id);
  const snapshot = saved ? parseSnapshot(saved.data) : null;
  if (saved && !snapshot) worldLog("⚠ Instantánea de otra versión o corrupta: se ignora.");
  const speed: SimSpeed =
    snapshot?.speed ??
    (SIM_SPEEDS.includes(config.SIM_SPEED as SimSpeed) ? (config.SIM_SPEED as SimSpeed) : 10);
  const startTime = snapshot?.time ?? (await resumeTime(store));
  const clock = new GameClock(startTime, speed, (e) => worldLog(`⚠ Error en evento: ${String(e)}`));
  const sim = new Simulation({
    world: worldMap,
    seeds,
    llm,
    memory,
    clock,
    tickMinutes: config.SIM_TICK_MINUTES,
    walkSpeed: config.SIM_WALK_TILES_PER_MINUTE,
    social,
    events,
    chronicles,
    consolidator: new LLMConsolidator(llm, memory, social, names),
    maintenance,
    rng,
  });
  sim.onEvent((e) =>
    services.track(
      events
        .add(e)
        .catch((err: unknown) => worldLog(`⚠ No se pudo guardar el evento: ${String(err)}`)),
    ),
  );
  const seeded = await sim.seedMemoriesIfEmpty(startTime);
  if (seeded) worldLog(`Sembrados los recuerdos iniciales de ${seeded} agentes.`);
  if (snapshot) {
    sim.restore(snapshot);
    worldLog(`Estado restaurado de la instantánea de ${formatGameTime(snapshot.time)}.`);
  }

  const saveSnapshot = (reason: string) =>
    services.snapshots.save(row.id, clock.now(), reason, sim.snapshot());
  const scheduleHourly = (from: number) => {
    const next = (Math.floor(from / SNAPSHOT_EVERY) + 1) * SNAPSHOT_EVERY;
    clock.schedule(next, () => {
      // La foto se toma ya (síncrona); la escritura no frena el reloj.
      services.track(
        saveSnapshot("hourly").catch((e: unknown) =>
          worldLog(`⚠ No se pudo guardar la instantánea: ${String(e)}`),
        ),
      );
      scheduleHourly(next);
    });
  };

  return {
    id: row.id,
    name: row.name,
    tmj,
    world: worldMap,
    sim,
    clock,
    memory,
    llm,
    social,
    events,
    chronicles,
    costs,
    restoredFrom: snapshot?.time ?? null,
    start() {
      sim.start();
      scheduleHourly(clock.now());
    },
    saveSnapshot,
    async close() {
      clock.stop();
      await saveSnapshot("shutdown").catch((e: unknown) =>
        worldLog(`⚠ No se pudo guardar la instantánea de apagado: ${String(e)}`),
      );
    },
  };
}

/**
 * Arranca los servicios y los mundos. `worldIds` limita qué mundos se abren (por defecto,
 * todos los que no están parados; si no hay ninguno, se crea el mundo por defecto).
 */
export async function bootstrap(
  config: AppConfig,
  log: (msg: string) => void,
  opts: { worldIds?: string[] } = {},
): Promise<App> {
  const services = await createServices(config, log);
  const defaultRow = await services.worldRepo.ensureDefault(MAP_FILE, config.SIM_SEED ?? null);
  const rows = (await services.worldRepo.list()).filter((w) =>
    opts.worldIds ? opts.worldIds.includes(w.id) : w.status !== "stopped",
  );
  if (!rows.some((r) => r.id === defaultRow.id) && !opts.worldIds) rows.unshift(defaultRow);
  const worlds = new Map<string, WorldRuntime>();
  for (const row of rows) worlds.set(row.id, await openWorld(services, row));
  const defaultWorld = worlds.get(DEFAULT_WORLD_ID) ?? [...worlds.values()][0];
  if (!defaultWorld) throw new Error("No hay ningún mundo que abrir");
  return {
    ...services,
    worlds,
    defaultWorld,
    async close() {
      for (const w of worlds.values()) await w.close();
      await services.flush();
      await services.db?.pool.end();
    },
  };
}

async function resumeTime(store: MemoryStore): Promise<number> {
  const latest = store instanceof PgMemoryStore ? await store.latestGameTime() : 0;
  // Los recuerdos sembrados llevan la hora de inicio: solo reanudamos si hubo simulación real.
  if (latest <= START_MINUTE_OF_DAY) return START_MINUTE_OF_DAY;
  return (Math.floor(latest / 1440) + 1) * 1440 + START_MINUTE_OF_DAY;
}
