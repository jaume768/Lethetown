import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;

export interface DbHandle {
  db: Db;
  pool: pg.Pool;
}

export function createDb(url: string): DbHandle {
  const pool = new pg.Pool({ connectionString: url, connectionTimeoutMillis: 2000 });
  // Sin esto, un error de conexión inactiva tumba el proceso.
  pool.on("error", () => {});
  return { db: drizzle(pool, { schema }), pool };
}

/** Comprueba que Postgres responde y que las migraciones están aplicadas. */
export async function checkDb(
  handle: DbHandle,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    const res = await handle.pool.query<{ exists: boolean }>(
      "select to_regclass('public.memories') is not null as exists",
    );
    if (!res.rows[0]?.exists)
      return { ok: false, reason: "faltan las tablas (ejecuta pnpm db:migrate)" };
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}
