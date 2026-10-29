/**
 * Propone una personalidad (Big Five) y un perfil de memoria coherentes con los rasgos, la edad y
 * la descripción de cada agente de seeds/agents.json. Es un punto de partida: los valores del
 * repositorio están revisados a mano después.
 *
 * Uso: pnpm personality:derive             (muestra la propuesta)
 *      pnpm personality:derive --write     (la escribe en los agentes que no tienen)
 *      pnpm personality:derive --write --force   (sobrescribe también los revisados)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { AgentSeed, type BigFive, type MemoryProfileSeed } from "@lethetown/shared";

const FILE = new URL("../seeds/agents.json", import.meta.url);

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

const round = (x: number) => Math.round(Math.min(0.95, Math.max(0.05, x)) * 100) / 100;

export function derive(seed: AgentSeed): {
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
    personality: Object.fromEntries(Object.entries(p).map(([k, v]) => [k, round(v)])) as BigFive,
    memoryProfile,
  };
}

const args = new Set(process.argv.slice(2));
const raw = JSON.parse(readFileSync(FILE, "utf8")) as Record<string, unknown>[];
const seeds = AgentSeed.array().parse(raw);
for (const [i, seed] of seeds.entries()) {
  const proposal = derive(seed);
  console.log(`${seed.id} (${seed.age}): ${JSON.stringify(proposal)}`);
  const entry = raw[i]!;
  if (args.has("--write") && (args.has("--force") || !entry.personality)) {
    entry.personality = proposal.personality;
    if (Object.keys(proposal.memoryProfile).length) entry.memoryProfile = proposal.memoryProfile;
  }
}
if (args.has("--write")) {
  writeFileSync(FILE, JSON.stringify(raw, null, 2) + "\n");
  console.log("\nEscrito en seeds/agents.json (revísalo a mano).");
}
