/**
 * Momentos destacados de una partida grabada (candidatos a clip): `moments.md` y `moments.json`
 * en la carpeta de la grabación (o `--out <carpeta>`), con día y hora de juego, los vecinos y la
 * frase literal, ordenados por una puntuación simple y explicada (ver replay/moments.ts).
 * Aparte, los arcos largos (lo repetido en varios días, metas confirmadas, recuerdos de la
 * semilla que se apagan) en su propia sección; con dos carpetas (dos semillas), además, la misma
 * intención o meta en las dos y cómo acabó en cada una.
 * Uso: pnpm replay:moments <carpeta-grabacion> [<otra-carpeta>] [--export <carpeta-bd>]
 *        [--from <min>] [--to <min>] [--max 200] [--out <carpeta>]
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve as resolvePath } from "node:path";
import { MemoryConfig } from "@lethetown/agent-core";
import {
  SimEvent,
  findArcs,
  findMoments,
  momentInputFromBundle,
  pairArcs,
  parseTiledMap,
  topMoments,
  type Moment,
  type MomentInput,
  type ReplayBundle,
} from "@lethetown/shared";
import { readJsonl } from "../analysis/study-files";
import { MAP_FILE } from "../factories/worlds";
import { fromRoot } from "../paths";
import { buildBundle, camel, externalMarks, readExport, readRecording } from "../replay/pack";
import { formatGameTime } from "@lethetown/agent-core";
import { existsSync } from "node:fs";
import { basename } from "node:path";

const resolve = (p: string) => resolvePath(process.env.INIT_CWD ?? process.cwd(), p);
const args = process.argv.slice(2).filter((a) => a !== "--");
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const dirs = args.filter((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
if (!dirs.length || dirs.length > 2) {
  throw new Error("Uso: replay:moments <carpeta-grabacion> [<otra-carpeta>] [--export <bd>]");
}
const optNum = (name: string) => (flag(name) !== undefined ? Number(flag(name)) : undefined);
const tmj = JSON.parse(readFileSync(fromRoot(MAP_FILE), "utf8")) as Record<string, unknown>;

interface Game {
  dir: string;
  label: string;
  bundle: ReplayBundle;
  input: MomentInput;
  moments: Moment[];
  arcs: Moment[];
}

function load(dir: string): Game {
  const recDir = resolve(dir);
  // Con dos carpetas, cada una con su exportación (`--export` solo vale para una).
  const expDir = resolve((dirs.length === 1 && flag("export")) || recDir);
  const exp = readExport(expDir);
  const bundle = buildBundle(readRecording(recDir), exp, {
    from: optNum("from"),
    to: optNum("to"),
    world: parseTiledMap(tmj),
    map: tmj,
    memory: MemoryConfig.parse({}),
  });
  const base = momentInputFromBundle(bundle);
  // La BD tiene todas las frases (el WebSocket se pierde lo que pasa mientras está caído).
  const db = existsSync(join(expDir, "bd")) ? join(expDir, "bd") : expDir;
  const dbEvents = readJsonl(join(db, "sim_events.jsonl")).flatMap((r) => {
    const { meta, ...row } = camel(r);
    const e = SimEvent.safeParse(meta ? { ...row, meta } : row);
    return e.success && e.data.time >= bundle.meta.from && e.data.time <= bundle.meta.to
      ? [e.data]
      : [];
  });
  const input: MomentInput = {
    ...base,
    events: dbEvents.length ? dbEvents : base.events,
    externals: externalMarks(exp, bundle.meta.from, bundle.meta.to),
  };
  return {
    dir: recDir,
    label: bundle.meta.seed !== null ? `semilla ${bundle.meta.seed}` : basename(recDir),
    bundle,
    input,
    moments: topMoments(findMoments(input), Number(flag("max") ?? 200)),
    arcs: findArcs(input),
  };
}

const games = dirs.map(load);
const pairs = games.length === 2 ? pairArcs(games[0]!, games[1]!) : [];
for (const g of games) {
  const outDir = resolve((games.length === 1 && flag("out")) || g.dir);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    join(outDir, "moments.json"),
    `${JSON.stringify([...g.moments, ...g.arcs, ...pairs], null, 2)}\n`,
  );
  writeFileSync(join(outDir, "moments.md"), markdown(g, pairs));
  console.log(
    `${g.label}: ${g.moments.length} momentos, ${g.arcs.length} arcos${pairs.length ? `, ${pairs.length} parejas` : ""} → ${join(outDir, "moments.md")} y moments.json`,
  );
}

function markdown(g: Game, paired: Moment[]): string {
  const name = (id: string) => g.input.names.get(id) ?? id;
  const { meta } = g.bundle;
  const lines = [
    "# Momentos destacados",
    "",
    `Partida ${meta.playedOn ?? "?"} · semilla ${meta.seed ?? "?"} · ${meta.models.join(", ") || "?"}`,
    `· minutos ${Math.round(meta.from)}–${Math.round(meta.to)}.`,
    "",
    "Puntuación = base del tipo + largo (turnos o texto) + carga emocional (|afinidad| entre los",
    "implicados o valencia del recuerdo) + vecinos implicados. Para verlo en la repetición:",
    "`/replay?src=…&t=<minuto>`. Los arcos largos van aparte, al final.",
    "",
  ];
  const entry = (m: Moment, i: number) => {
    const span = m.span
      ? ` · de ${formatGameTime(m.span.from)} a ${formatGameTime(m.span.to)} (${m.span.count})`
      : "";
    lines.push(
      `### ${i + 1}. ${m.title}`,
      "",
      `- **${formatGameTime(m.time)}** (minuto ${Math.round(m.time)}) · ${m.kind}${m.subkind ? ` (${m.subkind})` : ""} · ${m.agents.map(name).join(", ") || "—"}${span}`,
      `- Puntuación ${m.score.toFixed(2)}: ${m.why}`,
      ...(m.memoryId ? [`- Tarjeta: \`&memory=${m.memoryId}\``] : []),
      "",
      ...(m.quote ? [`> ${m.quote.replace(/\n+/g, " ")}`, ""] : []),
    );
  };
  lines.push("## Momentos", "");
  g.moments.forEach(entry);
  lines.push(
    "## Arcos largos",
    "",
    "Lo que pasa a lo largo de varios días (ordenado aparte): lo mismo dicho de A a B en 3 o más",
    "días (palabras raras en el resto del pueblo), metas cualitativas que confirma la",
    "consolidación (con la frase que lo logró) y recuerdos de la semilla que se vuelven vagos o se",
    "olvidan.",
    "",
  );
  g.arcs.forEach(entry);
  if (paired.length) {
    lines.push(
      "## Las dos semillas",
      "",
      `La misma intención o meta del mismo vecino en ${games.map((x) => x.label).join(" y ")}, y`,
      "cómo acabó en cada una (primero las que acabaron distinto). El minuto es el de la primera.",
      "",
    );
    paired.forEach(entry);
  }
  return lines.join("\n");
}
