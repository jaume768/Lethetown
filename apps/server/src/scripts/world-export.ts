/**
 * Exporta de Postgres todo lo de un mundo (cada tabla con `world_id`) a JSONL, una fila por
 * línea y sin los embeddings, para estudiar una partida: recuerdos, auditoría y versiones,
 * fichas sociales y su historia, eventos, dramas, crónicas, citas, objetos, notas, lugares
 * conocidos, llamadas al LLM (coste) e instantáneas.
 * Uso: pnpm --filter @lethetown/server world:export <carpeta> [--world default]
 */
import { createWriteStream, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import pg from "pg";
import { loadConfig } from "../config";

const args = process.argv.slice(2).filter((a) => a !== "--");
const wi = args.indexOf("--world");
const worldId = wi >= 0 ? args[wi + 1]! : "default";
const outDir = resolve(args.find((a, i) => !a.startsWith("--") && i !== wi + 1) ?? "export");
const config = loadConfig();
if (!config.DATABASE_URL) throw new Error("world:export necesita DATABASE_URL");

mkdirSync(outDir, { recursive: true });
const client = new pg.Client({ connectionString: config.DATABASE_URL });
await client.connect();
const { rows: tables } = await client.query<{ table_name: string }>(
  `select table_name from information_schema.columns
   where table_schema = 'public' and column_name = 'world_id' order by table_name`,
);
for (const { table_name: table } of tables) {
  const { rows: cols } = await client.query<{ column_name: string }>(
    `select column_name from information_schema.columns
     where table_schema = 'public' and table_name = $1 and column_name <> 'embedding'
     order by ordinal_position`,
    [table],
  );
  const list = cols.map((c) => `"${c.column_name}"`).join(", ");
  const { rows } = await client.query(`select ${list} from "${table}" where world_id = $1`, [
    worldId,
  ]);
  const out = createWriteStream(join(outDir, `${table}.jsonl`));
  for (const r of rows) out.write(`${JSON.stringify(r)}\n`);
  await new Promise((r) => out.end(r));
  console.log(`${table}: ${rows.length}`);
}
await client.end();
