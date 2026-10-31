/**
 * Propone un perfil de conocimiento (estudios, oficio, idiomas, lugares de fuera, intereses y
 * nivel cultural) coherente con la edad, la descripción, el trabajo y los rasgos de cada agente de
 * seeds/agents.json, en la época de config/world.json. Es un punto de partida: los perfiles del
 * repositorio están revisados a mano después (ver PROGRESS-MUNDO-METAS.md).
 *
 * Uso: pnpm knowledge:derive             (muestra la propuesta)
 *      pnpm knowledge:derive --write     (la escribe en los agentes que no tienen)
 *      pnpm knowledge:derive --write --force   (sobrescribe también los revisados)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { AgentSeed, type KnowledgeProfile } from "@lethetown/shared";

const FILE = new URL("../seeds/agents.json", import.meta.url);
const WORLD = new URL("../config/world.json", import.meta.url);

/** Oficio por palabra clave de la descripción o el trabajo → estudios, oficio, intereses. */
const JOBS: [RegExp, { studies: string; occupation: string; interests: string[] }][] = [
  [
    /médic|doctor|consultorio/i,
    { studies: "Medicina", occupation: "médico", interests: ["medicina"] },
  ],
  [
    /bibliotec/i,
    {
      studies: "Filosofía y Letras; Biblioteconomía",
      occupation: "bibliotecario",
      interests: ["libros", "historia"],
    },
  ],
  [/maestr|escuela/i, { studies: "Magisterio", occupation: "maestra", interests: ["enseñar"] }],
  [
    /alcald|ayuntamiento/i,
    { studies: "Derecho", occupation: "alcaldesa", interests: ["política municipal"] },
  ],
  [/panader/i, { studies: "EGB", occupation: "panadero", interests: ["el pan y el horno"] }],
  [
    /cartero/i,
    {
      studies: "bachillerato elemental",
      occupation: "cartero de Correos",
      interests: ["el correo"],
    },
  ],
  [/fotógraf/i, { studies: "fotografía", occupation: "fotógrafa", interests: ["fotografía"] }],
  [
    /ilustrador/i,
    { studies: "Bellas Artes", occupation: "ilustradora", interests: ["ilustración"] },
  ],
  [
    /músic/i,
    {
      studies: "sin terminar el bachillerato",
      occupation: "músico callejero",
      interests: ["música"],
    },
  ],
  [
    /pescador/i,
    { studies: "escuela hasta los doce", occupation: "pescador", interests: ["la pesca"] },
  ],
  [
    /jardiner|huerto/i,
    { studies: "FP de jardinería", occupation: "jardinera", interests: ["plantas"] },
  ],
  [/taberna/i, { studies: "EGB", occupation: "tabernero", interests: ["la noche y los rumores"] }],
  [
    /caf[eé]/i,
    { studies: "EGB y FP de hostelería", occupation: "lleva un café", interests: ["el café"] },
  ],
  [/ultramarinos|tienda/i, { studies: "BUP", occupation: "tendera", interests: ["la tienda"] }],
  [
    /mercadillo|fruta/i,
    { studies: "COU", occupation: "vende fruta en el mercadillo", interests: ["la fruta"] },
  ],
];

/** Lugares de fuera que se nombran en la descripción o los recuerdos. */
const OUTSIDE = /\b(Palma|Barcelona|Madrid|Lagos|Londres|París|Inca|Sóller|Ibiza|Menorca)\b/g;

const world = JSON.parse(readFileSync(WORLD, "utf8")) as { year: number };

export function derive(seed: AgentSeed): KnowledgeProfile {
  const text = `${seed.description} ${seed.workId ?? ""} ${seed.initialMemories.join(" ")}`;
  // El oficio, por el trabajo y la primera frase (en los recuerdos salen los oficios de otros).
  const who = `${seed.workId ?? ""} ${seed.description.split(". ")[0]}`;
  const job = JOBS.find(([re]) => re.test(who))?.[1];
  const born = world.year - seed.age;
  const minor = seed.age < 18;
  const studies = minor
    ? seed.age <= 13
      ? "EGB en la escuela del pueblo"
      : "BUP en la escuela del pueblo"
    : seed.age >= 65
      ? "escuela hasta los doce"
      : (job?.studies ?? "EGB");
  const places = [...new Set([...text.matchAll(OUTSIDE)].map((m) => m[1]!))];
  if (!places.includes("Palma")) places.unshift("Palma");
  const languages = ["castellano"];
  // Los nacidos aquí hablan mallorquín; quien llegó de fuera, lo suyo.
  if (!/lleg[óo]|mud[óo]/i.test(seed.description)) languages.push("mallorquín");
  if (/Lagos/.test(text)) languages.unshift("inglés", "igbo", "yoruba");
  if (!minor && seed.age < 45 && !languages.includes("inglés")) languages.push("algo de inglés");
  const culture: KnowledgeProfile["culture"] =
    /Medicina|Derecho|Letras|Magisterio|Bellas Artes|fotografía/.test(studies)
      ? "alto"
      : born < 1935 || minor
        ? "básico"
        : "medio";
  return {
    studies,
    occupation: minor
      ? "estudiante"
      : seed.age >= 65
        ? `jubilado (${job?.occupation ?? "su oficio"})`
        : (job?.occupation ?? "su oficio"),
    languages,
    places,
    interests: [...(job?.interests ?? []), ...(seed.speechStyle?.topics ?? [])].slice(0, 4),
    culture,
  };
}

const args = new Set(process.argv.slice(2));
const raw = JSON.parse(readFileSync(FILE, "utf8")) as Record<string, unknown>[];
const seeds = AgentSeed.array().parse(raw);
for (const [i, seed] of seeds.entries()) {
  const proposal = derive(seed);
  console.log(`${seed.id} (${seed.age}): ${JSON.stringify(proposal)}`);
  const entry = raw[i]!;
  if (args.has("--write") && (args.has("--force") || !entry.knowledge)) entry.knowledge = proposal;
}
if (args.has("--write")) {
  writeFileSync(FILE, JSON.stringify(raw, null, 2) + "\n");
  console.log("\nEscrito en seeds/agents.json (revísalo a mano).");
}
