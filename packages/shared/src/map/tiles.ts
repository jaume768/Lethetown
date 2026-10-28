/**
 * Paleta semántica de baldosas. El orden define el índice en el tileset placeholder
 * (índice local = posición en esta lista). Otros packs (vendor) traducen cada nombre a su
 * propio índice en el manifest de assets, así el mapa no depende de ningún tileset concreto.
 */
export const TILE_NAMES = [
  "grass",
  "grass_flowers",
  "path",
  "water",
  "wood_floor",
  "tile_floor",
  "wall",
  "wall_window",
  "door",
  "roof",
  "roof_edge",
  "bed",
  "desk",
  "chair",
  "table",
  "counter",
  "stove",
  "shelf",
  "coffee_machine",
  "bench",
  "fountain",
  "tree",
  "bush",
  "flowers",
  "lamp",
  "rug",
  "collision",
] as const;

export type TileName = (typeof TILE_NAMES)[number];

/** Columnas del tileset placeholder. */
export const PLACEHOLDER_TILESET_COLUMNS = 8;

export const TILE_INDEX: Readonly<Record<TileName, number>> = Object.fromEntries(
  TILE_NAMES.map((name, i) => [name, i]),
) as Record<TileName, number>;
