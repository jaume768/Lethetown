/**
 * Análisis reproducible de una partida grabada (sustituye a docs/investigacion/estudios/e1-partida-2dias/analiza.py): a partir de
 * lo que graban `record` y `world:export`, escribe <carpeta>/analysis.json y analysis.md (el
 * resumen de ESTUDIO.md: coste por tarea, espera de respuesta, longitud de las frases por estilo,
 * intenciones, acciones, red social, memoria y errores) y lo muestra. Con dos carpetas, la tabla
 * compara las dos partidas; con dos o más, además, el coste conjunto (con el aviso de que el
 * reparto entre mundos que comparten caché no es comparable).
 * Uso: pnpm study:analyze <carpeta> [<otra carpeta> …]
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { AgentSeed } from "@lethetown/shared";
import { z } from "zod";
import { analyzeEvolution } from "../analysis/evolution";
import { manifestMarkdown, StudyManifest } from "../analysis/manifest";
import { evolutionMarkdown, jointCostMarkdown } from "../analysis/markdown";
import { loadStudy } from "../analysis/study-files";
import { readJson } from "../factories/files";

const dirs = process.argv
  .slice(2)
  .filter((a) => a !== "--")
  // Rutas relativas a donde se lanzó pnpm (INIT_CWD), no a apps/server.
  .map((d) => resolve(process.env.INIT_CWD ?? process.cwd(), d));
if (!dirs.length) {
  console.error("Uso: pnpm study:analyze <carpeta> [<otra carpeta> …]");
  process.exit(1);
}
const seeds = await readJson(z.array(AgentSeed), "seeds/agents.json");
const reports = dirs.map((dir) => {
  const input = loadStudy(dir, seeds);
  if (!input.events.length) {
    console.error(`${dir}: no hay eventos (ni messages.jsonl ni sim_events.jsonl)`);
    process.exit(1);
  }
  const report = analyzeEvolution(input);
  // El manifiesto que escribió `record` (si lo hay), al principio del informe.
  const manifestFile = join(dir, "manifest.json");
  const manifest = existsSync(manifestFile)
    ? StudyManifest.safeParse(JSON.parse(readFileSync(manifestFile, "utf8")))
    : null;
  const markdown = `${manifest?.success ? `${manifestMarkdown(manifest.data)}\n` : ""}${evolutionMarkdown(report)}`;
  writeFileSync(join(dir, "analysis.json"), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(join(dir, "analysis.md"), markdown);
  console.error(`${dir}: analysis.json y analysis.md`);
  return { report, markdown };
});
const joint =
  reports.length >= 2
    ? `\n${jointCostMarkdown(reports.map((r, i) => ({ label: basename(dirs[i]!), report: r.report })))}`
    : "";
console.log(
  reports.length === 2
    ? `A = ${dirs[0]}\nB = ${dirs[1]}\n\n${evolutionMarkdown(reports[0]!.report, reports[1]!.report)}${joint}`
    : `${reports.map((r) => r.markdown).join("\n")}${joint}`,
);
