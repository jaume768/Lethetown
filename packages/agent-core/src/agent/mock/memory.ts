/** Mock de las tareas de memoria: importancia, consolidación, esencia, reconsolidación… */
import type { CompletionRequest } from "../../llm/types";
import { hash, numbered } from "./context";
import { registerMockHandler } from "./registry";

function mockImportance(req: CompletionRequest): string {
  const lines = [...req.prompt.matchAll(/^\d+\. (.+)$/gm)].map((m) => m[1]!);
  const ratings = lines.map((line) => {
    const speech = /me dijo|Oí a/.test(line);
    const thought = line.startsWith("Pensé:");
    const positive = /alegr|encant|bien|hola|buenas|guay|ja, ja/i.test(line);
    const negative =
      /liado|triste|mal|rota|roto|llueve|lluvia|tormenta|niev|calor|averiad|estropead|miedo/i.test(
        line,
      );
    return {
      importance: thought ? 7 : speech ? 4 + (hash(line) % 3) : negative ? 5 : 2,
      valence: positive ? 0.4 : negative ? -0.3 : 0,
    };
  });
  return JSON.stringify({ ratings });
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
  const sad = /apagado|abatido|triste|preocupado|irritable|nervioso/.test(mood);
  const happy = /contento|animado|eufórico|relajado|tranquilo/.test(mood);
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

/** Detalles plausibles con los que el mock "rellena" un recuerdo vago. */
const INVENTED = [
  "y recuerdo que estaba lloviendo",
  "y que alguien se rió al fondo",
  "y que olía a pan recién hecho",
  "y que fue justo después de comer",
  "y que llevaba una bufanda roja",
];

function mockConfabulate(req: CompletionRequest): string {
  const vague = /apenas te acuerdas: "(.+)"$/m.exec(req.prompt)?.[1] ?? "algo";
  const base = vague.replace(/^\(vagamente\) /, "").replace(/…$/, "");
  return JSON.stringify({
    text: `${base}, ${INVENTED[hash(vague) % INVENTED.length]}`,
    valence: 0,
  });
}

function mockSummarize(req: CompletionRequest): string {
  const lines = numbered(req.prompt);
  return JSON.stringify({
    summary: `Durante un tiempo pasaron cosas parecidas: ${lines[0]?.slice(0, 50) ?? "rutinas"} (y ${lines.length - 1} más).`,
  });
}

function mockSocial(req: CompletionRequest): string {
  const match = /Acabas de hablar con ([^(]+) \((\S+)\)/.exec(req.prompt);
  const name = match?.[1]?.trim() ?? "esa persona";
  const negative = /liado|mal|triste/i.test(req.prompt);
  // Promesas y quedadas de la charla (memoria prospectiva).
  const talk = req.prompt.split("Conversación:")[1] ?? "";
  const first = name.split(" ")[0];
  const intentions = /Deberíamos venir juntos/.test(talk)
    ? [{ text: `volver a quedar con ${first}`, personId: match?.[2] ?? null }]
    : [];
  return JSON.stringify({
    summary: negative ? `${name} parece agobiado últimamente.` : `${name} es agradable de tratar.`,
    affinityDelta: negative ? -0.02 : 0.06,
    trustDelta: 0.02,
    intentions,
  });
}

registerMockHandler("importance", mockImportance);
registerMockHandler("consolidate", mockConsolidate);
registerMockHandler("gist", mockGist);
registerMockHandler("reconsolidate", mockReconsolidate);
registerMockHandler("confabulate", mockConfabulate);
registerMockHandler("summarize", mockSummarize);
registerMockHandler("social", mockSocial);
