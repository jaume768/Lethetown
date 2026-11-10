/**
 * Momentos destacados de una partida grabada (candidatos a clip): `moments.md` y `moments.json`
 * en la carpeta de la grabación (o `--out <carpeta>`), con día y hora de juego, los vecinos y la
 * frase literal, ordenados por una puntuación simple y explicada (ver replay/moments.ts).
 * Uso: pnpm replay:moments <carpeta-grabacion> [--export <carpeta-bd>] [--from <min>]
 *        [--to <min>] [--max 200] [--out <carpeta>]
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve as resolvePath } from "node:path";
import { MemoryConfig } from "@lethetown/agent-core";
import {
  SimEvent,
  findMoments,
  momentInputFromBundle,
  parseTiledMap,
  topMoments,
  type Moment,
} from "@lethetown/shared";
import { readJsonl } from "../analysis/study-files";
import { MAP_FILE } from "../factories/worlds";
import { fromRoot } from "../paths";
import { buildBundle, camel, externalMarks, readExport, readRecording } from "../replay/pack";
import { formatGameTime } from "@lethetown/agent-core";
import { existsSync } from "node:fs";

const resolve = (p: string) => resolvePath(process.env.INIT_CWD ?? process.cwd(), p);
const args = process.argv.slice(2).filter((a) => a !== "--");
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const dir = args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
if (!dir) throw new Error("Uso: replay:moments <carpeta-grabacion> [--export <bd>]");
const recDir = resolve(dir);
const expDir = resolve(flag("export") ?? recDir);
const optNum = (name: string) => (flag(name) !== undefined ? Number(flag(name)) : undefined);

const tmj = JSON.parse(readFileSync(fromRoot(MAP_FILE), "utf8")) as Record<string, unknown>;
const exp = readExport(expDir);
const bundle = buildBundle(readRecording(recDir), exp, {
  from: optNum("from"),
  to: optNum("to"),
  world: parseTiledMap(tmj),
  map: tmj,
  memory: MemoryConfig.parse({}),
});
const input = momentInputFromBundle(bundle);
// La BD tiene todas las frases (el WebSocket se pierde lo que pasa mientras está caído).
const db = existsSync(join(expDir, "bd")) ? join(expDir, "bd") : expDir;
const dbEvents = readJsonl(join(db, "sim_events.jsonl")).flatMap((r) => {
  const { meta, ...row } = camel(r);
  const e = SimEvent.safeParse(meta ? { ...row, meta } : row);
  return e.success && e.data.time >= bundle.meta.from && e.data.time <= bundle.meta.to
    ? [e.data]
    : [];
});
const moments = topMoments(
  findMoments({
    ...input,
    events: dbEvents.length ? dbEvents : input.events,
    externals: externalMarks(exp, bundle.meta.from, bundle.meta.to),
  }),
  Number(flag("max") ?? 200),
);

const outDir = resolve(flag("out") ?? recDir);
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "moments.json"), `${JSON.stringify(moments, null, 2)}\n`);
writeFileSync(join(outDir, "moments.md"), markdown(moments));
console.log(`${moments.length} momentos → ${join(outDir, "moments.md")} y moments.json`);

function markdown(list: Moment[]): string {
  const name = (id: string) => input.names.get(id) ?? id;
  const lines = [
    "# Momentos destacados",
    "",
    `Partida ${bundle.meta.playedOn ?? "?"} · semilla ${bundle.meta.seed ?? "?"} · ${bundle.meta.models.join(", ") || "?"}`,
    `· minutos ${Math.round(bundle.meta.from)}–${Math.round(bundle.meta.to)}.`,
    "",
    "Puntuación = base del tipo + largo (turnos o texto) + carga emocional (|afinidad| entre los",
    "implicados o valencia del recuerdo) + vecinos implicados. Para verlo en la repetición:",
    "`/replay?src=…&t=<minuto>`.",
    "",
  ];
  list.forEach((m, i) => {
    lines.push(
      `## ${i + 1}. ${m.title}`,
      "",
      `- **${formatGameTime(m.time)}** (minuto ${Math.round(m.time)}) · ${m.kind}${m.subkind ? ` (${m.subkind})` : ""} · ${m.agents.map(name).join(", ") || "—"}`,
      `- Puntuación ${m.score.toFixed(2)}: ${m.why}`,
      "",
      ...(m.quote ? [`> ${m.quote.replace(/\n+/g, " ")}`, ""] : []),
    );
  });
  return lines.join("\n");
}
