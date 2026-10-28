/**
 * Crea un usuario en Postgres: pnpm user:create <usuario> [viewer|director|admin]
 * La contraseña se pide por teclado (sin eco). Para automatizar, pásala por stdin:
 *   printf '%s' "$PASS" | pnpm user:create admin admin
 */
import { createInterface } from "node:readline";
import { loadConfig } from "../config";
import { checkDb, createDb } from "../db/client";
import { PgUserStore, Role } from "../security/auth";
import { NewUser } from "../security/http";

async function readPassword(prompt: string): Promise<string> {
  if (!process.stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const c of process.stdin) chunks.push(c as Buffer);
    return Buffer.concat(chunks)
      .toString("utf8")
      .replace(/\r?\n$/, "");
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  // Silencia el eco de lo que se teclea.
  const out = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream };
  let muted = false;
  out._writeToOutput = (s) => {
    if (!muted || s.includes(prompt)) out.output.write(s);
  };
  const answer = await new Promise<string>((resolve) => {
    rl.question(prompt, resolve);
    muted = true;
  });
  rl.close();
  process.stdout.write("\n");
  return answer;
}

const [username, roleArg = "admin"] = process.argv.slice(2).filter((a) => a !== "--");
const role = Role.safeParse(roleArg);
if (!username || !role.success) {
  console.error("Uso: pnpm user:create <usuario> [viewer|director|admin]");
  process.exit(1);
}
const config = loadConfig();
if (!config.DATABASE_URL) {
  console.error("Hace falta DATABASE_URL (Postgres). En RAM usa DEV_ADMIN_PASSWORD.");
  process.exit(1);
}
const handle = createDb(config.DATABASE_URL);
const status = await checkDb(handle);
if (!status.ok) {
  console.error(`Postgres no disponible: ${status.reason}`);
  process.exit(1);
}
const password = await readPassword("Contraseña: ");
if (process.stdin.isTTY && (await readPassword("Repítela: ")) !== password) {
  console.error("Las contraseñas no coinciden.");
  process.exit(1);
}
const parsed = NewUser.safeParse({ username, password });
if (!parsed.success) {
  console.error(parsed.error.issues.map((i) => i.message).join("\n"));
  process.exit(1);
}
try {
  const user = await new PgUserStore(handle.db).create({ ...parsed.data, role: role.data });
  console.log(`Usuario ${user.username} creado con rol ${user.role}.`);
} catch (error) {
  console.error(`No se pudo crear: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await handle.pool.end();
}
