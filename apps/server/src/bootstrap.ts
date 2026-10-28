import { readFile } from "node:fs/promises";
import {
  AnthropicProvider,
  CostTracker,
  InMemoryStore,
  LLMClient,
  MemorySystem,
  MockProvider,
  ModelRouter,
  OpenAIProvider,
  agentMockResponder,
  type LLMProvider,
  type MemoryStore,
  type PricingTable,
} from "@lethetown/agent-core";
import { AgentSeed, SIM_SPEEDS, World, type SimSpeed } from "@lethetown/shared";
import { z } from "zod";
import { modelsFor, type AppConfig } from "./config";
import { checkDb, createDb, type DbHandle } from "./db/client";
import { PgMemoryStore } from "./db/pg-memory-store";
import { llmCalls } from "./db/schema";
import { createEmbedder } from "./embeddings";
import { fromRoot } from "./paths";
import { GameClock } from "./sim/clock";
import { LimitedProvider } from "./sim/llm-queue";
import { Simulation } from "./sim/simulation";
import { WorldMap } from "./sim/world";

/** La simulación arranca a las 06:50 del día 0 (o al día siguiente del último recuerdo guardado). */
const START_MINUTE_OF_DAY = 6 * 60 + 50;

export interface App {
  config: AppConfig;
  sim: Simulation;
  clock: GameClock;
  world: WorldMap;
  memory: MemorySystem;
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
  const [world, seeds, pricing] = await Promise.all([
    readJson(World, "seeds/world.json"),
    readJson(z.array(AgentSeed), "seeds/agents.json"),
    loadPricing(),
  ]);
  const worldMap = new WorldMap(world);

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
  const memory = new MemorySystem({ store, embedder });

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
  });
  const seeded = await sim.seedMemoriesIfEmpty(startTime);
  if (seeded) log(`Sembrados los recuerdos iniciales de ${seeded} agentes.`);

  return {
    config,
    sim,
    clock,
    world: worldMap,
    memory,
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
