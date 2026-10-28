import { z } from "zod";

/**
 * Manifest de assets: dice qué tilesets, sellos (stamps) y hojas de personaje usa cada pack.
 * Cambiar de pack (placeholder ↔ vendor) = cambiar `activePack` y regenerar el mapa
 * (`pnpm map:generate`), sin tocar código.
 */

/**
 * Licencia de un asset. `non-commercial` = no se puede usar en un producto comercial
 * (p. ej. Modern Interiors Free); `pnpm assets:check` lista los que están en uso.
 */
export const License = z.enum(["commercial", "non-commercial"]);
export type License = z.infer<typeof License>;

/** Campos de licencia comunes a todo asset del manifest. */
const licensed = {
  license: License.default("commercial"),
  /** Id de la entrada de `credits` del manifest a la que pertenece (para la pantalla de créditos). */
  source: z.string().optional(),
};

export const TilesetDef = z.object({
  ...licensed,
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
  ...licensed,
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

/** Trozo de una hoja de UI usado como marco nine-slice (CSS `border-image`). */
export const UiPiece = z.object({
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
  w: z.number().int().positive(),
  h: z.number().int().positive(),
  /** Píxeles de borde que no se estiran (border-image-slice). */
  slice: z.number().int().nonnegative(),
});
export type UiPiece = z.infer<typeof UiPiece>;

/** Piezas de UI que el cliente sabe usar (las que falten se quedan con el estilo CSS propio). */
export const UI_PIECES = ["panel", "card", "button", "buttonActive", "dialog"] as const;

/** Piel de la interfaz: una hoja (p. ej. Modern User Interface) y sus piezas. */
export const UiSkin = z.object({
  ...licensed,
  image: z.string(),
  pieces: z.record(z.string(), UiPiece),
});
export type UiSkin = z.infer<typeof UiSkin>;

export const PORTRAIT_ANIMATIONS = ["talk", "nod", "shake"] as const;
export type PortraitAnimation = (typeof PORTRAIT_ANIMATIONS)[number];

/**
 * Retratos animados de los agentes, compuestos por `pnpm portraits:compose`.
 * `image` lleva `{agent}`, que se sustituye por el id del agente.
 */
export const PortraitSet = z.object({
  ...licensed,
  /** Retrato grande (UI: inspector). */
  image: z.string(),
  frameSize: z.number().int().positive(),
  /** Retrato pequeño (mapa: junto al bocadillo). */
  mapImage: z.string().optional(),
  mapFrameSize: z.number().int().positive().optional(),
  columns: z.number().int().positive(),
  animations: z.record(z.string(), AnimationDef),
});
export type PortraitSet = z.infer<typeof PortraitSet>;

export const AssetPack = z.object({
  description: z.string().default(""),
  /** Crédito que debe mostrarse (licencias). */
  credits: z.string().default(""),
  tilesets: z.array(TilesetDef).min(1),
  stamps: z.record(z.string(), Stamp),
  characters: z.record(z.string(), CharacterSheet),
  /** Personaje por defecto de cada agente (si su appearance.sheet no existe en el pack). */
  agentCharacters: z.record(z.string(), z.string()).default({}),
  ui: UiSkin.optional(),
  portraits: PortraitSet.optional(),
});
export type AssetPack = z.infer<typeof AssetPack>;

/** Crédito exigido por la licencia de un pack de terceros (se muestra en la UI). */
export const Credit = z.object({
  id: z.string(),
  name: z.string(),
  author: z.string(),
  url: z.string().url(),
  license: License,
  /** Texto que la licencia pide mostrar (o un resumen de sus condiciones). */
  notice: z.string().default(""),
});
export type Credit = z.infer<typeof Credit>;

export const AssetManifest = z.object({
  activePack: z.string(),
  packs: z.record(z.string(), AssetPack),
  credits: z.array(Credit).default([]),
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

export interface AssetInUse {
  kind: "tileset" | "character" | "ui" | "portraits";
  name: string;
  image: string;
  license: License;
  source?: string;
  /** Para personajes: agentes que la usan. */
  usedBy?: string[];
}

/**
 * Assets de un pack que se usan de verdad: tilesets que referencia el mapa, hojas de personaje
 * asignadas a los agentes, la piel de UI y los retratos.
 */
export function assetsInUse(
  pack: AssetPack,
  opts: { tilesets: string[]; agents: { id: string; sheet?: string }[] },
): AssetInUse[] {
  const out: AssetInUse[] = [];
  for (const t of pack.tilesets) {
    if (!opts.tilesets.includes(t.name)) continue;
    out.push({
      kind: "tileset",
      name: t.name,
      image: t.image,
      license: t.license,
      source: t.source,
    });
  }
  const users = new Map<string, string[]>();
  for (const a of opts.agents) {
    const key = characterFor(pack, a.id, a.sheet);
    users.set(key, [...(users.get(key) ?? []), a.id]);
  }
  for (const [key, usedBy] of users) {
    const c = pack.characters[key]!;
    out.push({
      kind: "character",
      name: key,
      image: c.image,
      license: c.license,
      source: c.source,
      usedBy,
    });
  }
  if (pack.ui) {
    const u = pack.ui;
    out.push({ kind: "ui", name: "ui", image: u.image, license: u.license, source: u.source });
  }
  if (pack.portraits) {
    const p = pack.portraits;
    out.push({
      kind: "portraits",
      name: "portraits",
      image: p.image,
      license: p.license,
      source: p.source,
    });
  }
  return out;
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
