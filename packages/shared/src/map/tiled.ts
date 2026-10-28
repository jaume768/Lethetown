import { z } from "zod";
import { Place, PlaceKind, Pose, World, type Spot, type TilePoint } from "../schemas/world";

// --- Subconjunto del formato Tiled JSON (https://doc.mapeditor.org/en/stable/reference/json-map-format/)

export const TiledProperty = z.object({
  name: z.string(),
  type: z.string().default("string"),
  value: z.union([z.string(), z.number(), z.boolean()]),
});
export type TiledProperty = z.infer<typeof TiledProperty>;

export const TiledObject = z.object({
  id: z.number().int(),
  name: z.string().default(""),
  type: z.string().default(""),
  x: z.number(),
  y: z.number(),
  width: z.number().default(0),
  height: z.number().default(0),
  rotation: z.number().default(0),
  visible: z.boolean().default(true),
  point: z.boolean().optional(),
  properties: z.array(TiledProperty).optional(),
});
export type TiledObject = z.infer<typeof TiledObject>;

export const TiledTileLayer = z.object({
  type: z.literal("tilelayer"),
  id: z.number().int(),
  name: z.string(),
  width: z.number().int(),
  height: z.number().int(),
  x: z.number().default(0),
  y: z.number().default(0),
  opacity: z.number().default(1),
  visible: z.boolean().default(true),
  data: z.array(z.number().int()),
});
export type TiledTileLayer = z.infer<typeof TiledTileLayer>;

export const TiledObjectLayer = z.object({
  type: z.literal("objectgroup"),
  id: z.number().int(),
  name: z.string(),
  draworder: z.string().default("topdown"),
  opacity: z.number().default(1),
  visible: z.boolean().default(true),
  x: z.number().default(0),
  y: z.number().default(0),
  objects: z.array(TiledObject),
});
export type TiledObjectLayer = z.infer<typeof TiledObjectLayer>;

export const TiledTileset = z.object({
  firstgid: z.number().int(),
  name: z.string(),
  image: z.string(),
  imagewidth: z.number().int(),
  imageheight: z.number().int(),
  tilewidth: z.number().int(),
  tileheight: z.number().int(),
  tilecount: z.number().int(),
  columns: z.number().int(),
  margin: z.number().int().default(0),
  spacing: z.number().int().default(0),
  /** Propiedades por baldosa (p. ej. `window: true`). */
  tiles: z
    .array(z.object({ id: z.number().int(), properties: z.array(TiledProperty).optional() }))
    .optional(),
});
export type TiledTileset = z.infer<typeof TiledTileset>;

export const TiledMap = z.object({
  type: z.literal("map"),
  version: z.string(),
  tiledversion: z.string().optional(),
  orientation: z.literal("orthogonal"),
  renderorder: z.string().default("right-down"),
  width: z.number().int(),
  height: z.number().int(),
  tilewidth: z.number().int(),
  tileheight: z.number().int(),
  infinite: z.literal(false),
  nextlayerid: z.number().int(),
  nextobjectid: z.number().int(),
  properties: z.array(TiledProperty).optional(),
  layers: z.array(z.discriminatedUnion("type", [TiledTileLayer, TiledObjectLayer])),
  tilesets: z.array(TiledTileset).min(1),
});
export type TiledMap = z.infer<typeof TiledMap>;

/** Capas obligatorias del mapa del pueblo. */
export const TILE_LAYERS = ["ground", "paths", "buildings", "decor", "roofs", "collision"] as const;

// --- Parser ----------------------------------------------------------------------------

export function prop(
  obj: { properties?: TiledProperty[] },
  name: string,
): TiledProperty["value"] | undefined {
  return obj.properties?.find((p) => p.name === name)?.value;
}

function requireString(obj: TiledObject, name: string): string {
  const v = prop(obj, name);
  if (typeof v !== "string" || !v) {
    throw new Error(`Objeto Tiled ${obj.id} ("${obj.name}"): falta la propiedad "${name}"`);
  }
  return v;
}

function tileLayer(map: TiledMap, name: string): TiledTileLayer {
  const layer = map.layers.find((l) => l.name === name);
  if (!layer || layer.type !== "tilelayer") throw new Error(`Falta la capa de baldosas "${name}"`);
  if (layer.data.length !== map.width * map.height) {
    throw new Error(`La capa "${name}" no mide ${map.width}×${map.height}`);
  }
  return layer;
}

function objectLayer(map: TiledMap, name: string): TiledObjectLayer | undefined {
  const layer = map.layers.find((l) => l.name === name);
  if (layer && layer.type !== "objectgroup")
    throw new Error(`"${name}" debe ser una capa de objetos`);
  return layer;
}

/** Baldosa transitable más cercana a (cx, cy) dentro del rectángulo; desempata por fila y columna. */
export function nearestWalkable(
  collision: number[],
  width: number,
  area: { x: number; y: number; w: number; h: number },
  cx: number,
  cy: number,
): TilePoint | null {
  let best: TilePoint | null = null;
  let bestD = Infinity;
  for (let y = area.y; y < area.y + area.h; y++) {
    for (let x = area.x; x < area.x + area.w; x++) {
      if (collision[y * width + x]) continue;
      const d = Math.abs(x - cx) + Math.abs(y - cy);
      if (d < bestD) {
        bestD = d;
        best = { x, y };
      }
    }
  }
  return best;
}

/**
 * Convierte un mapa Tiled en el `World` de la simulación: lugares (capa `places`),
 * objetos/spots (capa `spots`), rejilla de colisión (capa `collision`), farolas (`lights`)
 * y ventanas (`windows`).
 */
export function parseTiledMap(input: unknown): World {
  const map = TiledMap.parse(input);
  if (map.tilewidth !== map.tileheight) throw new Error("Se esperan baldosas cuadradas");
  const ts = map.tilewidth;
  for (const name of TILE_LAYERS) tileLayer(map, name);

  const collision = tileLayer(map, "collision").data.map((gid) => (gid ? 1 : 0));
  const paths = tileLayer(map, "paths").data.map((gid) => (gid ? 1 : 0));
  const toTile = (px: number) => Math.floor(px / ts);

  const placesLayer = objectLayer(map, "places");
  if (!placesLayer) throw new Error('Falta la capa de objetos "places"');
  const spotsLayer = objectLayer(map, "spots");

  const spotsByPlace = new Map<string, Spot[]>();
  for (const o of spotsLayer?.objects ?? []) {
    const placeId = requireString(o, "placeId");
    const owner = prop(o, "owner");
    const spot: Spot = {
      id: requireString(o, "id"),
      name: requireString(o, "name"),
      placeId,
      pose: Pose.parse(requireString(o, "pose")),
      tile: { x: toTile(o.x), y: toTile(o.y) },
      state: typeof prop(o, "state") === "string" ? String(prop(o, "state")) : "idle",
      owner: typeof owner === "string" && owner ? owner : null,
    };
    if (collision[spot.tile.y * map.width + spot.tile.x]) {
      throw new Error(`El spot "${spot.id}" está sobre una baldosa bloqueada`);
    }
    spotsByPlace.set(placeId, [...(spotsByPlace.get(placeId) ?? []), spot]);
  }

  const places = placesLayer.objects.map((o): Place => {
    const area = {
      x: toTile(o.x),
      y: toTile(o.y),
      w: Math.max(1, Math.round(o.width / ts)),
      h: Math.max(1, Math.round(o.height / ts)),
    };
    const id = requireString(o, "id");
    const anchor = nearestWalkable(
      collision,
      map.width,
      area,
      area.x + Math.floor(area.w / 2),
      area.y + Math.floor(area.h / 2),
    );
    if (!anchor) throw new Error(`El lugar "${id}" no tiene ninguna baldosa transitable`);
    return Place.parse({
      id,
      name: requireString(o, "name"),
      kind: PlaceKind.parse(requireString(o, "kind")),
      area,
      indoor: prop(o, "indoor") === true,
      anchor,
      objects: spotsByPlace.get(id) ?? [],
    });
  });

  const ids = new Set(places.map((p) => p.id));
  for (const placeId of spotsByPlace.keys()) {
    if (!ids.has(placeId)) throw new Error(`Spot con placeId desconocido: ${placeId}`);
  }

  const lights = (objectLayer(map, "lights")?.objects ?? []).map((o) => ({
    x: toTile(o.x),
    y: toTile(o.y),
  }));
  const windows = (objectLayer(map, "windows")?.objects ?? []).map((o) => ({
    x: toTile(o.x),
    y: toTile(o.y),
  }));

  const name = prop(map, "name");
  return World.parse({
    name: typeof name === "string" ? name : "Pueblo",
    width: map.width,
    height: map.height,
    tileSize: ts,
    places,
    collision,
    paths,
    lights,
    windows,
  });
}
