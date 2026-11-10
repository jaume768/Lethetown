/**
 * Partida corta en mock grabada en el propio proceso (sin servidor, sin BD y sin red) y
 * empaquetada para la repetición: lo mismo que `record --track` + `world:export` +
 * `replay:pack`, para el e2e y para probar el reproductor sin una grabación real.
 * Uso: pnpm --filter @lethetown/server replay:demo [--hours 3] [--seed 7]
 *        [--out apps/web/public/replays/demo.replay.json.gz] [--rec <carpeta>]
 * `--rec` deja también la grabación (messages.jsonl, states.jsonl, positions.jsonl, bd/…).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve as resolvePath } from "node:path";
import { gzipSync } from "node:zlib";
import { positionAt, type AgentState, type ServerMessage } from "@lethetown/shared";
import { buildManifest } from "../analysis/manifest";
import { bootstrap } from "../bootstrap";
import { loadConfig } from "../config";
import { fromRoot } from "../paths";
import { buildBundle, type ExportRows, type Recording } from "../replay/pack";
import { LocalWorldGateway } from "../worlds/gateway";

const resolve = (p: string) => resolvePath(process.env.INIT_CWD ?? process.cwd(), p);
const args = process.argv.slice(2).filter((a) => a !== "--");
const flag = (name: string, def: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1]! : def;
};
const hours = Number(flag("hours", "3"));
const seed = flag("seed", "7");
const out = resolve(flag("out", fromRoot("apps/web/public/replays/demo.replay.json.gz")));
const recDir = args.includes("--rec") ? resolve(flag("rec", "replay-demo")) : null;
/** Cada cuántos minutos de juego, una foto (como `record --every 10`). */
const EVERY = 10;

const env = {
  ...process.env,
  LLM_PROVIDER: "mock",
  DATABASE_URL: "",
  EMBEDDINGS: "hash",
  EMBEDDINGS_THREAD: "off",
  SIM_SEED: seed,
};
const config = loadConfig(env);
const app = await bootstrap(config, () => undefined);
const runtime = app.defaultWorld;
const gw = new LocalWorldGateway(runtime);

// La «hora real» es el minuto de juego en ms: así se deduce el minuto de lo que no lo trae.
const wall = () => Math.round(runtime.clock.now() * 1000);
const messages: Record<string, unknown>[] = [];
const states: Record<string, unknown>[] = [];
const positions: { time: number; p: [string, number, number][] }[] = [];
gw.onSignal((s) => {
  const msg = s as ServerMessage;
  if (msg.type === "cost") return;
  messages.push({ wallMs: wall(), ...msg });
});

runtime.start();
const start = runtime.clock.now();
const end = start + hours * 60;
const shot = (time: number, agents: AgentState[]) => states.push({ wallMs: wall(), time, agents });
shot(start, gw.live().agents);
for (let m = Math.floor(start) + 1; m <= end; m++) {
  await runtime.clock.runUntil(m);
  const agents = gw.live().agents;
  const p: [string, number, number][] = [];
  for (const a of agents) {
    const mv = a.movement;
    if (!mv || m < mv.startTime || m > mv.endTime + 1) continue;
    const pos = positionAt(a, m);
    p.push([a.id, Math.round(pos.x * 10) / 10, Math.round(pos.y * 10) / 10]);
  }
  if (p.length) positions.push({ time: m, p });
  if (m % EVERY === 0) shot(m, agents);
}

// Lo que exportaría `world:export`, de los almacenes en RAM (ya en camelCase).
const agentIds = gw.live().agents.map((a) => a.id);
const memories = (await Promise.all(agentIds.map((id) => gw.memory.store.listByAgent(id)))).flat();
const exp: ExportRows = {
  memories: memories.map(({ embedding: _e, ...m }) => m),
  memory_audit: (
    await Promise.all(agentIds.map((id) => gw.memory.store.audit(id, 100_000)))
  ).flat(),
  memory_versions: (await Promise.all(memories.map((m) => gw.memory.store.versions(m.id)))).flat(),
  social_profiles: await gw.social.listAll(),
  social_profile_history: await gw.social.history(null, undefined, { limit: 100_000 }),
  goals: await gw.goals.list(),
  skills: await gw.skills.list(),
  lore: await gw.lore.lore(),
  lore_holders: await gw.lore.holders(),
  knowledge_log: [],
  llm_calls: [],
} as unknown as ExportRows;
const manifest = buildManifest({
  env,
  git: { sha: null, dirty: null },
  routing: null,
  pricing: null,
  now: new Date(),
});
const rec: Recording = {
  messages,
  states,
  positions,
  manifest,
  meta: { startedAt: manifest.createdAt },
};
const bundle = buildBundle(rec, exp, {
  world: gw.world,
  map: gw.tmj as Record<string, unknown>,
  memory: gw.memory.config,
});
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, gzipSync(JSON.stringify(bundle)));
if (recDir) {
  const jsonl = (rows: unknown[]) => rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
  mkdirSync(join(recDir, "bd"), { recursive: true });
  writeFileSync(join(recDir, "messages.jsonl"), jsonl(messages));
  writeFileSync(join(recDir, "states.jsonl"), jsonl(states));
  writeFileSync(join(recDir, "positions.jsonl"), jsonl(positions));
  writeFileSync(join(recDir, "manifest.json"), JSON.stringify(manifest, null, 2));
  writeFileSync(join(recDir, "meta.json"), JSON.stringify(rec.meta, null, 2));
  for (const [table, rows] of Object.entries(exp)) {
    writeFileSync(join(recDir, "bd", `${table}.jsonl`), jsonl(rows));
  }
}
console.log(
  `Repetición de demo: ${out} (${hours} h de juego, ${bundle.frames.length} fotos, ${bundle.messages.length} mensajes, ${positions.length} min de pista)`,
);
await app.close();
process.exit(0);
