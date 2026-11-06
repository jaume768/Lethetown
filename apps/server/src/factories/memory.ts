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
  withAblation,
  type ABLATION_FLAGS,
  type MemoryStore,
} from "@lethetown/agent-core";
import { PgMemoryStore } from "../db/pg-memory-store";
import { type WorldRow } from "../db/worlds";
import { fromRoot } from "../paths";
import { readJson } from "./files";
import { createMinorGuard } from "./security";
import type { Services } from "./types";
import type { Rng, LLMClient } from "@lethetown/agent-core";

/**
 * Config de memoria: valores por defecto + config/memory.json si existe, y la ablación
 * (`MEMORY_ABLATION`, para un mundo de control en una partida de estudio).
 */
export async function loadMemoryConfig(
  log: (msg: string) => void,
  ablation: (typeof ABLATION_FLAGS)[number][] = [],
): Promise<MemoryConfig> {
  const file = "config/memory.json";
  let cfg = MemoryConfig.parse({});
  if (existsSync(fromRoot(file))) {
    log(`Config de memoria: ${file}`);
    cfg = await readJson(MemoryConfig, file);
  }
  for (const flag of ablation) cfg.ablation[flag] = true;
  if (ablation.length) log(`⚗ Ablación de la memoria: ${ablation.join(", ")}`);
  return withAblation(cfg);
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
