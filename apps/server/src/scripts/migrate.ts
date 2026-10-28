import { migrate } from "drizzle-orm/node-postgres/migrator";
import { loadConfig } from "../config";
import { createDb } from "../db/client";
import { SERVER_ROOT } from "../paths";
import path from "node:path";

const config = loadConfig();
if (!config.DATABASE_URL) {
  console.error("DATABASE_URL no está definida en .env");
  process.exit(1);
}
const { db, pool } = createDb(config.DATABASE_URL);
try {
  await migrate(db, { migrationsFolder: path.join(SERVER_ROOT, "drizzle") });
  console.log("Migraciones aplicadas.");
} catch (error) {
  console.error("Error aplicando migraciones (¿está levantado `docker compose up -d`?):", error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
