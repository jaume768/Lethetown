/**
 * Propone una meta vital y uno o dos proyectos medibles por agente de seeds/agents.json, a partir
 * de su trabajo, sus temas, sus relaciones y su perfil de conocimiento. Solo usa el catálogo de
 * criterios que el motor sabe medir (GoalCriterion en shared). Es un punto de partida: las metas
 * del repositorio están revisadas a mano después (coherentes con 1996 y con cada personaje; los
 * conflictos sembrados, con `resource`).
 *
 * Uso: pnpm goals:derive             (muestra la propuesta)
 *      pnpm goals:derive --write     (la escribe en los agentes que no tienen)
 *      pnpm goals:derive --write --force   (sobrescribe también las revisadas)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { AgentSeed, SeedGoal, seedIsMinor, type GoalCriterion } from "@lethetown/shared";

const FILE = new URL("../seeds/agents.json", import.meta.url);

/** Palabras clave de actividad por tema (para las horas dedicadas). */
const ACTIVITY: [RegExp, string[]][] = [
  [/fotograf|cámara/i, ["foto", "revel", "carrete"]],
  [/dibuj|ilustr/i, ["dibuj", "ilustr", "pint"]],
  [/músic|guitarr|canción/i, ["guitarr", "toca", "compon"]],
  [/pan|horno/i, ["horne", "pan", "masa"]],
  [/huerto|plantas|jardín/i, ["huerto", "plant", "regar"]],
  [/libro|bibliotec/i, ["leer", "libro", "archiv"]],
  [/pesca|lago/i, ["pesca", "caña"]],
  [/correo|carta/i, ["correo", "carta", "reparti"]],
];

export function derive(seed: AgentSeed, all: AgentSeed[]): SeedGoal {
  const text = `${seed.description} ${(seed.speechStyle?.topics ?? []).join(" ")}`;
  const projects: SeedGoal["projects"] = [];
  const keywords = ACTIVITY.find(([re]) => re.test(text))?.[1];
  if (keywords) {
    projects.push({
      text: `Dedicar tiempo a lo suyo (${keywords[0]}…)`,
      criterion: { type: "activity_hours", keywords, hours: 10 },
      steps: [],
    });
  } else if (seed.workId) {
    projects.push({
      text: `Cuidar su trabajo en ${seed.workId}`,
      criterion: { type: "place_time", placeId: seed.workId, hours: 20 },
      steps: [],
    });
  }
  // Con quien más le importa (la primera relación que no es de trabajo).
  const close = seed.relationships.find((r) => r.bond !== "work") ?? seed.relationships[0];
  if (close) {
    const other = all.find((s) => s.id === close.with);
    const criterion: GoalCriterion =
      other && seedIsMinor(other) !== seedIsMinor(seed)
        ? { type: "conversations", personId: close.with, count: 3 }
        : { type: "relationship", personId: close.with, affinity: 0.6 };
    projects.push({
      text: `Llevarse mejor con ${other?.name.split(" ")[0] ?? close.with}`,
      criterion,
      steps: [],
    });
  }
  if (!projects.length) {
    projects.push({
      text: "Conocer mejor a la gente del pueblo",
      criterion: { type: "conversations", people: 5, count: 5 },
      steps: [],
    });
  }
  // Irse a Palma: si su descripción lo dice (los menores, para cuando sean mayores).
  const leaves = /marcharse|irse a|estudiar .*Palma|en Palma/i.test(seed.description);
  return {
    text: leaves
      ? seedIsMinor(seed)
        ? "Prepararse para irse a estudiar a Palma cuando sea mayor de edad"
        : "Irse a estudiar a Palma"
      : `Una vida a su manera en ${seed.workId ?? "el pueblo"}`,
    ...(leaves ? { departure: { to: "Palma" } } : {}),
    projects,
  };
}

const args = new Set(process.argv.slice(2));
const raw = JSON.parse(readFileSync(FILE, "utf8")) as Record<string, unknown>[];
const seeds = AgentSeed.array().parse(raw);
for (const [i, seed] of seeds.entries()) {
  const proposal = SeedGoal.parse(derive(seed, seeds));
  console.log(`${seed.id} (${seed.age}): ${JSON.stringify(proposal)}`);
  const entry = raw[i]!;
  if (args.has("--write") && (args.has("--force") || !entry.goals)) entry.goals = proposal;
}
if (args.has("--write")) {
  writeFileSync(FILE, JSON.stringify(raw, null, 2) + "\n");
  console.log("\nEscrito en seeds/agents.json (revísalo a mano).");
}
