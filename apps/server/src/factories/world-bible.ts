/** Biblia del mundo: config/world.json validado con zod (ver docs/decisiones/mundo.md). */
import { WorldBible } from "@lethetown/agent-core";
import { readJson } from "./files";

export const WORLD_BIBLE_FILE = "config/world.json";

export async function loadWorldBible(log: (msg: string) => void): Promise<WorldBible> {
  const bible = await readJson(WorldBible, WORLD_BIBLE_FILE);
  log(`Mundo: ${bible.town}, ${bible.year} (${WORLD_BIBLE_FILE})`);
  return bible;
}
