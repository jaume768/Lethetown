import { ActivityKind } from "@lethetown/shared";
import { z } from "zod";

/** Extrae el primer objeto JSON del texto (tolera ```json ... ``` y texto alrededor). */
export function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("La respuesta no contiene JSON");
  return JSON.parse(text.slice(start, end + 1));
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

export const DecideResponse = z.object({
  choice: z.enum(["continue", "react", "talk"]),
  action: z.string().optional(),
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
