/**
 * Arranque del proceso: servicios compartidos y mundos. Las piezas viven en `factories/`
 * (LLM, memoria, seguridad, mundos); aquí solo se orquestan.
 */
import type { AppConfig } from "./config";
import { DEFAULT_WORLD_ID } from "./db/schema";
import { createServices } from "./factories/services";
import type { App, WorldRuntime } from "./factories/types";
import { attachWorlds, MAP_FILE, openWorld } from "./factories/worlds";

export type { App, Services, WorldRuntime } from "./factories/types";
export { createServices } from "./factories/services";
export { attachWorlds, MAP_FILE, openWorld, safeMapPath } from "./factories/worlds";
export { createProvider, loadPricing } from "./factories/llm";
export { loadMemoryConfig } from "./factories/memory";

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
