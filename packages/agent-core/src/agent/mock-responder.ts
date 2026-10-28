import type { MockResponder } from "../llm/mock";
import type { CompletionRequest } from "../llm/types";

/**
 * Respuestas deterministas con sentido para los prompts de agent/prompts.ts.
 * Lee el prompt (lugares, presentes, lo que se oye) igual que lo haría un LLM,
 * así el modo mock ejercita el mismo camino de parseo que los proveedores reales.
 */
export const agentMockResponder: MockResponder = (req) => {
  switch (req.meta.task) {
    case "plan":
      return mockPlan(req);
    case "importance":
      return mockImportance(req);
    case "decide":
      return mockDecide(req);
    default:
      return "{}";
  }
};

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

function mockPlan(req: CompletionRequest): string {
  const places = [...req.system.matchAll(/^- (\S+) \((\w+)\): .+$/gm)].map((m) => ({
    id: m[1]!,
    kind: m[2]!,
  }));
  const home = /^Tu casa: (\S+)$/m.exec(req.system)?.[1] ?? places[0]?.id ?? "home";
  const outings = places.filter((p) => p.kind !== "home");
  const h = hash(req.system + req.prompt);
  const pick = (i: number) => outings[(h + i) % Math.max(1, outings.length)]?.id ?? home;
  const plan = [
    { start: "07:00", durationMin: 60, activity: "desayunar en casa", placeId: home },
    { start: "08:00", durationMin: 150, activity: "ocuparse de sus cosas", placeId: pick(0) },
    { start: "10:30", durationMin: 120, activity: "dar una vuelta", placeId: pick(1) },
    { start: "12:30", durationMin: 90, activity: "comer", placeId: home },
    { start: "14:00", durationMin: 180, activity: "pasar la tarde", placeId: pick(2) },
    { start: "17:00", durationMin: 120, activity: "hacer recados", placeId: pick(3) },
    { start: "19:00", durationMin: 180, activity: "cenar y descansar", placeId: home },
  ];
  return JSON.stringify({ plan });
}

function mockImportance(req: CompletionRequest): string {
  const lines = [...req.prompt.matchAll(/^\d+\. (.+)$/gm)].map((m) => m[1]!);
  const ratings = lines.map((line) => {
    const speech = line.includes("me dijo");
    const positive = /alegr|encant|bien|hola|buenas/i.test(line);
    const negative = /liado|triste|mal/i.test(line);
    return {
      importance: speech ? 4 + (hash(line) % 3) : 2,
      valence: positive ? 0.4 : negative ? -0.2 : 0,
    };
  });
  return JSON.stringify({ ratings });
}

function mockDecide(req: CompletionRequest): string {
  const h = hash(req.prompt);
  const presentLine = /^PRESENTES: (.+)$/m.exec(req.prompt)?.[1] ?? "nadie";
  const present =
    presentLine === "nadie" ? [] : presentLine.split("; ").map((p) => p.slice(0, p.indexOf("=")));
  const heard = [...req.prompt.matchAll(/^(\S+)=[^:]+: "/gm)].map((m) => m[1]!);

  const speaker = heard[0];
  if (speaker && present.includes(speaker) && h % 3 !== 0) {
    return JSON.stringify({ choice: "talk", to: speaker, say: REPLIES[h % REPLIES.length] });
  }
  const someone = present[h % Math.max(1, present.length)];
  if (!speaker && someone && h % 2 === 0) {
    return JSON.stringify({ choice: "talk", to: someone, say: GREETINGS[h % GREETINGS.length] });
  }
  return JSON.stringify({ choice: "continue" });
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
