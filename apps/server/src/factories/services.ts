/** Servicios compartidos por los mundos de un proceso (LLM, BD, embeddings, seguridad). */
import { AgentSeed } from "@lethetown/shared";
import { z } from "zod";
import { modelsFor, type AppConfig } from "../config";
import { InMemorySessionStore, PgSessionStore, PgUserStore } from "../security/auth";
import { checkDb, createDb, type DbHandle } from "../db/client";
import { InMemoryModerationLog, PgModerationLog } from "../db/stores";
import {
  InMemorySnapshotStore,
  InMemoryWorldRepo,
  PgSnapshotStore,
  PgWorldRepo,
} from "../db/worlds";
import { createEmbedder } from "../embeddings";
import { Metrics } from "../observability";
import { readJson } from "./files";
import { createLlmStack, loadPricing } from "./llm";
import { loadMemoryConfig } from "./memory";
import { loadRetentionConfig } from "../retention";
import { createBudget, devUsers } from "./security";
import type { Services } from "./types";

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
  const metrics = new Metrics(processName);
  const { provider, llmQueue, llmResilience, setBatchGate } = createLlmStack(
    config,
    log,
    (task, ms) => metrics.recordQueueWait(task, ms),
  );
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
    setBatchGate,
    models,
    pricing,
    embedder,
    memoryConfig: await loadMemoryConfig(log),
    retention: await loadRetentionConfig(log),
    seeds,
    db,
    storeKind: db ? "postgres" : "memory",
    worldRepo: db ? new PgWorldRepo(db.db) : new InMemoryWorldRepo(),
    snapshots: db ? new PgSnapshotStore(db.db) : new InMemorySnapshotStore(),
    budget: await createBudget(db),
    moderationLog: db ? new PgModerationLog(db.db) : new InMemoryModerationLog(),
    metrics,
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
