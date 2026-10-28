import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import {
  AnthropicProvider,
  CostTracker,
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
import { llmCalls } from "./db/schema";
import { createEmbedder } from "./embeddings";
import { fromRoot } from "./paths";
import { GameClock } from "./sim/clock";
import { LimitedProvider } from "./sim/llm-queue";
import { Simulation } from "./sim/simulation";
import { WorldMap } from "./sim/world";

/** Mapa Tiled: fuente única de verdad del mundo (lo genera `pnpm map:generate`). */
export const MAP_FILE = "seeds/town.tmj";

/** La simulación arranca a las 06:50 del día 0 (o al día siguiente del último recuerdo guardado). */
const START_MINUTE_OF_DAY = 6 * 60 + 50;

export interface App {
  config: AppConfig;
  /** El .tmj tal cual, para que el cliente lo pinte. */
  tmj: unknown;
  sim: Simulation;
  clock: GameClock;
  world: WorldMap;
  memory: MemorySystem;
  llm: LLMClient;
  social: SocialProfileStore;
  events: EventStore;
  chronicles: ChronicleStore;
  costs: CostTracker;
  provider: LimitedProvider;
  storeKind: "postgres" | "memory";
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

export async function connectStore(
  config: AppConfig,
  log: (msg: string) => void,
): Promise<{ store: MemoryStore; kind: "postgres" | "memory"; db?: DbHandle }> {
  if (!config.DATABASE_URL) {
    log("DATABASE_URL vacía: uso almacén de memoria en RAM (se pierde al reiniciar).");
    return { store: new InMemoryStore(), kind: "memory" };
  }
  const db = createDb(config.DATABASE_URL);
  const status = await checkDb(db);
  if (!status.ok) {
    log(`⚠ Postgres no disponible (${status.reason}). Uso almacén en RAM.`);
    await db.pool.end().catch(() => {});
    return { store: new InMemoryStore(), kind: "memory" };
  }
  log("Conectado a Postgres + pgvector.");
  return { store: new PgMemoryStore(db.db), kind: "postgres", db };
}

export async function bootstrap(config: AppConfig, log: (msg: string) => void): Promise<App> {
  const [tmj, seeds, pricing] = await Promise.all([
    readJson(z.unknown(), MAP_FILE),
    readJson(z.array(AgentSeed), "seeds/agents.json"),
    loadPricing(),
  ]);
  const worldMap = new WorldMap(parseTiledMap(tmj));

  const provider = new LimitedProvider(createProvider(config), config.LLM_CONCURRENCY);
  const models = modelsFor(config);
  const costs = new CostTracker(pricing);
  const llm = new LLMClient(provider, new ModelRouter(models), costs);
  log(`Proveedor LLM: ${provider.name} (fast=${models.fast}, reflection=${models.reflection})`);

  const { store, kind, db } = await connectStore(config, log);
  const pendingWrites = new Set<Promise<unknown>>();
  if (db) {
    costs.onRecord((r) => {
      const write = db.db
        .insert(llmCalls)
        .values({
          model: r.model,
          task: r.task,
          agentId: r.agentId ?? null,
          usd: r.usd,
          ...r.usage,
        })
        .catch((e: unknown) => log(`⚠ No se pudo guardar el coste: ${String(e)}`))
        .finally(() => pendingWrites.delete(write));
      pendingWrites.add(write);
    });
  }
  const embedder = await createEmbedder(config, log);
  log(`Embeddings: ${embedder.name}`);
  const memoryConfig = await loadMemoryConfig(log);
  const rng = seededRng(config.SIM_SEED ?? Date.now());
  const memory = new MemorySystem({
    store,
    embedder,
    config: memoryConfig,
    reconsolidator: new LLMReconsolidator(llm),
    rng,
  });
  const social: SocialProfileStore = db
    ? new PgSocialProfileStore(db.db)
    : new InMemorySocialProfileStore();
  const events: EventStore = db ? new PgEventStore(db.db) : new InMemoryEventStore();
  const chronicles: ChronicleStore = db
    ? new PgChronicleStore(db.db)
    : new InMemoryChronicleStore();
  const names = () => seeds.map((s) => ({ id: s.id, name: s.name }));
  const maintenance = new MemoryMaintenance({
    memory,
    gist: new LLMGistCompressor(llm),
    confuser: new RandomSourceConfuser(rng, memoryConfig.sourceConfusion.toLivedShare),
    summarizer: new LLMEpisodeSummarizer(llm),
    onError: (task, e) => log(`⚠ Error en "${task}": ${String(e)}`),
  });

  const startTime = await resumeTime(store);
  const speed: SimSpeed = SIM_SPEEDS.includes(config.SIM_SPEED as SimSpeed)
    ? (config.SIM_SPEED as SimSpeed)
    : 10;
  const clock = new GameClock(startTime, speed, (e) => log(`⚠ Error en evento: ${String(e)}`));
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
  sim.onEvent((e) => {
    const write = events
      .add(e)
      .catch((err: unknown) => log(`⚠ No se pudo guardar el evento: ${String(err)}`))
      .finally(() => pendingWrites.delete(write));
    pendingWrites.add(write);
  });
  const seeded = await sim.seedMemoriesIfEmpty(startTime);
  if (seeded) log(`Sembrados los recuerdos iniciales de ${seeded} agentes.`);

  return {
    config,
    tmj,
    sim,
    clock,
    world: worldMap,
    memory,
    llm,
    social,
    events,
    chronicles,
    costs,
    provider,
    storeKind: kind,
    async close() {
      clock.stop();
      await Promise.all(pendingWrites);
      await db?.pool.end();
    },
  };
}

async function resumeTime(store: MemoryStore): Promise<number> {
  const latest = store instanceof PgMemoryStore ? await store.latestGameTime() : 0;
  // Los recuerdos sembrados llevan la hora de inicio: solo reanudamos si hubo simulación real.
  if (latest <= START_MINUTE_OF_DAY) return START_MINUTE_OF_DAY;
  return (Math.floor(latest / 1440) + 1) * 1440 + START_MINUTE_OF_DAY;
}
