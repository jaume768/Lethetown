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
  const rumor = /^- Oí a (.+?) decirle a .+? algo como: "(.+)"$/m.exec(p);

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
  if (!speaker && someone && rumor && h % 2 === 0) {
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

export function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
