/**
 * Borra memorias, costes, auditoría, fichas, eventos, crónicas e instantáneas de todos los
 * mundos (los mundos se conservan) y vuelve a sembrar los recuerdos iniciales de seeds/agents.json.
 */
import { loadConfig } from "../config";
import { bootstrap } from "../bootstrap";
import { createDb } from "../db/client";
import {
  chronicles,
  llmCalls,
  memories,
  memoryAudit,
  memoryVersions,
  simEvents,
  socialProfiles,
  worldSnapshots,
} from "../db/schema";

const config = loadConfig();
if (!config.DATABASE_URL) {
  console.error("DATABASE_URL no está definida: el modo en RAM se siembra solo al arrancar.");
  process.exit(1);
}
const { db, pool } = createDb(config.DATABASE_URL);
for (const table of [
  memories,
  llmCalls,
  memoryAudit,
  memoryVersions,
  socialProfiles,
  simEvents,
  chronicles,
  worldSnapshots,
]) {
  await db.delete(table);
}
await pool.end();

const app = await bootstrap(config, (m) => console.log(`[seed] ${m}`));
if (app.storeKind !== "postgres") {
  console.error("No se pudo usar Postgres; nada sembrado.");
  process.exitCode = 1;
}
await app.close();
console.log("Semilla aplicada.");
