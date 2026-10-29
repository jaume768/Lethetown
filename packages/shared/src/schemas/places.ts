/** Lugares que conoce cada agente (no todos conocen todo el pueblo). */
import { z } from "zod";

/** Cómo lo conoció: de siempre (semilla), al verlo, explorando o porque se lo contaron. */
export const KnownPlaceSource = z.enum(["seed", "seen", "explored", "told"]);
export type KnownPlaceSource = z.infer<typeof KnownPlaceSource>;

export const KnownPlaceInfo = z.object({
  source: KnownPlaceSource,
  /** Minuto de juego en que lo conoció (0 = de siempre). */
  at: z.number(),
  /** Quién se lo contó (si source = told). */
  toldBy: z.string().nullable().default(null),
});
export type KnownPlaceInfo = z.infer<typeof KnownPlaceInfo>;

export const KnownPlace = KnownPlaceInfo.extend({ placeId: z.string() });
export type KnownPlace = z.infer<typeof KnownPlace>;

export const KnownPlacesResponse = z.object({
  agentId: z.string(),
  items: z.array(KnownPlace),
});
export type KnownPlacesResponse = z.infer<typeof KnownPlacesResponse>;
