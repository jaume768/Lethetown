/**
 * Paquete de repetición de una partida grabada, para verla en la web sin servidor ni LLM
 * (`/replay`). Lista blanca: ver replay/pack.ts y docs/decisiones/repeticion.md.
 * Uso: pnpm replay:pack <carpeta-grabacion> [--export <carpeta-bd>] [--from <min>] [--to <min>]
 *        [--out <fichero.replay.json.gz | .json>] [--map <fichero.tmj>] [--seed <n>]
 * Sin `--export`, usa la subcarpeta bd/ de la grabación si existe. El mapa es el del commit de
 * la partida (manifest.json) o, si no lo hay, el último commit anterior a la grabación.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve as resolvePath } from "node:path";
import { gzipSync } from "node:zlib";
import { parseTiledMap } from "@lethetown/shared";
import { loadMemoryConfig } from "../factories/memory";
import { MAP_FILE } from "../factories/worlds";
import { fromRoot } from "../paths";
import { buildBundle, readExport, readRecording } from "../replay/pack";

/** Rutas relativas a donde se lanzó `pnpm` (no a apps/server). */
const resolve = (p: string) => resolvePath(process.env.INIT_CWD ?? process.cwd(), p);
const args = process.argv.slice(2).filter((a) => a !== "--");
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const dir = args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
if (!dir) throw new Error("Uso: replay:pack <carpeta-grabacion> [--export <bd>] [--out <fichero>]");
const recDir = resolve(dir);
const optNum = (name: string) => (flag(name) !== undefined ? Number(flag(name)) : undefined);

const rec = readRecording(recDir);
const exp = readExport(resolve(flag("export") ?? recDir));
const git = (a: string[]) => {
  try {
    return execFileSync("git", a, { cwd: fromRoot("."), encoding: "utf8", maxBuffer: 1 << 26 });
  } catch {
    return null;
  }
};

/** El mapa con que se jugó: el del commit del manifiesto, el anterior a la grabación o el actual. */
function mapText(): { text: string; from: string } {
  const file = flag("map");
  if (file) return { text: readFileSync(resolve(file), "utf8"), from: file };
  const sha = rec.manifest?.sha;
  const started = typeof rec.meta?.startedAt === "string" ? rec.meta.startedAt : null;
  const ref =
    sha ?? (started ? git(["rev-list", "-1", `--before=${started}`, "HEAD"])?.trim() : null);
  const text = ref ? git(["show", `${ref}:${MAP_FILE}`]) : null;
  if (text) return { text, from: `${MAP_FILE} @ ${ref!.slice(0, 10)}` };
  return { text: readFileSync(fromRoot(MAP_FILE), "utf8"), from: MAP_FILE };
}

const map = mapText();
const tmj = JSON.parse(map.text) as Record<string, unknown>;
const memory = await loadMemoryConfig(() => undefined);
const bundle = buildBundle(rec, exp, {
  from: optNum("from"),
  to: optNum("to"),
  world: parseTiledMap(tmj),
  map: tmj,
  memory,
  seed: optNum("seed"),
});

const out = resolve(flag("out") ?? `${basename(recDir)}.replay.json.gz`);
const json = JSON.stringify(bundle);
writeFileSync(out, out.endsWith(".gz") ? gzipSync(json, { level: 9 }) : json);
const mb = (n: number) => `${(n / 1e6).toFixed(1)} MB`;
console.log(
  [
    `Paquete: ${out} (${mb(readFileSync(out).length)}; ${mb(json.length)} sin comprimir)`,
    `Minutos ${Math.round(bundle.meta.from)}–${Math.round(bundle.meta.to)} · ${bundle.frames.length} fotos · ${bundle.messages.length} mensajes${bundle.track ? ` · pista de ${bundle.track.length} min` : ""}`,
    bundle.data
      ? `BD: ${bundle.data.memories.length} recuerdos, ${bundle.data.audit.length} de auditoría, ${bundle.data.goals.length} metas`
      : "Sin exportación de la BD: los paneles de memoria, red y metas irán vacíos.",
    `Mapa: ${map.from} · modelos: ${bundle.meta.models.join(", ") || "?"}`,
  ].join("\n"),
);
if (!existsSync(out)) process.exit(1);
