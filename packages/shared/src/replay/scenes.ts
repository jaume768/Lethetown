import { z } from "zod";

/**
 * Escenas guardadas (`docs/videos/escenas.json`): planos de los guiones de vídeo para abrir la
 * repetición en modo cine en el minuto justo, con el vecino, el formato y la velocidad
 * (`/replay?scene=<id>`). Solo datos: el minuto de una frase sale de los eventos de la partida.
 */

/** Nombre de un paquete de `/replays/` (sin `.replay.json.gz`). */
const BundleName = z.string().regex(/^[\w.-]+$/);

/** Un plano: de un minuto de juego a otro (al llegar al final, pasa al siguiente o se para). */
export const SceneShot = z
  .object({
    from: z.number().nonnegative(),
    to: z.number().nonnegative(),
    /** Qué se ve u oye (para quien graba; no sale en el vídeo). */
    note: z.string().optional(),
  })
  .refine((s) => s.to > s.from, { message: "el plano acaba antes de empezar" });
export type SceneShot = z.infer<typeof SceneShot>;

export const ReplayScene = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  title: z.string().min(1),
  /** Paquete (`s7` → `/replays/s7.replay.json.gz`). */
  src: BundleName,
  /** Pantalla partida: el segundo paquete (`s13`). */
  src2: BundleName.optional(),
  /** A quién sigue la cámara (null o sin él: automática). */
  agent: z.string().nullable().default(null),
  format: z.enum(["9:16", "4:5", "16:9"]).default("9:16"),
  /** Minutos de juego por minuto real (las del reproductor). */
  speed: z
    .union([z.literal(1), z.literal(5), z.literal(10), z.literal(60), z.literal(360)])
    .default(10),
  shots: z.array(SceneShot).min(1),
  /** Tarjeta que se abre al empezar: «así muere un recuerdo» de este recuerdo. */
  memory: z.string().optional(),
  /** La frase que se busca (literal, para comprobar el minuto contra los eventos). */
  quote: z.string().optional(),
});
export type ReplayScene = z.infer<typeof ReplayScene>;

export const ReplayScenes = z
  .object({ version: z.literal(1), scenes: z.array(ReplayScene) })
  .refine((f) => new Set(f.scenes.map((s) => s.id)).size === f.scenes.length, {
    message: "id de escena repetido",
  });
export type ReplayScenes = z.infer<typeof ReplayScenes>;

/** La URL de la repetición de una escena (`/replays/<src>.replay.json.gz`). */
export function sceneBundlePath(name: string): string {
  return `/replays/${name}.replay.json.gz`;
}

/** El plano en el que cae `t` (o el siguiente), o -1 si ya pasaron todos. */
export function shotAt(shots: readonly SceneShot[], t: number): number {
  return shots.findIndex((s) => t < s.to);
}
