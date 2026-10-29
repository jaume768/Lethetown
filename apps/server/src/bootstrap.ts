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
  MinorGuard,
  minorsOf,
  profilesFor,
  MemoryMaintenance,
  MemorySystem,
  RandomSourceConfuser,
  seededRng,
  type SocialProfileStore,
  BatchingProvider,
  MockProvider,
  ModelRouter,
  ResilientProvider,
  isBatchCapable,
  moderateUserText,
  hasStrongRomance,
  sanitizeUserText,
  OpenAIProvider,
  agentMockResponder,
  type Embedder,
  type LLMProvider,
  type MemoryStore,
  type PricingTable,
} from "@lethetown/agent-core";
import {
  AgentSeed,
  RUNNING,
  SIM_SPEEDS,
  parseTiledMap,
  type SimSpeed,
  type WorldRunStatus,
} from "@lethetown/shared";
import { z } from "zod";
import { isProduction, modelsFor, type AppConfig } from "./config";
import {
  InMemorySessionStore,
  InMemoryUserStore,
  PgSessionStore,
  PgUserStore,
  type SessionStore,
  type UserStore,
} from "./security/auth";
import { checkDb, createDb, type DbHandle } from "./db/client";
import { PgMemoryStore } from "./db/pg-memory-store";
import {
  InMemoryChronicleStore,
  InMemoryEventStore,
  InMemoryDramaStore,
  InMemoryModerationLog,
  PgDramaStore,
  PgModerationLog,
  type DramaStore,
  type ModerationLog,
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
import { Metrics } from "./observability";
import { GameClock } from "./sim/clock";
import { LimitedProvider } from "./sim/llm-queue";
import { DramaDetector } from "./sim/dramas";
import { Simulation } from "./sim/simulation";
import { parseSnapshot } from "./sim/snapshot";
import { BudgetGuard, BudgetedProvider, describeBreach } from "./security/budget";
import { budgetTotals } from "./worker/shared";
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
  processName = "lethetown",
): Promise<Services> {
  const [seeds, pricing] = await Promise.all([
    readJson(z.array(AgentSeed), "seeds/agents.json"),
    loadPricing(),
  ]);
  const base = createProvider(config);
  const llmResilience = new ResilientProvider(
    base,
    {
      timeoutMs: config.LLM_TIMEOUT_SECONDS * 1000,
      retries: config.LLM_RETRIES,
      baseDelayMs: 500,
      maxDelayMs: 20_000,
      breakerThreshold: config.LLM_BREAKER_THRESHOLD,
      breakerCooldownMs: config.LLM_BREAKER_COOLDOWN_SECONDS * 1000,
    },
    {
      onRetry: ({ attempt, delayMs, error }) =>
        log(`↻ Reintento ${attempt} del LLM en ${delayMs} ms (${String(error)})`),
      onBreaker: (state) => log(`⚡ Circuit breaker del LLM: ${state}`),
    },
  );
  const llmQueue = new LimitedProvider(llmResilience, config.LLM_CONCURRENCY);
  let batchGate: () => boolean = () => false;
  let provider: LLMProvider = llmQueue;
  if (config.LLM_BATCH === "on") {
    if (isBatchCapable(base)) {
      provider = new BatchingProvider(
        llmQueue,
        base,
        {
          tasks: config.LLM_BATCH_TASKS,
          windowMs: 5_000,
          pollMs: config.LLM_BATCH_POLL_SECONDS * 1000,
          maxWaitMs: config.LLM_BATCH_MAX_WAIT_MINUTES * 60_000,
          enabled: () => batchGate(),
        },
        (reason) => log(`⚠ Lote del LLM fallido (${reason}); se repite por la vía normal.`),
      );
      log(`Batch API activa para: ${config.LLM_BATCH_TASKS.join(", ")}`);
    } else {
      log(`⚠ LLM_BATCH=on, pero ${base.name} no admite lotes: se ignora.`);
    }
  }
  const models = modelsFor(config);
  log(`Proveedor LLM: ${provider.name} (fast=${models.fast}, reflection=${models.reflection})`);
  const db = await connectDb(config, log);
  const embedder = await createEmbedder(config, log);
  log(`Embeddings: ${embedder.name}`);
  const pending = new Set<Promise<unknown>>();
  return {
    config,
    provider,
    llmQueue,
    llmResilience,
    setBatchGate: (gate) => {
      batchGate = gate;
    },
    models,
    pricing,
    embedder,
    memoryConfig: await loadMemoryConfig(log),
    seeds,
    db,
    storeKind: db ? "postgres" : "memory",
    worldRepo: db ? new PgWorldRepo(db.db) : new InMemoryWorldRepo(),
    snapshots: db ? new PgSnapshotStore(db.db) : new InMemorySnapshotStore(),
    budget: await createBudget(config, db),
    moderationLog: db ? new PgModerationLog(db.db) : new InMemoryModerationLog(),
    metrics: new Metrics(processName),
    users: db ? new PgUserStore(db.db) : await devUsers(config, log),
    sessions: db ? new PgSessionStore(db.db) : new InMemorySessionStore(),
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

/** Usuarios en RAM; fuera de producción, DEV_ADMIN_PASSWORD crea el admin "admin". */
async function devUsers(config: AppConfig, log: (msg: string) => void): Promise<UserStore> {
  const users = new InMemoryUserStore();
  if (config.DEV_ADMIN_PASSWORD && !isProduction(config)) {
    await users.create({ username: "admin", role: "admin", password: config.DEV_ADMIN_PASSWORD });
    log('Usuario "admin" de desarrollo creado en RAM (DEV_ADMIN_PASSWORD).');
  }
  return users;
}

/** Guardián del presupuesto, con el gasto de hoy y de este mes ya registrado en llm_calls. */
async function createBudget(config: AppConfig, db: DbHandle | undefined): Promise<BudgetGuard> {
  const guard = new BudgetGuard({
    global: { dailyUsd: config.BUDGET_DAILY_USD, monthlyUsd: config.BUDGET_MONTHLY_USD },
    perWorld: {
      dailyUsd: config.WORLD_BUDGET_DAILY_USD,
      monthlyUsd: config.WORLD_BUDGET_MONTHLY_USD,
    },
  });
  if (!db) return guard;
  guard.load(await budgetTotals(db.db));
  return guard;
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
  const provider = new BudgetedProvider(services.provider, services.budget, row.id);
  const llm = new LLMClient(provider, new ModelRouter(services.models), costs);
  costs.onRecord((r) => {
    services.budget.record(row.id, r.usd);
    services.metrics.recordCost(row.id, r);
  });
  llm.onCall((e) => services.metrics.recordCall(row.id, e));
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
  // Protección de menores sobre lo que escribe el LLM; lo descartado va a moderation_log.
  const guard = new MinorGuard({
    minors: minorsOf(services.seeds),
    llm,
    onBlock: (b) => {
      worldLog(`🛡 Descartado (${b.kind}${b.agentId ? `, ${b.agentId}` : ""}): ${b.reason}`);
      services.track(
        services.moderationLog
          .add({
            worldId: row.id,
            userId: null,
            kind: `minor_safety:${b.kind}`,
            text: b.text.slice(0, 1000),
            reason: b.reason,
          })
          .catch((e: unknown) => worldLog(`⚠ No se pudo registrar el descarte: ${String(e)}`)),
      );
    },
  });
  const memory = new MemorySystem({
    store,
    embedder: services.embedder,
    config: memoryConfig,
    reconsolidator: new LLMReconsolidator(llm),
    rng,
    guard,
    profiles: profilesFor(services.seeds, memoryConfig.profile),
  });
  const seedNames = new Map(services.seeds.map((s) => [s.id, s.name]));
  // El reloj y la simulación se crean más abajo; el detector los consulta al ocurrir algo.
  let clockRef: GameClock | null = null;
  let placeOf: (agentId: string) => string | null = () => null;
  const detector = new DramaDetector({
    now: () => clockRef?.now() ?? 0,
    name: (id) => seedNames.get(id) ?? id,
    placeOf: (id) => placeOf(id),
  });
  // La ficha social se observa para detectar discusiones y amistades.
  const social: SocialProfileStore = detector.observe(
    db ? new PgSocialProfileStore(db.db, row.id) : new InMemorySocialProfileStore(),
  );
  const dramas: DramaStore = db ? new PgDramaStore(db.db, row.id) : new InMemoryDramaStore();
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
  clockRef = clock;
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
    language: row.language,
    demoEveryMinutes: config.SIM_DEMO === "on" ? config.SIM_DEMO_EVERY_MINUTES : undefined,
  });
  placeOf = (id) => sim.agents.get(id)?.state.locationId ?? null;
  sim.onEvent((e) => detector.onEvent(e));
  memory.onEffect((e) => detector.onEffect(e));
  detector.onDrama((d) => {
    services.track(
      dramas.add(d).catch((e: unknown) => worldLog(`⚠ No se pudo guardar el drama: ${String(e)}`)),
    );
    sim.notifyDrama(d);
  });
  sim.onEvent((e) =>
    services.track(
      events
        .add(e)
        .catch((err: unknown) => worldLog(`⚠ No se pudo guardar el evento: ${String(err)}`)),
    ),
  );
  sim.onEvent((e) => services.metrics.simEvents.inc({ world: row.id, kind: e.kind }));
  sim.onTick(() => services.metrics.simTicks.inc({ world: row.id }));
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

  let status: WorldRunStatus =
    row.status === "paused" ? { state: "paused", reason: "manual", detail: "Pausado" } : RUNNING;
  /** Velocidad a la que volver al reanudar. */
  let resumeSpeed: SimSpeed = speed === 0 ? 10 : speed;
  if (status.state === "paused") clock.setSpeed(0);
  const setStatus = (next: WorldRunStatus) => {
    status = next;
    sim.notifyStatus(next);
    services.track(
      services.worldRepo
        .setStatus(row.id, next.state)
        .catch((e: unknown) => worldLog(`⚠ No se pudo guardar el estado: ${String(e)}`)),
    );
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
    dramas,
    costs,
    restoredFrom: snapshot?.time ?? null,
    status: () => status,
    pause(reason, detail) {
      // Una pausa "más fuerte" (presupuesto, kill switch) sustituye a una manual o por falta de público.
      if (status.state === "paused" && status.reason === reason) return;
      if (clock.speed !== 0) resumeSpeed = clock.speed;
      clock.setSpeed(0);
      setStatus({ state: "paused", reason, detail });
      worldLog(`⏸ ${detail}`);
    },
    resume() {
      const blocked = services.budget.blockReason(row.id);
      if (blocked) return { ok: false, error: blocked };
      if (status.state === "running") return { ok: true };
      clock.setSpeed(resumeSpeed);
      setStatus(RUNNING);
      return { ok: true };
    },
    async vetUserText(kind, text, userId, agentId) {
      const reject = async (reason: string) => {
        services.track(
          services.moderationLog
            .add({ worldId: row.id, userId, kind, text: text.slice(0, 1000), reason })
            .catch((e: unknown) => worldLog(`⚠ No se pudo registrar el rechazo: ${String(e)}`)),
        );
        worldLog(`🛡 Texto rechazado (${kind}): ${reason}`);
        return { ok: false as const, error: `Texto rechazado: ${reason}` };
      };
      const clean = sanitizeUserText(text, config.USER_TEXT_MAX);
      if (!clean) return reject(`vacío o de más de ${config.USER_TEXT_MAX} caracteres`);
      // Protección de menores, también con la moderación apagada.
      const minors = guard.involvedMinors(clean, agentId ? [agentId] : []);
      if (minors.length && hasStrongRomance(clean)) {
        return reject(
          `contenido romántico o sexual con un menor (${minors.map((m) => m.name).join(", ")})`,
        );
      }
      if (config.MODERATION === "off") return { ok: true, text: clean };
      try {
        const verdict = await moderateUserText(llm, { kind, text: clean });
        if (!verdict.allowed) return reject(verdict.reason || "no permitido");
      } catch (error) {
        // Sin moderación (p. ej. sin presupuesto) no entra nada.
        return reject(
          `no se pudo moderar (${error instanceof Error ? error.message : String(error)})`,
        );
      }
      return { ok: true, text: clean };
    },
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
  opts: { worldIds?: string[]; processName?: string } = {},
): Promise<App> {
  const services = await createServices(config, log, opts.processName);
  const defaultRow = await services.worldRepo.ensureDefault(MAP_FILE, config.SIM_SEED ?? null);
  const rows = (await services.worldRepo.list()).filter((w) =>
    opts.worldIds ? opts.worldIds.includes(w.id) : w.status !== "stopped",
  );
  if (!rows.some((r) => r.id === defaultRow.id) && !opts.worldIds) rows.unshift(defaultRow);
  const worlds = new Map<string, WorldRuntime>();
  for (const row of rows) worlds.set(row.id, await openWorld(services, row));
  attachWorlds(services, () => worlds.values());
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

/**
 * Enlaza los servicios compartidos con los mundos que corre este proceso: la Batch API solo si
 * ningún mundo va más rápido que LLM_BATCH_MAX_SPEED, y al superar el presupuesto se pausa el
 * mundo afectado (o todos, si es el global).
 */
export function attachWorlds(services: Services, worlds: () => Iterable<WorldRuntime>): void {
  const max = services.config.LLM_BATCH_MAX_SPEED;
  services.setBatchGate(() =>
    [...worlds()].every((w) => w.clock.speed === 0 || w.clock.speed <= max),
  );
  services.budget.onBreach((b) => {
    for (const w of worlds()) {
      if (b.scope === "global" || w.id === b.worldId) w.pause("budget", describeBreach(b));
    }
  });
}

async function resumeTime(store: MemoryStore): Promise<number> {
  const latest = store instanceof PgMemoryStore ? await store.latestGameTime() : 0;
  // Los recuerdos sembrados llevan la hora de inicio: solo reanudamos si hubo simulación real.
  if (latest <= START_MINUTE_OF_DAY) return START_MINUTE_OF_DAY;
  return (Math.floor(latest / 1440) + 1) * 1440 + START_MINUTE_OF_DAY;
}
