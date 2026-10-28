import { z } from "zod";

/**
 * Manifest de assets: dice qué tilesets, sellos (stamps) y hojas de personaje usa cada pack.
 * Cambiar de pack (placeholder ↔ vendor) = cambiar `activePack` y regenerar el mapa
 * (`pnpm map:generate`), sin tocar código.
 */

export const TilesetDef = z.object({
  /** Nombre del tileset en el .tmj y clave de textura en Phaser. */
  name: z.string(),
  /** Ruta relativa a apps/web/public. */
  image: z.string(),
  tileWidth: z.number().int().positive(),
  tileHeight: z.number().int().positive(),
  imageWidth: z.number().int().positive(),
  imageHeight: z.number().int().positive(),
});
export type TilesetDef = z.infer<typeof TilesetDef>;

/**
 * Trozo rectangular de un tileset (en baldosas) que el generador del mapa coloca.
 * - `fixed`: se copia tal cual.
 * - `pattern`: se repite en mosaico para cubrir un área (suelos, césped).
 * - `nineslice`: esquinas, bordes y centro estirables (tejados, estanques).
 */
export const Stamp = z.object({
  tileset: z.string(),
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
  w: z.number().int().positive().default(1),
  h: z.number().int().positive().default(1),
  mode: z.enum(["fixed", "pattern", "nineslice"]).default("fixed"),
  /**
   * Baldosa del sello que cae sobre el punto de colocación (p. ej. el spot de una silla).
   * Puede quedar fuera del sello: (1, h) = el punto está justo debajo, delante del mueble.
   */
  anchor: z.tuple([z.number().int(), z.number().int()]).default([0, 0]),
  /** Solo nineslice: baldosa fija (relativa) para todo el centro, en vez de repetir el interior. */
  center: z.tuple([z.number().int(), z.number().int()]).optional(),
  /** Baldosas del sello (relativas) que bloquean el paso, p. ej. el tronco de un árbol. */
  blocks: z.array(z.tuple([z.number().int(), z.number().int()])).default([]),
});
export type Stamp = z.infer<typeof Stamp>;

export const AnimationDef = z.object({
  row: z.number().int().nonnegative(),
  start: z.number().int().nonnegative(),
  count: z.number().int().positive(),
  frameRate: z.number().positive().default(8),
});
export type AnimationDef = z.infer<typeof AnimationDef>;

/** Claves de animación: `${estado}_${dirección}`. */
export const ANIMATION_STATES = ["idle", "walk", "sit", "sleep", "read"] as const;
export type AnimationState = (typeof ANIMATION_STATES)[number];

export const CharacterSheet = z.object({
  image: z.string(),
  frameWidth: z.number().int().positive(),
  frameHeight: z.number().int().positive(),
  /** Columnas de la hoja (para pasar de fila/columna a índice de frame). */
  columns: z.number().int().positive(),
  /** Si true, el cliente recolorea la hoja con los colores de `appearance` (placeholder). */
  recolor: z.boolean().default(false),
  /** Colores marcador de la hoja que se sustituyen por los de `appearance`. */
  markers: z
    .object({ skin: z.string(), hair: z.string(), shirt: z.string(), pants: z.string() })
    .optional(),
  /**
   * Animaciones por clave (`walk_down`, `sit_left`...). Las que falten caen en otras:
   * sit_up/down → idle, sleep → primer frame de idle_down tumbado, read → idle.
   */
  animations: z.record(z.string(), AnimationDef),
});
export type CharacterSheet = z.infer<typeof CharacterSheet>;

export const AssetPack = z.object({
  description: z.string().default(""),
  /** Crédito que debe mostrarse (licencias). */
  credits: z.string().default(""),
  tilesets: z.array(TilesetDef).min(1),
  stamps: z.record(z.string(), Stamp),
  characters: z.record(z.string(), CharacterSheet),
  /** Personaje por defecto de cada agente (si su appearance.sheet no existe en el pack). */
  agentCharacters: z.record(z.string(), z.string()).default({}),
});
export type AssetPack = z.infer<typeof AssetPack>;

export const AssetManifest = z.object({
  activePack: z.string(),
  packs: z.record(z.string(), AssetPack),
});
export type AssetManifest = z.infer<typeof AssetManifest>;

export function activePack(
  manifest: AssetManifest,
  override?: string,
): { name: string; pack: AssetPack } {
  const name = override ?? manifest.activePack;
  const pack = manifest.packs[name];
  if (!pack) throw new Error(`El pack de assets "${name}" no existe en el manifest`);
  for (const [key, stamp] of Object.entries(pack.stamps)) {
    if (!pack.tilesets.some((t) => t.name === stamp.tileset)) {
      throw new Error(`Stamp "${key}" usa un tileset desconocido: ${stamp.tileset}`);
    }
  }
  return { name, pack };
}

/** Pack con el que se generó un .tmj (propiedad `assetPack`), si la tiene. */
export function mapAssetPack(tmj: unknown): string | undefined {
  const props = (tmj as { properties?: { name: string; value: unknown }[] } | null)?.properties;
  const v = props?.find((p) => p.name === "assetPack")?.value;
  return typeof v === "string" ? v : undefined;
}

/** Elige la hoja de personaje de un agente dentro de un pack. */
export function characterFor(pack: AssetPack, agentId: string, sheet?: string): string {
  if (sheet && pack.characters[sheet]) return sheet;
  const assigned = pack.agentCharacters[agentId];
  if (assigned && pack.characters[assigned]) return assigned;
  const first = Object.keys(pack.characters)[0];
  if (!first) throw new Error("El pack no tiene personajes");
  return first;
}

/** Sellos que el generador del mapa necesita en todos los packs. */
export const REQUIRED_STAMPS = [
  "grass",
  "path",
  "water",
  "tree",
  "bush",
  "lamp",
  "bench",
  "fountain",
  "roof",
  "facade",
  "ceiling",
  "wall_blue",
  "wall_red",
  "wall_wood",
  "wall_grey",
  "floor_home",
  "floor_cafe",
  "floor_shop",
  "bed",
  "desk",
  "chair",
  "stool",
  "table",
  "counter",
  "stove",
  "fridge_shelf",
  "bookshelf",
  "rug",
  "plant",
  "sofa",
  "coffee_machine",
  "collision",
] as const;
