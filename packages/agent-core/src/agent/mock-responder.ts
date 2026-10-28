import type { MockResponder } from "../llm/mock";
import type { CompletionRequest } from "../llm/types";

/**
 * Respuestas deterministas con sentido para los prompts de agent/prompts.ts (y de memory/llm-*.ts).
 * Lee el prompt (lugares, objetos, presentes, lo que se oye) igual que lo haría un LLM,
 * así el modo mock ejercita el mismo camino de parseo que los proveedores reales.
 */
export const agentMockResponder: MockResponder = (req) => {
  const handler = HANDLERS[req.meta.task];
  return handler ? handler(req) : "{}";
};

const HANDLERS: Record<string, (req: CompletionRequest) => string> = {
  plan: mockPlan,
  importance: mockImportance,
  decide: mockDecide,
  consolidate: mockConsolidate,
  gist: mockGist,
  reconsolidate: mockReconsolidate,
  summarize: mockSummarize,
  social: mockSocial,
  chronicle: mockChronicle,
  interview: mockInterview,
};

/** Permite a otros módulos (memoria, crónica, entrevistas) registrar su respuesta mock. */
export function registerMockHandler(
  task: string,
  handler: (req: CompletionRequest) => string,
): void {
  HANDLERS[task] = handler;
}

const GREETINGS = [
  "¡Hola! ¿Qué tal te va el día?",
  "¡Buenas! Hacía tiempo que no te veía.",
  "Hola, ¿has probado el café nuevo?",
  "¡Qué casualidad verte por aquí!",
];
const REPLIES = [
  "Muy bien, gracias. Aquí, disfrutando un rato.",
  "Bastante liado, la verdad. ¿Y tú?",
  "¡Sí! Me encantó. Deberíamos venir juntos.",
  "Pues ya ves, lo de siempre. Me alegro de verte.",
];

interface MockPlace {
  id: string;
  kind: string;
  objects: { id: string; pose: string }[];
}

export function parsePlaces(system: string): MockPlace[] {
  return [...system.matchAll(/^- (\S+) \((\w+)\): .+?(?: · objetos: (.+))?$/gm)].map((m) => ({
    id: m[1]!,
    kind: m[2]!,
    objects: [...(m[3] ?? "").matchAll(/(\w+)\[(\w+)\]/g)].map((o) => ({ id: o[1]!, pose: o[2]! })),
  }));
}

const OUTING: Record<string, { activity: string; kind: string; pose: string }> = {
  cafe: { activity: "tomar un café", kind: "eat", pose: "sit" },
  park: { activity: "pasear y sentarse en el banco", kind: "sit", pose: "sit" },
  shop: { activity: "hacer la compra", kind: "work", pose: "use" },
  home: { activity: "descansar en casa", kind: "idle", pose: "sit" },
  other: { activity: "dar una vuelta", kind: "idle", pose: "stand" },
};

function mockPlan(req: CompletionRequest): string {
  const places = parsePlaces(req.system);
  const homeId = /^Tu casa: (\S+)$/m.exec(req.system)?.[1] ?? places[0]?.id ?? "home";
  const home = places.find((p) => p.id === homeId);
  const kitchen = home?.objects.find((o) => o.pose === "use")?.id ?? null;
  const outings = places.filter((p) => p.kind !== "home");
  const h = hash(req.system + req.prompt);
  // Solo dos "perfiles" de agenda, para que los agentes coincidan a menudo en algún sitio.
  const pick = (i: number) => outings[(i + (h % 2) * (i % 2)) % Math.max(1, outings.length)];
  const outing = (start: string, durationMin: number, i: number) => {
    const place = pick(i);
    if (!place)
      return {
        start,
        durationMin,
        activity: "estar en casa",
        activityKind: "idle",
        placeId: homeId,
        spotId: null,
      };
    const o = OUTING[place.kind] ?? OUTING.other!;
    const spot = place.objects.find((s) => s.pose === o.pose) ?? null;
    return {
      start,
      durationMin,
      activity: o.activity,
      activityKind: o.kind,
      placeId: place.id,
      spotId: spot?.id ?? null,
    };
  };
  const plan = [
    {
      start: "07:00",
      durationMin: 60,
      activity: "preparar el desayuno",
      activityKind: "cook",
      placeId: homeId,
      spotId: kitchen,
    },
    outing("08:00", 150, 0),
    outing("10:30", 120, 1),
    {
      start: "12:30",
      durationMin: 90,
      activity: "comer",
      activityKind: "eat",
      placeId: homeId,
      spotId: null,
    },
    outing("14:00", 180, 2),
    outing("17:00", 120, 3),
    {
      start: "19:00",
      durationMin: 180,
      activity: "cenar y descansar",
      activityKind: "eat",
      placeId: homeId,
      spotId: null,
    },
  ];
  return JSON.stringify({ plan });
}

function mockImportance(req: CompletionRequest): string {
  const lines = [...req.prompt.matchAll(/^\d+\. (.+)$/gm)].map((m) => m[1]!);
  const ratings = lines.map((line) => {
    const speech = /me dijo|Oí a/.test(line);
    const thought = line.startsWith("Pensé:");
    const positive = /alegr|encant|bien|hola|buenas/i.test(line);
    const negative = /liado|triste|mal|rota|roto|llueve/i.test(line);
    return {
      importance: thought ? 7 : speech ? 4 + (hash(line) % 3) : negative ? 5 : 2,
      valence: positive ? 0.4 : negative ? -0.3 : 0,
    };
  });
  return JSON.stringify({ ratings });
}

function mockDecide(req: CompletionRequest): string {
  const h = hash(req.prompt);
  const p = req.prompt;
  const here = /^Es .+?\. Estás en (\S+) haciendo/m.exec(p)?.[1] ?? "";
  const presentLine = /^PRESENTES: (.+)$/m.exec(p)?.[1] ?? "nadie";
  const present =
    presentLine === "nadie" ? [] : presentLine.split("; ").map((x) => x.slice(0, x.indexOf("=")));
  const heard = [...p.matchAll(/^(\S+)=[^:\n]+: "/gm)].map((m) => m[1]!);
  const broken = /^OBJETOS: (.+)$/m
    .exec(p)?.[1]
    ?.match(/(\w+): (rot[oa]|estropead[oa]|averiad[oa])/);
  const thought = /^- Pensé: (.+)$/m.exec(p)?.[1];
  // Rumor: algo oído a escondidas que no sea ya un rumor (evita "oí que oí que...").
  const rumor = [...p.matchAll(/^- Oí a (.+?) decirle a .+? algo como: "(.+)"$/gm)].find(
    (m) => !/Oí a|Sabes/.test(m[2]!),
  );

  if (broken && h % 2 === 0) {
    return JSON.stringify({
      choice: "react",
      action: `mirar qué le pasa a ${broken[1]}`,
      activityKind: "work",
      placeId: here,
    });
  }
  const speaker = heard[0];
  if (speaker && present.includes(speaker) && h % 3 !== 0) {
    return JSON.stringify({ choice: "talk", to: speaker, say: REPLIES[h % REPLIES.length] });
  }
  const someone = present[h % Math.max(1, present.length)];
  if (!speaker && someone && rumor && h % 4 === 0) {
    return JSON.stringify({
      choice: "talk",
      to: someone,
      say: `¿Sabes? Oí a ${rumor[1]} decir "${rumor[2]}".`,
    });
  }
  if (!speaker && someone && h % 2 === 0) {
    return JSON.stringify({ choice: "talk", to: someone, say: GREETINGS[h % GREETINGS.length] });
  }
  if (thought && !speaker && h % 3 === 0) {
    return JSON.stringify({
      choice: "react",
      action: `pensar en ello: ${thought.slice(0, 40)}`,
      activityKind: "idle",
      placeId: here,
    });
  }
  return JSON.stringify({ choice: "continue" });
}

/** Recuerdos numerados ("1. texto") de un prompt. */
function numbered(prompt: string): string[] {
  return [...prompt.matchAll(/^\d+\. (.+)$/gm)].map((m) => m[1]!);
}

function mockConsolidate(req: CompletionRequest): string {
  const lines = numbered(req.prompt);
  const people = [
    ...(/^Personas que conoces: (.+)$/m.exec(req.prompt)?.[1] ?? "").matchAll(/(\w+)=([^,]+)/g),
  ];
  const mentioned = people.filter(([, , name]) =>
    lines.some((l) => l.includes(name!.split(" ")[0]!)),
  );
  const talks = lines
    .map((l, i) => ({ l, n: i + 1 }))
    .filter(({ l }) => /dijo|Le dije|Oí a/.test(l));
  const insights = [];
  if (talks.length) {
    insights.push({
      text: `Hoy he hablado bastante con la gente del pueblo; me sienta bien tener compañía.`,
      cites: talks.slice(0, 3).map((t) => t.n),
      importance: 6,
      valence: 0.3,
    });
  }
  if (lines.length) {
    insights.push({
      text: `Mi día gira alrededor de mis rutinas: ${lines[0]!.slice(0, 60)}`,
      cites: [1],
      importance: 5,
      valence: 0.1,
    });
  }
  return JSON.stringify({
    questions: ["¿Con quién me siento más a gusto en el pueblo?"],
    insights,
    facts: talks.length
      ? [{ text: `Suelo encontrarme con gente en el café.`, cites: [talks[0]!.n] }]
      : [],
    people: mentioned.map(([, id]) => ({
      id,
      summary: "Alguien con quien hablo a menudo.",
      affinityDelta: 0.05,
      trustDelta: 0.02,
    })),
  });
}

function mockGist(req: CompletionRequest): string {
  const text = /Recuerdo: "(.+)"$/m.exec(req.prompt)?.[1] ?? "algo";
  const words = text
    .replace(/"[^"]*"/g, "algo")
    .split(/\s+/)
    .slice(0, 5)
    .join(" ");
  return JSON.stringify({ gist: `${words}…` });
}

function mockReconsolidate(req: CompletionRequest): string {
  const text = /Estás recordando esto: "(.+)"$/m.exec(req.prompt)?.[1] ?? "";
  const mood = /Tu ánimo ahora: ([^.]+)\./.exec(req.prompt)?.[1] ?? "neutral";
  const sad = /apagado|triste/.test(mood);
  const happy = /contento|buen humor/.test(mood);
  const suffix = sad
    ? " (aunque ahora me parece más triste de lo que fue)"
    : happy
      ? " (y fue muy agradable)"
      : " (más o menos)";
  const already = /\((aunque|y fue|más o menos)/.test(text);
  return JSON.stringify({
    text: already ? text : `${text}${suffix}`,
    valence: sad ? -0.2 : happy ? 0.3 : 0,
  });
}

function mockSummarize(req: CompletionRequest): string {
  const lines = numbered(req.prompt);
  return JSON.stringify({
    summary: `Durante un tiempo pasaron cosas parecidas: ${lines[0]?.slice(0, 50) ?? "rutinas"} (y ${lines.length - 1} más).`,
  });
}

function mockSocial(req: CompletionRequest): string {
  const name = /Acabas de hablar con ([^(]+) \(/.exec(req.prompt)?.[1]?.trim() ?? "esa persona";
  const negative = /liado|mal|triste/i.test(req.prompt);
  return JSON.stringify({
    summary: negative ? `${name} parece agobiado últimamente.` : `${name} es agradable de tratar.`,
    affinityDelta: negative ? -0.02 : 0.06,
    trustDelta: 0.02,
  });
}

function mockChronicle(req: CompletionRequest): string {
  const lines = [...req.prompt.matchAll(/^- (.+)$/gm)].map((m) => m[1]!);
  const speech = lines.filter((l) => l.includes("→")).length;
  return JSON.stringify({
    title: `Un día ${speech > 4 ? "animado" : "tranquilo"} en Lethetown`,
    text: `El día empezó con los vecinos preparando el desayuno. ${speech ? `Hubo ${speech} conversaciones, sobre todo en el café.` : "Apenas hubo conversaciones."} Al caer la noche, cada cual volvió a su casa a dormir.`,
  });
}

function mockInterview(req: CompletionRequest): string {
  const question = /^PREGUNTA: (.+)$/m.exec(req.prompt)?.[1] ?? "";
  const memories = [...req.prompt.matchAll(/^- (.+)$/gm)].map((m) => m[1]!);
  const name = /^Eres ([^,]+),/m.exec(req.system)?.[1] ?? "yo";
  const first = memories[0] ?? "no recuerdo nada concreto";
  return JSON.stringify({
    answer: `Soy ${name}. Sobre "${question.slice(0, 40)}": recuerdo que ${first.charAt(0).toLowerCase()}${first.slice(1)}`,
  });
}

export function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
