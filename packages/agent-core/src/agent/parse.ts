import { ActivityKind } from "@lethetown/shared";
import { z } from "zod";

/**
 * Extrae el primer objeto JSON del texto (tolera ```json ... ``` y texto alrededor, también con
 * llaves después: en la partida de estudio un plan con una nota detrás dejó a un agente sin
 * plan). Busca el primer objeto con las llaves equilibradas (fuera de las cadenas) que se pueda
 * leer; si no lo hay, prueba del primer "{" al último "}".
 */
export function extractJson(text: string): unknown {
  for (let start = text.indexOf("{"); start !== -1; start = text.indexOf("{", start + 1)) {
    const end = balancedEnd(text, start);
    if (end === -1) break;
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      // No era JSON (p. ej. "{" dentro de una frase): el siguiente.
    }
  }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("La respuesta no contiene JSON");
  return JSON.parse(text.slice(start, end + 1));
}

/** Índice de la "}" que cierra la "{" de `start` (sin contar las de dentro de cadenas), o -1. */
function balancedEnd(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return i;
  }
  return -1;
}

export function parseWith<T>(schema: z.ZodType<T>, text: string): T {
  return schema.parse(extractJson(text));
}

/** activityKind desconocido → undefined (se deduce del texto). */
const LooseActivityKind = z
  .string()
  .optional()
  .transform((v) => (ActivityKind.safeParse(v).success ? (v as ActivityKind) : undefined));

const NullableId = z
  .string()
  .nullish()
  .transform((v) => (v && v !== "null" ? v : null));

export const PlanResponse = z.object({
  plan: z
    .array(
      z.object({
        start: z.string(),
        durationMin: z.coerce.number().int().positive(),
        activity: z.string().min(1),
        activityKind: LooseActivityKind,
        placeId: z.string(),
        spotId: NullableId,
      }),
    )
    .min(1),
});

export const ImportanceResponse = z.object({
  ratings: z.array(
    z.object({
      importance: z.coerce.number(),
      valence: z.coerce.number().default(0),
    }),
  ),
});

/**
 * Respuesta de `decide`: `{"choice":"continue"|"act","action":{"type":…},"reason":…}`. También se
 * acepta el formato anterior (`react` con action/placeId… y `talk` con to/say), que se traduce a
 * `do_activity` y `say` (`decideAction`).
 */
export const DecideResponse = z.object({
  choice: z.enum(["continue", "act", "react", "talk"]),
  /** La acción (objeto con `type`); en el formato antiguo de "react", el texto de la actividad. */
  action: z.unknown().optional(),
  activityKind: LooseActivityKind,
  placeId: z.string().optional(),
  spotId: NullableId,
  to: z.string().optional(),
  say: z.string().optional(),
  /** Por qué lo decide (una frase, en primera persona): se muestra en el inspector. */
  reason: z.string().optional(),
  /** Algo que se propone hacer más adelante (memoria prospectiva), si surge. */
  intention: z
    .object({
      text: z.string(),
      personId: z.string().nullish(),
      placeId: z.string().nullish(),
      at: z.string().nullish(),
    })
    .nullish()
    .catch(null),
});
export type DecideResponse = z.infer<typeof DecideResponse>;

/** La acción que pide la respuesta (sin validar), traduciendo el formato antiguo. */
export function decideAction(r: DecideResponse): unknown {
  if (r.choice === "react") {
    return {
      type: "do_activity",
      activity: r.action,
      activityKind: r.activityKind,
      placeId: r.placeId,
      spotId: r.spotId,
    };
  }
  if (r.choice === "talk") return { type: "say", to: r.to, text: r.say };
  return r.action;
}
