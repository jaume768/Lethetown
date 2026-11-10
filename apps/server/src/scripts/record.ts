/**
 * Graba una partida para estudiarla después: se conecta al WebSocket del mundo como un
 * espectador más y guarda, con la hora real de llegada, todo lo que emite (eventos, "pensando",
 * efectos de memoria, dramas, crónicas, estado, coste) y una foto del estado de todos los
 * agentes cada `--every` minutos de juego. Al llegar a `--hours` horas de juego desde que
 * empezó a grabar, pausa el mundo (con un usuario director) y termina.
 *
 * Uso (con `pnpm dev` en marcha):
 *   RECORD_USER=… RECORD_PASSWORD=… pnpm --filter @lethetown/server record <carpeta> \
 *     [--hours 48] [--until <minuto>] [--track] [--every 10] [--api http://localhost:3001] \
 *     [--origin http://localhost:5173]
 * `--track`: además, positions.jsonl con la posición de cada agente que se mueve cada minuto de
 * juego (`{ time, p: [[id, x, y]…] }`), para que la repetición (`replay:pack`) siga su ruta real.
 * `--until`: minuto de juego absoluto en que termina (para reanudar una grabación cortada sin
 * volver a contar `--hours` desde el principio). `--env-file`: el entorno del servidor que se
 * graba (p. ej. .env.study.s7), para el manifiesto (solo una lista blanca, sin secretos).
 * Ficheros: messages.jsonl (todo menos los deltas), states.jsonl (fotos), meta.json y
 * manifest.json (código, semilla, velocidad, modelos, precios, ablación y fecha; ver
 * analysis/manifest.ts), que se escribe al empezar y no se pisa al reanudar.
 * Lo que guarda la BD (recuerdos, auditoría, fichas sociales, llm_calls…) lo exporta
 * `pnpm --filter @lethetown/server world:export <carpeta>`.
 *
 * Cuenta horas de juego (no reales): aguanta los cambios de ritmo (x10 en las charlas, la noche
 * rápida a x360) y los cortes del servidor (reconecta y sigue). Varios mundos a la vez: un
 * servidor por puerto, `--api http://localhost:3002 --origin <uno de su ALLOWED_ORIGINS>`.
 */
import { execFileSync } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { positionAt, type AgentState, type ServerMessage } from "@lethetown/shared";
import { parse as parseDotenv } from "dotenv";
import { buildManifest } from "../analysis/manifest";
import { fromRoot } from "../paths";

const args = process.argv.slice(2).filter((a) => a !== "--");
const flag = (name: string, def: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1]! : def;
};
const outDir = resolve(
  args.find(
    (a, i) => !a.startsWith("--") && !(args[i - 1]?.startsWith("--") && args[i - 1] !== "--track"),
  ) ?? "recording",
);
const hours = Number(flag("hours", "48"));
const until = flag("until", "");
const every = Number(flag("every", "10"));
const api = flag("api", "http://localhost:3001");
const origin = flag("origin", "http://localhost:5173");
const tracking = args.includes("--track");

mkdirSync(outDir, { recursive: true });
writeManifest();
const messages = createWriteStream(join(outDir, "messages.jsonl"), { flags: "a" });
const states = createWriteStream(join(outDir, "states.jsonl"), { flags: "a" });
const positions = tracking
  ? createWriteStream(join(outDir, "positions.jsonl"), { flags: "a" })
  : null;
const log = (msg: string) => console.log(`[${new Date().toISOString()}] ${msg}`);

/** El manifiesto de la partida (una vez: al reanudar la grabación no se pisa). */
function writeManifest(): void {
  const file = join(outDir, "manifest.json");
  if (existsSync(file)) return;
  const envFile = flag("env-file", "");
  // .env (los modelos) y encima el de la partida; de los dos, solo la lista blanca del manifiesto.
  const dotenv = (f: string) => (f && existsSync(f) ? parseDotenv(readFileSync(f)) : {});
  const fileEnv = { ...dotenv(fromRoot(".env")), ...dotenv(envFile) };
  const git = (args: string[]) => {
    try {
      return execFileSync("git", args, { cwd: fromRoot("."), encoding: "utf8" }).trim();
    } catch {
      return null;
    }
  };
  const status = git(["status", "--porcelain"]);
  const json = (f: string) => {
    try {
      return JSON.parse(readFileSync(fromRoot(f), "utf8")) as unknown;
    } catch {
      return null;
    }
  };
  const manifest = buildManifest({
    env: { ...fileEnv, ...process.env, ...dotenv(envFile) },
    git: { sha: git(["rev-parse", "HEAD"]), dirty: status === null ? null : status.length > 0 },
    routing: json("config/llm-routing.json"),
    pricing: json("config/pricing.json"),
    now: new Date(),
  });
  writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
}

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
  const send = (c: string) =>
    fetch(`${api}/api/speed`, {
      method: "POST",
      headers: { "content-type": "application/json", origin, cookie: c },
      body: JSON.stringify({ speed: 0 }),
    });
  let res = await send(cookie);
  // Tras horas de grabación (o un reinicio del servidor) la sesión puede haber caducado.
  if (res.status === 401 || res.status === 403) {
    const fresh = await login().catch(() => null);
    if (fresh) res = await send(fresh);
  }
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

/** Último minuto de juego escrito en la pista. */
let trackedUntil: number | null = null;

/**
 * Pista de posiciones: cada minuto entero desde el último, los que iban andando (su posición por
 * la ruta que mandó el servidor). Quien está quieto no se escribe (se ve en las fotos).
 */
function track(time: number) {
  if (!positions) return;
  const last = trackedUntil ?? Math.floor(time) - 1;
  for (let m = last + 1; m <= Math.floor(time); m++) {
    const p: [string, number, number][] = [];
    for (const a of agents.values()) {
      const mv = a.movement;
      // Hasta un minuto después de llegar, para que la pista acabe donde se paró.
      if (!mv || m < mv.startTime || m > mv.endTime + 1) continue;
      const pos = positionAt(a, m);
      p.push([a.id, Math.round(pos.x * 10) / 10, Math.round(pos.y * 10) / 10]);
    }
    if (p.length) positions.write(`${JSON.stringify({ time: m, p })}\n`);
  }
  trackedUntil = Math.max(last, Math.floor(time));
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
    if (startTime !== null) track(lastTime);
    if (startTime !== null && lastTime >= nextShot) {
      shot(lastTime);
      // A x360 un mensaje puede saltarse varias fotos: la siguiente, después de esta hora.
      nextShot = (Math.floor(lastTime / every) + 1) * every;
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
    if (startTime === null) return;
    const end = until ? Number(until) : startTime + hours * 60;
    if (lastTime < end) return;
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
    {
      startedAt,
      endedAt: new Date().toISOString(),
      startTime,
      endTime: lastTime,
      hours,
      until: until ? Number(until) : null,
      every,
    },
    null,
    2,
  ),
);
messages.end();
states.end();
positions?.end();
log("Grabación terminada");
process.exit(0);
