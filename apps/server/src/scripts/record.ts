/**
 * Graba una partida para estudiarla después: se conecta al WebSocket del mundo como un
 * espectador más y guarda, con la hora real de llegada, todo lo que emite (eventos, "pensando",
 * efectos de memoria, dramas, crónicas, estado, coste) y una foto del estado de todos los
 * agentes cada `--every` minutos de juego. Al llegar a `--hours` horas de juego desde que
 * empezó a grabar, pausa el mundo (con un usuario director) y termina.
 *
 * Uso (con `pnpm dev` en marcha):
 *   RECORD_USER=… RECORD_PASSWORD=… pnpm --filter @lethetown/server record <carpeta> \
 *     [--hours 48] [--every 10] [--api http://localhost:3001] [--origin http://localhost:5173]
 * Ficheros: messages.jsonl (todo menos los deltas), states.jsonl (fotos), meta.json.
 * Lo que guarda la BD (recuerdos, auditoría, fichas sociales, llm_calls…) lo exporta
 * `pnpm --filter @lethetown/server world:export <carpeta>`.
 */
import { createWriteStream, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { AgentState, ServerMessage } from "@lethetown/shared";

const args = process.argv.slice(2).filter((a) => a !== "--");
const flag = (name: string, def: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1]! : def;
};
const outDir = resolve(
  args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--")) ?? "recording",
);
const hours = Number(flag("hours", "48"));
const every = Number(flag("every", "10"));
const api = flag("api", "http://localhost:3001");
const origin = flag("origin", "http://localhost:5173");

mkdirSync(outDir, { recursive: true });
const messages = createWriteStream(join(outDir, "messages.jsonl"), { flags: "a" });
const states = createWriteStream(join(outDir, "states.jsonl"), { flags: "a" });
const log = (msg: string) => console.log(`[${new Date().toISOString()}] ${msg}`);

/** Sesión de director (para pausar al acabar); sin credenciales, no pausa. */
async function login(): Promise<string | null> {
  const username = process.env.RECORD_USER;
  const password = process.env.RECORD_PASSWORD;
  if (!username || !password) return null;
  const res = await fetch(`${api}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) throw new Error(`login: ${res.status}`);
  return res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
}

async function pause(cookie: string | null): Promise<void> {
  if (!cookie) return log("Sin RECORD_USER/RECORD_PASSWORD: no pauso el mundo.");
  const res = await fetch(`${api}/api/speed`, {
    method: "POST",
    headers: { "content-type": "application/json", origin, cookie },
    body: JSON.stringify({ speed: 0 }),
  });
  log(`Mundo en pausa: ${res.status}`);
}

const cookie = await login();
const agents = new Map<string, AgentState>();
let startTime: number | null = null;
let nextShot = 0;
let lastTime = 0;
let done = false;
let count = 0;
const startedAt = new Date().toISOString();

function shot(time: number) {
  states.write(`${JSON.stringify({ wallMs: Date.now(), time, agents: [...agents.values()] })}\n`);
}

function onMessage(msg: ServerMessage) {
  const wallMs = Date.now();
  if (msg.type === "snapshot") {
    for (const a of msg.snapshot.agents) agents.set(a.id, a);
    lastTime = msg.snapshot.clock.time;
    if (startTime === null) {
      startTime = lastTime;
      nextShot = Math.ceil(lastTime / every) * every;
      log(`Grabando desde el minuto de juego ${Math.round(startTime)} en ${outDir}`);
    }
    messages.write(`${JSON.stringify({ wallMs, type: "snapshot", clock: msg.snapshot.clock })}\n`);
    return;
  }
  if (msg.type === "delta" || msg.type === "tick") {
    for (const a of msg.agents) agents.set(a.id, a);
    if (msg.type === "delta") for (const id of msg.removed) agents.delete(id);
    lastTime = msg.clock.time;
    if (startTime !== null && lastTime >= nextShot) {
      shot(lastTime);
      nextShot += every;
    }
    return;
  }
  messages.write(`${JSON.stringify({ wallMs, ...msg })}\n`);
  if (++count % 500 === 0) log(`${count} mensajes; minuto de juego ${Math.round(lastTime)}`);
}

function connect(): void {
  const url = `${api.replace(/^http/, "ws")}/ws`;
  // El WebSocket de Node (undici) admite cabeceras: el servidor comprueba el Origin.
  const ws = new WebSocket(url, { headers: { origin } } as unknown as string[]);
  ws.addEventListener("message", (e) => {
    try {
      onMessage(JSON.parse(String(e.data)) as ServerMessage);
    } catch {
      // Un mensaje que no se entiende no para la grabación.
    }
  });
  ws.addEventListener("close", () => {
    if (done) return;
    log("WebSocket cerrado; reconecto en 5 s");
    setTimeout(connect, 5000);
  });
  ws.addEventListener("error", () => undefined);
}
connect();

await new Promise<void>((resolveDone) => {
  const timer = setInterval(() => {
    if (startTime === null || lastTime < startTime + hours * 60) return;
    clearInterval(timer);
    resolveDone();
  }, 2000);
});
done = true;
shot(lastTime);
await pause(cookie);
writeFileSync(
  join(outDir, "meta.json"),
  JSON.stringify(
    { startedAt, endedAt: new Date().toISOString(), startTime, endTime: lastTime, hours, every },
    null,
    2,
  ),
);
messages.end();
states.end();
log("Grabación terminada");
process.exit(0);
