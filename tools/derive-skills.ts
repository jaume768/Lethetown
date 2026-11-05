/**
 * Propone los niveles de partida de las habilidades (`skills` en seeds/agents.json) a partir del
 * oficio, los intereses, la descripción, los idiomas y la edad de cada semilla. Solo usa el
 * catálogo de agent-core (DEFAULT_SKILLS). Es un punto de partida: los niveles del repositorio
 * están revisados a mano después (un test comprueba que encajan con cada oficio).
 *
 * Uso: pnpm skills:derive             (muestra la propuesta)
 *      pnpm skills:derive --write     (la escribe en los agentes que no tienen)
 *      pnpm skills:derive --write --force   (sobrescribe también las revisadas)
 */
import { readFileSync, writeFileSync } from "node:fs";
// Ruta relativa: la raíz no depende de agent-core (solo del catálogo, que es lógica pura).
import { DEFAULT_SKILLS, LEVEL_THRESHOLDS } from "../packages/agent-core/src/skills/skills";
import { AgentSeed, type SeedSkills } from "@lethetown/shared";

const FILE = new URL("../seeds/agents.json", import.meta.url);

/** Habilidad → patrón en el oficio (nivel alto) y en intereses o descripción (nivel medio). */
const SIGNS: Record<string, { re: RegExp; job: number; hobby: number }> = {
  baking: { re: /panader|ensaimad|reposter|horno/i, job: 0.85, hobby: 0.3 },
  hospitality: { re: /café|camarer|taberna|hostel/i, job: 0.75, hobby: 0.3 },
  gardening: { re: /huerto|jardin|campo|plantas/i, job: 0.75, hobby: 0.45 },
  fishing: { re: /pesca|pescador/i, job: 0.9, hobby: 0.4 },
  photography: { re: /fotógraf|fotograf|revelado/i, job: 0.85, hobby: 0.35 },
  drawing: { re: /ilustr|dibuj|acuarela/i, job: 0.8, hobby: 0.3 },
  music: { re: /músic|guitarr|canciones/i, job: 0.75, hobby: 0.3 },
  teaching: { re: /maestr|pedagog|enseñ/i, job: 0.75, hobby: 0.3 },
  care: { re: /médic|enfermer|primeros auxilios|medicina|remedios/i, job: 0.85, hobby: 0.3 },
  trade: { re: /tienda|puesto|mercad|negocio|cuentas/i, job: 0.65, hobby: 0.3 },
  storytelling: { re: /historias|juventud|rumores|cuentos/i, job: 0.6, hobby: 0.45 },
};

/** Idiomas que no son el castellano ni el mallorquín: suman a «idiomas». */
function languages(seed: AgentSeed): number {
  let n = 0;
  for (const l of seed.knowledge?.languages ?? []) {
    if (/castellano|mallorquín|catalán/i.test(l)) continue;
    n += /algo de|del instituto|de las canciones|leído/i.test(l) ? 0.08 : 0.2;
  }
  return Math.min(0.8, n);
}

const round = (x: number) => Math.round(x * 20) / 20;

/**
 * Ningún nivel de partida en un umbral de etiqueta (± 0,01): unas milésimas de olvido lo
 * bajarían de etiqueta a la vez que a otros (8 por mundo el día 4 de la partida de una semana).
 * Se queda 0,03 por encima, con la etiqueta que se quería.
 */
export function offThreshold(x: number): number {
  const near = LEVEL_THRESHOLDS.some((t) => Math.abs(x - t) <= 0.01 + 1e-9);
  return near ? Math.round((x + 0.03) * 100) / 100 : x;
}

export function derive(seed: AgentSeed): SeedSkills {
  const k = seed.knowledge;
  const job = `${k?.occupation ?? ""}`;
  const hobby = `${(k?.interests ?? []).join(" ")} ${seed.description}`;
  const minor = seed.age < 18;
  const out: SeedSkills = {};
  // Todo adulto sabe algo de cocina y de arreglar cosas de casa.
  out.cooking = minor ? 0.1 : seed.age > 60 ? 0.5 : 0.3;
  out.repair = minor ? 0.05 : 0.15;
  for (const [skill, s] of Object.entries(SIGNS)) {
    const level =
      s.re.test(job) && !/estudiante/.test(job) ? s.job : s.re.test(hobby) ? s.hobby : 0;
    if (level) out[skill] = Math.max(out[skill] ?? 0, level);
  }
  const langs = languages(seed);
  if (langs) out.languages = langs;
  // Un menor no es experto en nada todavía.
  for (const [skill, v] of Object.entries(out)) {
    out[skill] = offThreshold(round(minor ? Math.min(v, 0.4) : v));
  }
  const known = new Set(DEFAULT_SKILLS.map((s) => s.id));
  return Object.fromEntries(Object.entries(out).filter(([id, v]) => known.has(id) && v > 0));
}

const write = process.argv.includes("--write");
const force = process.argv.includes("--force");
const raw = JSON.parse(readFileSync(FILE, "utf8")) as Record<string, unknown>[];
const seeds = AgentSeed.array().parse(raw);
for (const [i, seed] of seeds.entries()) {
  const proposal = derive(seed);
  console.log(`${seed.id} (${seed.age}): ${JSON.stringify(proposal)}`);
  const has = Object.keys(seed.skills).length > 0;
  if (write && (!has || force)) raw[i]!.skills = proposal;
}
if (write) {
  writeFileSync(FILE, `${JSON.stringify(raw, null, 2)}\n`);
  console.log("Escrito en seeds/agents.json (revísalo y pasa prettier).");
}
