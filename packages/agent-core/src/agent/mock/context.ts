/**
 * Lectura del prompt para el mock, igual que lo haría un LLM: lugares, diario, tiempo, presentes…
 * `decideContext` lo calcula una vez por petición y lo comparten todas las reglas de decisión.
 */
import { WEATHER_SHELTER, type Weather } from "@lethetown/shared";
import type { CompletionRequest } from "../../llm/types";
import { WEATHER_LABEL } from "../prompts";
import { FOLLOW_UPS, GREETINGS, REPLIES } from "./phrases";

export function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export interface MockPlace {
  id: string;
  kind: string;
  name: string;
  outdoor: boolean;
  objects: { id: string; pose: string; shelter: boolean }[];
  /** Horario ("HH:MM" de apertura y cierre), si tiene. */
  hours?: { opens: string; closes: string };
}

/** ¿Está abierto a esa hora ("HH:MM")? */
export function openAt(p: MockPlace, at: string): boolean {
  return !p.hours || (at >= p.hours.opens.padStart(5, "0") && at < p.hours.closes.padStart(5, "0"));
}

/** Entradas "- HH:MM actividad (lugar)" de un diario del prompt que empieza con `header`. */
export function diary(prompt: string, header: string): { activity: string; placeId: string }[] {
  const block = prompt.split(header)[1] ?? "";
  const out: { activity: string; placeId: string }[] = [];
  for (const line of block.split("\n").slice(1)) {
    const m = /^- \d{2}:\d{2} (.+) \((\S+)\)$/.exec(line);
    if (!m) break;
    out.push({ activity: m[1]!, placeId: m[2]! });
  }
  return out;
}

/** El tiempo del prompt ("Tiempo: lluvia; estás..." o "Tiempo esta mañana: lluvia."). */
export function weatherIn(text: string): Weather | null {
  const label = /Tiempo(?: esta mañana)?: ([^;.\n]+)/.exec(text)?.[1]?.trim();
  const found = (Object.entries(WEATHER_LABEL) as [Weather, string][]).find(([, l]) => l === label);
  return found?.[0] ?? null;
}

/** Qué hace quien se ve afectado por el tiempo: dónde se refugia y cómo lo cuenta. */

export function parsePlaces(system: string): MockPlace[] {
  const line =
    /^- (\S+) \((\w+)(, exterior)?(?:, abre (\d\d:\d\d)-(\d\d:\d\d))?\): (.+?)(?: · objetos: (.+))?$/gm;
  return [...system.matchAll(line)].map((m) => ({
    id: m[1]!,
    kind: m[2]!,
    outdoor: Boolean(m[3]),
    ...(m[4] ? { hours: { opens: m[4], closes: m[5]! } } : {}),
    name: m[6]!,
    objects: [...(m[7] ?? "").matchAll(/(\w+)\[(\w+)(,refugio)?\]/g)].map((o) => ({
      id: o[1]!,
      pose: o[2]!,
      shelter: Boolean(o[3]),
    })),
  }));
}

export interface Outing {
  activity: string;
  kind: string;
  pose: string;
}

export const OUTING: Record<string, Outing> = {
  cafe: { activity: "tomar un café", kind: "eat", pose: "sit" },
  park: { activity: "pasear y sentarse en el banco", kind: "sit", pose: "sit" },
  shop: { activity: "hacer la compra", kind: "work", pose: "use" },
  home: { activity: "descansar en casa", kind: "idle", pose: "sit" },
  other: { activity: "dar una vuelta", kind: "idle", pose: "stand" },
};

/** Actividades propias de algunos lugares (por id); el resto sale de su tipo. */
export const OUTING_BY_ID: Record<string, Outing> = {
  taberna: { activity: "tomar algo en la taberna", kind: "eat", pose: "sit" },
  plaza: { activity: "charlar en la plaza", kind: "sit", pose: "sit" },
  mercado: { activity: "mirar los puestos del mercadillo", kind: "idle", pose: "use" },
  lago: { activity: "pasear junto al lago", kind: "idle", pose: "stand" },
  jardin_recuerdo: { activity: "pasear entre las flores del jardín", kind: "sit", pose: "sit" },
  huerto: { activity: "echar una mano en el huerto", kind: "work", pose: "use" },
  biblioteca: { activity: "leer en la biblioteca", kind: "read", pose: "sit" },
  panaderia: { activity: "comprar pan", kind: "idle", pose: "use" },
  consultorio: { activity: "ir al médico", kind: "sit", pose: "sit" },
  ayuntamiento: { activity: "hacer un trámite en el ayuntamiento", kind: "sit", pose: "sit" },
};

/** Lo que se hace en el lugar de trabajo (por id); si no está, "trabajar". */
export const WORK_BY_ID: Record<string, Outing> = {
  cafe_ola: { activity: "atender el café", kind: "work", pose: "use" },
  taberna: { activity: "atender la taberna", kind: "work", pose: "use" },
  panaderia: { activity: "hornear y vender pan", kind: "work", pose: "use" },
  tienda: { activity: "atender el ultramarinos", kind: "work", pose: "use" },
  mercado: { activity: "atender el puesto del mercadillo", kind: "work", pose: "use" },
  biblioteca: { activity: "ordenar libros en la biblioteca", kind: "work", pose: "sit" },
  escuela: { activity: "dar clase", kind: "work", pose: "sit" },
  ayuntamiento: { activity: "despachar en el ayuntamiento", kind: "work", pose: "sit" },
  consultorio: { activity: "pasar consulta", kind: "work", pose: "sit" },
  huerto: { activity: "cuidar el huerto", kind: "work", pose: "use" },
  lago: { activity: "pescar en el lago", kind: "work", pose: "use" },
  plaza: { activity: "tocar la guitarra en la plaza", kind: "idle", pose: "stand" },
};

/** Sitios donde no se va "de paseo": solo quien trabaja o estudia allí (o los menciona). */
export const NOT_FOR_OUTINGS = new Set(["escuela", "ayuntamiento", "consultorio"]);

export const outingFor = (p: MockPlace): Outing =>
  OUTING_BY_ID[p.id] ?? OUTING[p.kind] ?? OUTING.other!;

/** Recuerdos numerados ("1. texto") de un prompt. */
export function numbered(prompt: string): string[] {
  return [...prompt.matchAll(/^\d+\. (.+)$/gm)].map((m) => m[1]!);
}

/** Todo lo que el mock lee de un prompt de `decide` (se calcula una vez por petición). */
export interface DecideCtx {
  req: CompletionRequest;
  /** El prompt. */
  p: string;
  /** Hash del prompt: el "azar" determinista del mock. */
  h: number;
  places: MockPlace[];
  here: string;
  herePlace: MockPlace | undefined;
  weather: Weather | null;
  /** Qué refugio pide el tiempo (si alguno). */
  need: "roof" | "cover" | "shade" | null;
  exposed: boolean;
  /** Aviso de la simulación: lo siguiente que tenía previsto es al aire libre. */
  planOutside: boolean;
  raining: boolean;
  presentLine: string;
  present: string[];
  /** Lo que se oye; `to` si en un grupo se lo dicen a otra persona. */
  heard: { from: string; text: string; to?: string }[];
  /** Quien le habla a él o ella (lo primero que le dicen directamente). */
  speaker: { from: string; text: string } | undefined;
  broken: RegExpMatchArray | null | undefined;
  thought: string | undefined;
  /** Rumor que contar: algo oído a escondidas que no sea ya un rumor ni un saludo. */
  rumor: RegExpMatchArray | undefined;
  /** Confidencias posibles: lo que recuerda de otras personas. */
  memories: string[];
  /** Lo que toca ahora según el plan. */
  plan: string | undefined;
  /** Voz interior recién recibida. */
  voice: string | undefined;
  /** Intención que deja la voz interior ("tengo que…"), que va en cualquier respuesta. */
  intention: Record<string, unknown>;
  visited(placeId: string): boolean;
  did(activity: string): boolean;
  personality: string;
  /** La frase con una muletilla suya delante, a veces. */
  styled(say: string): string;
  social: number;
  /** Alguien presente (elegido con el hash). */
  someone: string | undefined;
  weatherLabel: string;
  /** Acciones del catálogo que se le ofrecen (líneas "- tipo {…}" del prompt). */
  available: Set<string>;
}

export function decideContext(req: CompletionRequest): DecideCtx {
  const h = hash(req.prompt);
  const p = req.prompt;
  const places = parsePlaces(`${req.system}\n${req.prompt}`);
  const here = /^Es .+?\. Estás en (\S+) haciendo/m.exec(p)?.[1] ?? "";
  const weather = weatherIn(p);
  const need = weather ? WEATHER_SHELTER[weather] : null;
  const presentLine = /^PRESENTES: (.+)$/m.exec(p)?.[1] ?? "nadie";
  const present =
    presentLine === "nadie" ? [] : presentLine.split("; ").map((x) => x.slice(0, x.indexOf("=")));
  const heard = [...p.matchAll(/^(\S+)=[^:\n(]+?(?: \(a ([^)]+)\))?: "(.+)"$/gm)].map((m) => ({
    from: m[1]!,
    text: m[3]!,
    ...(m[2] ? { to: m[2] } : {}),
  }));
  const small = [...GREETINGS, ...REPLIES, ...FOLLOW_UPS];
  const rumor = [...p.matchAll(/^- Oí a (.+?) decirle a .+? algo como: "(.+)"$/gm)].find((m) => {
    const fragment = m[2]!.replace(/…/g, "").trim();
    return (
      !/Oí a|Sabes|cuento una cosa/.test(fragment) &&
      !small.some((s) => s.includes(fragment)) &&
      !p.includes(`decir "${m[2]}"`)
    );
  });
  const memories = (p.split("Memoria de trabajo:")[1] ?? "")
    .split("\n")
    .map((l) => /^- (.+)$/.exec(l)?.[1])
    .filter((l): l is string => Boolean(l))
    .filter((l) => !/^(Le dije|Pensé|Oí a|Noté|Vi a|\()/.test(l) && !/me dijo|⟦/.test(l))
    // Ni los avisos del tiempo ("Empezó a llover", "...es al aire libre").
    .filter((l) => !/al aire libre|^(Empezó|Salió|Se nubló|Estalló|Bajó|Se levantó)/.test(l))
    .filter((l) => /\s[A-ZÁÉÍÓÚ][a-záéíóúñ]{2,}/.test(l) && !p.includes(`cosa? ${l}`));
  const voiceIntent =
    /^VOZ INTERIOR[^\n]*\n- ⟦.*?\b(?:tengo que|debería|quiero acordarme de) (.+?)[.!]?⟧$/im.exec(
      p,
    )?.[1];
  const done = diary(p, "HOY YA HAS HECHO:");
  const personality = /^Personalidad: (.+)\.$/m.exec(req.system)?.[1] ?? "";
  const catchphrases = [
    ...(/muletillas: (.+?)\.$/m.exec(req.system)?.[1] ?? "").matchAll(/«([^»]+)»/g),
  ].map((m) => m[1]!);
  return {
    req,
    p,
    h,
    places,
    here,
    herePlace: places.find((x) => x.id === here),
    weather,
    need,
    exposed: Boolean(need) && !/Tiempo: [^\n]*; estás (bajo techo|a cubierto)/.test(p),
    planOutside: Boolean(need) && /es al aire libre, en /.test(p),
    raining: weather === "rain" || weather === "storm",
    presentLine,
    present,
    heard,
    speaker: heard.find((x) => !x.to),
    broken: /^OBJETOS: (.+)$/m.exec(p)?.[1]?.match(/(\w+): (rot[oa]|estropead[oa]|averiad[oa])/),
    thought: /^- Pensé: (.+)$/m.exec(p)?.[1],
    rumor,
    memories,
    plan: /^Tu plan ahora: (.+) en \S+ \(desde/m.exec(p)?.[1],
    voice: /^VOZ INTERIOR[^\n]*\n- ⟦(.+)⟧$/m.exec(p)?.[1],
    intention: voiceIntent ? { intention: { text: voiceIntent } } : {},
    visited: (id) => done.some((d) => d.placeId === id),
    did: (activity) => done.some((d) => d.activity.startsWith(activity)),
    personality,
    styled: (say) => {
      const c = catchphrases[h % Math.max(1, catchphrases.length)];
      if (!c || h % 3 !== 0) return say;
      const lead = `${c.charAt(0).toUpperCase()}${c.slice(1)}`;
      // "¡Hombre! Hola…" o "Hija mía, hola…".
      return /[…!?]$/.test(c)
        ? `${lead} ${say}`
        : `${lead}, ${say.charAt(0).toLowerCase()}${say.slice(1)}`;
    },
    social: Number(/social (\d\.\d+)\./.exec(p)?.[1] ?? 0.5),
    someone: present[h % Math.max(1, present.length)],
    weatherLabel: weather ? WEATHER_LABEL[weather] : "",
    available: new Set([...p.matchAll(/^- ([a-z_]+) \{/gm)].map((m) => m[1]!)),
  };
}

/** Líneas "- …" de una sección del prompt ("LLEVAS:", "AGENDA:"…), sin el guion. */
export function sectionLines(prompt: string, title: string): string[] {
  const block = prompt.split(`\n${title}:\n`)[1] ?? "";
  const out: string[] = [];
  for (const line of block.split("\n")) {
    if (!line.startsWith("- ")) break;
    out.push(line.slice(2));
  }
  return out;
}
