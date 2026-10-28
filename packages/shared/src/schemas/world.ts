import { z } from "zod";

/** Tiempo de juego en minutos desde el inicio de la simulación (día 0, 00:00). */
export const GameMinutes = z.number().nonnegative();
export type GameMinutes = z.infer<typeof GameMinutes>;

export const MINUTES_PER_DAY = 24 * 60;

/** Coordenada en baldosas. */
export const TilePoint = z.object({ x: z.number().int(), y: z.number().int() });
export type TilePoint = z.infer<typeof TilePoint>;

/** Rectángulo en baldosas. */
export const TileRect = z.object({
  x: z.number().int(),
  y: z.number().int(),
  w: z.number().int().positive(),
  h: z.number().int().positive(),
});
export type TileRect = z.infer<typeof TileRect>;

export const Pose = z.enum(["sit", "sleep", "stand", "use"]);
export type Pose = z.infer<typeof Pose>;

/** Objeto del mundo con posición: un "spot" al que puede ir un agente. */
export const Spot = z.object({
  id: z.string(),
  name: z.string(),
  placeId: z.string(),
  pose: Pose,
  tile: TilePoint,
  /** Estado mutable ("idle", "rota"...), modificable por el jugador. */
  state: z.string().default("idle"),
  /** Dueño, p. ej. de una cama. */
  owner: z.string().nullable().default(null),
});
export type Spot = z.infer<typeof Spot>;

export const PlaceKind = z.enum(["home", "cafe", "park", "shop", "other"]);
export type PlaceKind = z.infer<typeof PlaceKind>;

export const Place = z.object({
  id: z.string(),
  name: z.string(),
  kind: PlaceKind,
  area: TileRect,
  indoor: z.boolean(),
  /** Baldosa transitable de referencia (a donde se va si no hay spot). */
  anchor: TilePoint,
  objects: z.array(Spot),
});
export type Place = z.infer<typeof Place>;

/** Mundo como árbol: pueblo → lugares → objetos, más la rejilla de colisión. */
export const World = z.object({
  name: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  tileSize: z.number().int().positive(),
  places: z.array(Place).min(1),
  /** 1 = bloqueado, fila a fila (índice = y * width + x). */
  collision: z.array(z.number().int().min(0).max(1)),
  /** 1 = camino (capa `paths`): los agentes lo prefieren al andar. */
  paths: z.array(z.number().int().min(0).max(1)).default([]),
  /** Farolas (para la iluminación nocturna). */
  lights: z.array(TilePoint),
  /** Ventanas (se iluminan de noche). */
  windows: z.array(TilePoint),
});
export type World = z.infer<typeof World>;

export const Weather = z.enum(["sunny", "cloudy", "rain"]);
export type Weather = z.infer<typeof Weather>;

export const SimSpeed = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(10),
  z.literal(60),
  z.literal(360),
]);
export type SimSpeed = z.infer<typeof SimSpeed>;
export const SIM_SPEEDS: readonly SimSpeed[] = [0, 1, 10, 60, 360];
