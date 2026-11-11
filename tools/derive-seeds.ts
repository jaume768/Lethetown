/**
 * Propone los datos derivados de cada semilla de seeds/agents.json a partir de sus rasgos, su
 * edad, su descripción, su trabajo y sus relaciones. Es un punto de partida: los valores del
 * repositorio están revisados a mano después (ver docs/historial.md).
 *
 * - personality: Big Five y perfil de memoria.
 * - knowledge: perfil de conocimiento (estudios, oficio, idiomas, lugares de fuera, intereses,
 *   nivel cultural) en la época de config/world.json.
 * - goals: una meta vital y uno o dos proyectos medibles, solo con el catálogo de criterios que
 *   el motor sabe medir (GoalCriterion en shared; los conflictos sembrados, con `resource`).
 * - skills: niveles de partida de las habilidades del catálogo de agent-core (DEFAULT_SKILLS); un
 *   test comprueba que encajan con cada oficio.
 * - all: los cuatro, en ese orden (cada uno ve lo que escribió el anterior).
 *
 * Uso: pnpm seeds:derive <personality|knowledge|goals|skills|all>   (muestra la propuesta)
 *      pnpm seeds:derive <tipo> --write           (la escribe en los agentes que no tienen)
 *      pnpm seeds:derive <tipo> --write --force   (sobrescribe también lo revisado)
 */
import { readFileSync, writeFileSync } from "node:fs";
// Ruta relativa: la raíz no depende de agent-core (solo del catálogo, que es lógica pura).
import { DEFAULT_SKILLS, LEVEL_THRESHOLDS } from "../packages/agent-core/src/skills/skills";
import {
  AgentSeed,
  SeedGoal,
  seedIsMinor,
  type BigFive,
  type GoalCriterion,
  type KnowledgeProfile,
  type MemoryProfileSeed,
  type SeedSkills,
} from "@lethetown/shared";

const FILE = new URL("../seeds/agents.json", import.meta.url);
const WORLD = new URL("../config/world.json", import.meta.url);

// --- personality ---------------------------------------------------------------------------

type Trait = keyof BigFive;

/** Palabra clave (en rasgos o descripción) → empujones a los rasgos Big Five. */
const CUES: [RegExp, Partial<Record<Trait, number>>][] = [
  [
    /creativ|curios|soñador|bohemi|idealista|fantasios|imaginativ|fotógraf|músic/i,
    { openness: 0.15 },
  ],
  [/nostálgic|cabezot|terc/i, { openness: -0.1 }],
  [
    /trabajador|meticulos|perfeccionista|puntual|eficiente|responsable|práctic|ahorrador|madrugador|adicto al trabajo/i,
    { conscientiousness: 0.15 },
  ],
  [
    /despistad|impuntual|olvidadiz|desmemoriad|impulsiv|rebelde|inquiet/i,
    { conscientiousness: -0.15 },
  ],
  [
    /sociable|extrovertid|carismátic|bromista|alegre|chismos|cotilla|entusiasta|coquet|preguntón|valiente/i,
    { extraversion: 0.15 },
  ],
  [/tímid|reservad|tranquil|observador|melancólic/i, { extraversion: -0.15 }],
  [
    /cálid|cariños|generos|amable|empátic|servicial|dulce|paciente|leal|diplomátic|protector/i,
    { agreeableness: 0.12 },
  ],
  [
    /sarcástic|cascarrabias|mandon|controlador|ambicios|cabezot|terc|rebelde/i,
    { agreeableness: -0.12 },
  ],
  [
    /insegur|se agobia|hipocondríac|supersticios|melancólic|siempre cansad|nostálgic|preocup|miedo/i,
    { neuroticism: 0.15 },
  ],
  [/seren|tranquil|paciente|alegre|valiente/i, { neuroticism: -0.12 }],
];

/** Palabra clave → particularidades de la memoria. */
const MEMORY_CUES: [RegExp, Partial<MemoryProfileSeed>][] = [
  // Primero lo general: lo específico (memoriosa, desmemoriada) lo sobrescribe.
  [/chismos|cotilla/i, { sourceConfusion: 1.2 }],
  [/memorios/i, { episodicStability: 1.5, semanticStability: 1.3, sourceConfusion: 0.6 }],
  [
    /desmemoriad|su memoria falla/i,
    { episodicStability: 0.5, sourceConfusion: 1.6, suggestibility: 1.3 },
  ],
  [/olvidadizo con las fechas|desastre con las fechas/i, { dateForgetting: 2.5 }],
  [/despistad/i, { intentionForgetting: 1.4 }],
  [/fantasios|soñador/i, { suggestibility: 1.3 }],
  [/meticulos|perfeccionista/i, { intentionForgetting: 0.8 }],
];

const roundTrait = (x: number) => Math.round(Math.min(0.95, Math.max(0.05, x)) * 100) / 100;

function derivePersonality(seed: AgentSeed): {
  personality: BigFive;
  memoryProfile: Partial<MemoryProfileSeed>;
} {
  const text = `${seed.traits.join(", ")}. ${seed.description}`;
  const p: BigFive = {
    openness: 0.5,
    conscientiousness: 0.5,
    extraversion: 0.5,
    agreeableness: 0.5,
    neuroticism: 0.5,
  };
  for (const [re, push] of CUES) {
    const hits = text.match(new RegExp(re.source, "gi"))?.length ?? 0;
    for (const [k, v] of Object.entries(push) as [Trait, number][]) p[k] += v * Math.min(2, hits);
  }
  // Con la edad, algo más de responsabilidad y amabilidad y menos apertura (tendencia media).
  const decades = (seed.age - 30) / 10;
  p.conscientiousness += 0.02 * decades;
  p.agreeableness += 0.02 * decades;
  p.openness -= 0.015 * decades;
  const memoryProfile: Partial<MemoryProfileSeed> = {};
  for (const [re, profile] of MEMORY_CUES) if (re.test(text)) Object.assign(memoryProfile, profile);
  return {
    personality: Object.fromEntries(
      Object.entries(p).map(([k, v]) => [k, roundTrait(v)]),
    ) as BigFive,
    memoryProfile,
  };
}

// --- knowledge -----------------------------------------------------------------------------

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

function deriveKnowledge(seed: AgentSeed): KnowledgeProfile {
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

// --- goals ---------------------------------------------------------------------------------

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

function deriveGoals(seed: AgentSeed, all: AgentSeed[]): SeedGoal {
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

// --- skills --------------------------------------------------------------------------------

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
function extraLanguages(seed: AgentSeed): number {
  let n = 0;
  for (const l of seed.knowledge?.languages ?? []) {
    if (/castellano|mallorquín|catalán/i.test(l)) continue;
    n += /algo de|del instituto|de las canciones|leído/i.test(l) ? 0.08 : 0.2;
  }
  return Math.min(0.8, n);
}

const roundSkill = (x: number) => Math.round(x * 20) / 20;

/**
 * Ningún nivel de partida en un umbral de etiqueta (± 0,01): unas milésimas de olvido lo
 * bajarían de etiqueta a la vez que a otros (8 por mundo el día 4 de la partida de una semana).
 * Se queda 0,03 por encima, con la etiqueta que se quería.
 */
function offThreshold(x: number): number {
  const near = LEVEL_THRESHOLDS.some((t) => Math.abs(x - t) <= 0.01 + 1e-9);
  return near ? Math.round((x + 0.03) * 100) / 100 : x;
}

function deriveSkills(seed: AgentSeed): SeedSkills {
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
  const langs = extraLanguages(seed);
  if (langs) out.languages = langs;
  // Un menor no es experto en nada todavía.
  for (const [skill, v] of Object.entries(out)) {
    out[skill] = offThreshold(roundSkill(minor ? Math.min(v, 0.4) : v));
  }
  const known = new Set(DEFAULT_SKILLS.map((s) => s.id));
  return Object.fromEntries(Object.entries(out).filter(([id, v]) => known.has(id) && v > 0));
}

type Entry = Record<string, unknown>;

/** Qué se deriva: la propuesta de una semilla y cómo se escribe en su entrada. */
interface Kind {
  propose(seed: AgentSeed, all: AgentSeed[]): unknown;
  /** Si la entrada ya lo tiene (sin `--force` no se toca). */
  has(entry: Entry, seed: AgentSeed): boolean;
  write(entry: Entry, proposal: never): void;
}

const KINDS = {
  personality: {
    propose: (seed) => derivePersonality(seed),
    has: (entry) => Boolean(entry.personality),
    write: (entry, p: ReturnType<typeof derivePersonality>) => {
      entry.personality = p.personality;
      if (Object.keys(p.memoryProfile).length) entry.memoryProfile = p.memoryProfile;
    },
  },
  knowledge: {
    propose: (seed) => deriveKnowledge(seed),
    has: (entry) => Boolean(entry.knowledge),
    write: (entry, p: KnowledgeProfile) => {
      entry.knowledge = p;
    },
  },
  goals: {
    propose: (seed, all) => SeedGoal.parse(deriveGoals(seed, all)),
    has: (entry) => Boolean(entry.goals),
    write: (entry, p: SeedGoal) => {
      entry.goals = p;
    },
  },
  skills: {
    propose: (seed) => deriveSkills(seed),
    has: (_entry, seed) => Object.keys(seed.skills).length > 0,
    write: (entry, p: SeedSkills) => {
      entry.skills = p;
    },
  },
} satisfies Record<string, Kind>;
type KindName = keyof typeof KINDS;

const [arg, ...flags] = process.argv.slice(2);
const names = Object.keys(KINDS) as KindName[];
if (arg !== "all" && !names.includes(arg as KindName)) {
  console.error(`Uso: pnpm seeds:derive <${names.join("|")}|all> [--write [--force]]`);
  process.exit(1);
}
const write = flags.includes("--write");
const force = flags.includes("--force");
const raw = JSON.parse(readFileSync(FILE, "utf8")) as Entry[];
for (const name of arg === "all" ? names : [arg as KindName]) {
  const kind: Kind = KINDS[name];
  // Se vuelve a leer cada vez: goals usa el conocimiento y skills, lo que escribió knowledge.
  const seeds = AgentSeed.array().parse(raw);
  if (arg === "all") console.log(`\n## ${name}`);
  for (const [i, seed] of seeds.entries()) {
    const proposal = kind.propose(seed, seeds);
    console.log(`${seed.id} (${seed.age}): ${JSON.stringify(proposal)}`);
    const entry = raw[i]!;
    if (write && (force || !kind.has(entry, seed))) kind.write(entry, proposal as never);
  }
}
if (write) {
  writeFileSync(FILE, `${JSON.stringify(raw, null, 2)}\n`);
  console.log("\nEscrito en seeds/agents.json (revísalo a mano y pasa prettier).");
}
