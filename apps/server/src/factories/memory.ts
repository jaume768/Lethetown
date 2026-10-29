/** Factorías de la memoria: configuración, sistema de memoria de cada mundo y mantenimiento. */
import { existsSync } from "node:fs";
import {
  LLMEpisodeSummarizer,
  LLMGistCompressor,
  LLMReconsolidator,
  MemoryConfig,
  profilesFor,
  MemoryMaintenance,
  MemorySystem,
  RandomSourceConfuser,
  seededRng,
  InMemoryStore,
  type MemoryStore,
} from "@lethetown/agent-core";
import { PgMemoryStore } from "../db/pg-memory-store";
import { type WorldRow } from "../db/worlds";
import { fromRoot } from "../paths";
import { readJson } from "./files";
import { createMinorGuard } from "./security";
import type { Services } from "./types";
import type { Rng, LLMClient } from "@lethetown/agent-core";

/** Config de memoria: valores por defecto + config/memory.json si existe. */
export async function loadMemoryConfig(log: (msg: string) => void): Promise<MemoryConfig> {
  const file = "config/memory.json";
  if (!existsSync(fromRoot(file))) return MemoryConfig.parse({});
  log(`Config de memoria: ${file}`);
  return readJson(MemoryConfig, file);
}

/** Memoria de un mundo: almacén (Postgres o RAM), azar, protección de menores y perfiles. */
export function createWorldMemory(
  services: Services,
  row: WorldRow,
  llm: LLMClient,
  worldLog: (msg: string) => void,
) {
  const { config, db } = services;
  const store: MemoryStore = db ? new PgMemoryStore(db.db, row.id) : new InMemoryStore();
  const memoryConfig = services.memoryConfig;
  const rng = seededRng(row.seed ?? config.SIM_SEED ?? Date.now());
  // Protección de menores sobre lo que escribe el LLM; lo descartado va a moderation_log.
  const guard = createMinorGuard(services, row, llm, worldLog);
  const memory = new MemorySystem({
    store,
    embedder: services.embedder,
    config: memoryConfig,
    reconsolidator: new LLMReconsolidator(llm),
    rng,
    guard,
    profiles: profilesFor(services.seeds, memoryConfig.profile),
  });
  return { store, rng, guard, memory };
}

/** Mantenimiento de la memoria de un mundo (esencias, fuentes, presupuesto). */
export function createMaintenance(
  memory: MemorySystem,
  llm: LLMClient,
  rng: Rng,
  worldLog: (msg: string) => void,
): MemoryMaintenance {
  return new MemoryMaintenance({
    memory,
    gist: new LLMGistCompressor(llm),
    confuser: new RandomSourceConfuser(rng, memory.config.sourceConfusion.toLivedShare),
    summarizer: new LLMEpisodeSummarizer(llm),
    onError: (task, e) => worldLog(`⚠ Error en "${task}": ${String(e)}`),
  });
}
