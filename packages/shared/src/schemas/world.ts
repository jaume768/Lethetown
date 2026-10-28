import { z } from "zod";

/** Tiempo de juego en minutos desde el inicio de la simulación (día 0, 00:00). */
export const GameMinutes = z.number().nonnegative();
export type GameMinutes = z.infer<typeof GameMinutes>;

export const MINUTES_PER_DAY = 24 * 60;

export const Rect = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number().positive(),
  h: z.number().positive(),
});
export type Rect = z.infer<typeof Rect>;

export const WorldObject = z.object({
  id: z.string(),
  name: z.string(),
  state: z.string().default("idle"),
});
export type WorldObject = z.infer<typeof WorldObject>;

export const Place = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(["home", "cafe", "park", "shop", "other"]),
  rect: Rect,
  color: z.string(),
  objects: z.array(WorldObject).default([]),
});
export type Place = z.infer<typeof Place>;

/** Mundo como árbol: pueblo → lugares → objetos. */
export const World = z.object({
  name: z.string(),
  places: z.array(Place).min(1),
});
export type World = z.infer<typeof World>;

export const SimSpeed = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(10),
  z.literal(60),
  z.literal(360),
]);
export type SimSpeed = z.infer<typeof SimSpeed>;
export const SIM_SPEEDS: readonly SimSpeed[] = [0, 1, 10, 60, 360];
