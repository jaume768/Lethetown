/**
 * Biblia del mundo (config/world.json): dónde y cuándo vive el pueblo, qué tecnología hay, qué
 * se sabe de fuera, la cultura local, el glosario, el calendario y el clima. Lógica pura: el
 * calendario se calcula con minutos de juego (sin `Date`). Ver docs/decisiones/mundo.md.
 */
import { Weather } from "@lethetown/shared";
import { z } from "zod";
import type { Rng } from "../util/random";

/** "MM-DD". */
const MonthDay = z.string().regex(/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/);

export const Season = z.enum(["winter", "spring", "summer", "autumn"]);
export type Season = z.infer<typeof Season>;

/** Peso de cada tiempo al cambiar (los que faltan, 0). */
const WeatherWeights = z.partialRecord(Weather, z.number().nonnegative());

export const GlossaryEntry = z.object({
  term: z.string().min(1),
  /** place = lugar; institution; person (nombre propio de fuera de los vecinos); outside; culture. */
  kind: z.enum(["place", "institution", "person", "outside", "culture", "media"]),
  note: z.string().default(""),
});
export type GlossaryEntry = z.infer<typeof GlossaryEntry>;

/** Palabra o expresión posterior a la época (minúsculas; `*` final = cualquier terminación). */
export const AnachronismTerm = z.object({
  term: z.string().min(2),
  /** Qué es, para el registro ("teléfono móvil como algo corriente"). */
  label: z.string(),
});
export type AnachronismTerm = z.infer<typeof AnachronismTerm>;

export const WorldBible = z.object({
  town: z.string().default("Lethetown"),
  /** "un pueblo pequeño (inventado) del interior de Mallorca". */
  where: z.string(),
  year: z.number().int().min(1900).max(2100).default(1996),
  /** Fecha del día 0 de la partida (mes y día; el año es `year`). */
  startDate: MonthDay.default("04-15"),
  city: z.object({ name: z.string(), distance: z.string() }),
  currency: z.string(),
  /** Líneas compactas para el prompt fijo, por temas (tecnología, fuera, cultura). */
  everyday: z.array(z.string()).default([]),
  outside: z.array(z.string()).default([]),
  culture: z.array(z.string()).default([]),
  /** Regla de lo que sabe cada uno (va al prompt fijo). */
  knowledgeRule: z.string(),
  glossary: z.array(GlossaryEntry).default([]),
  /**
   * Referencias de fuera que cualquiera podría conocer en esa época (deportes, música, gente de la
   * tele, sucesos): el registro de referencias externas no las cuenta como incoherentes.
   */
  commonReferences: z.array(z.string()).default([]),
  anachronisms: z.array(AnachronismTerm).default([]),
  /**
   * Registro de conocimiento externo (ExternalKnowledgeGuard). log: solo registra (por defecto);
   * soften: registra y lo marca para suavizarlo (aún sin reescritura); enforce: además descarta
   * los textos con anacronismos (las referencias externas solo se registran).
   */
  knowledgeGuard: z
    .object({ mode: z.enum(["log", "soften", "enforce"]).default("log") })
    .prefault({}),
  /** Fiestas y días señalados ("MM-DD" → qué se celebra). */
  holidays: z.array(z.object({ date: MonthDay, name: z.string() })).default([]),
  climate: z
    .object({
      /** Probabilidad de que el tiempo siga igual en cada cambio. */
      persistence: z.number().min(0).max(1).default(0.35),
      seasons: z.partialRecord(Season, WeatherWeights),
    })
    .optional(),
});
export type WorldBible = z.infer<typeof WorldBible>;

const MONTHS = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];
const WEEKDAYS = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];
const SEASON_LABEL: Record<Season, string> = {
  winter: "invierno",
  spring: "primavera",
  summer: "verano",
  autumn: "otoño",
};

const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const daysIn = (y: number, m: number) =>
  [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]!;

/** Días desde el 1-1-1900 (lunes): para el día de la semana sin `Date`. */
function dayNumber(y: number, m: number, d: number): number {
  let n = 0;
  for (let yy = 1900; yy < y; yy++) n += isLeap(yy) ? 366 : 365;
  for (let mm = 1; mm < m; mm++) n += daysIn(y, mm);
  return n + d - 1;
}

export interface GameDate {
  year: number;
  /** 1..12 */
  month: number;
  day: number;
  /** 0 = lunes … 6 = domingo. */
  weekday: number;
  season: Season;
  /** "MM-DD" */
  monthDay: string;
}

export function seasonOf(month: number): Season {
  if (month === 12 || month <= 2) return "winter";
  if (month <= 5) return "spring";
  if (month <= 8) return "summer";
  return "autumn";
}

/** Fecha del calendario a partir de los minutos de juego (el día 0 es `startDate` de `year`). */
export function gameDate(bible: Pick<WorldBible, "year" | "startDate">, minutes: number): GameDate {
  let [m, d] = bible.startDate.split("-").map(Number) as [number, number];
  let y = bible.year;
  let left = Math.floor(minutes / 1440);
  while (left > 0) {
    const rest = daysIn(y, m) - d;
    if (left <= rest) {
      d += left;
      left = 0;
    } else {
      left -= rest + 1;
      d = 1;
      m++;
      if (m > 12) {
        m = 1;
        y++;
      }
    }
  }
  const weekday = dayNumber(y, m, d) % 7;
  const monthDay = `${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return { year: y, month: m, day: d, weekday, season: seasonOf(m), monthDay };
}

/** "martes, 16 de abril de 1996". */
export function formatGameDate(date: GameDate): string {
  return `${WEEKDAYS[date.weekday]}, ${date.day} de ${MONTHS[date.month - 1]} de ${date.year}`;
}

/** Línea del plan: la fecha, la estación y la fiesta del día si la hay. */
export function todayLine(bible: WorldBible, minutes: number): string {
  const date = gameDate(bible, minutes);
  const holiday = bible.holidays.find((h) => h.date === date.monthDay);
  return `Hoy es ${formatGameDate(date)} (${SEASON_LABEL[date.season]})${holiday ? `: ${holiday.name}` : ""}.`;
}

/**
 * Siguiente tiempo según el clima de la estación: con `persistence` sigue igual; si no, se sortea
 * con los pesos de la estación. Sin clima en la biblia, null (quien llama usa lo suyo).
 */
export function nextWeather(
  bible: WorldBible,
  minutes: number,
  current: Weather,
  rng: Rng,
): Weather | null {
  const climate = bible.climate;
  if (!climate) return null;
  const weights = climate.seasons[gameDate(bible, minutes).season];
  if (!weights) return null;
  if (rng() < climate.persistence) return current;
  const entries = Weather.options.map((w) => [w, weights[w] ?? 0] as const);
  const total = entries.reduce((s, [, x]) => s + x, 0);
  if (total <= 0) return current;
  let r = rng() * total;
  for (const [w, x] of entries) {
    r -= x;
    if (r < 0) return w;
  }
  return current;
}

/**
 * Lo fijo y compacto que entra en el prompt de identidad (igual para todos: cacheable). El
 * glosario no entra entero: los lugares del pueblo ya están en el prompt; solo lo de fuera.
 */
export function bibleLines(bible: WorldBible): string[] {
  const outsideNames = bible.glossary
    .filter((g) => g.kind !== "place")
    .map((g) => (g.note ? `${g.term} (${g.note})` : g.term));
  return [
    `El mundo: ${bible.town} es ${bible.where}; es el año ${bible.year}. ${bible.city.name}, la ciudad, está ${bible.city.distance}. El dinero, en ${bible.currency}.`,
    ...bible.everyday.map((l) => `Vida en ${bible.year}: ${l}`),
    ...bible.outside.map((l) => `Fuera del pueblo: ${l}`),
    ...bible.culture.map((l) => `Cultura: ${l}`),
    ...(outsideNames.length ? [`Nombres de aquí y del entorno: ${outsideNames.join("; ")}.`] : []),
    bible.knowledgeRule,
  ];
}
