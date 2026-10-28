/**
 * Genera seeds/town.tmj: un mapa Tiled JSON válido (se puede abrir y editar en Tiled) con los
 * tilesets del pack de assets activo (apps/web/public/assets/manifest.json).
 * Uso: pnpm map:generate [--pack nombre]
 *
 * El trazado (edificios, caminos, spots) es fijo; cada pack decide qué baldosas usa mediante
 * "sellos" (stamps) del manifest, así se puede cambiar de pack sin tocar este script.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  AssetManifest,
  REQUIRED_STAMPS,
  activePack,
  parseTiledMap,
  type Stamp,
  type TiledMap,
  type TiledObject,
  type TiledTileset,
} from "@lethetown/shared";

const W = 60;
const H = 40;
const TS = 16;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "seeds/town.tmj");
const PUBLIC = path.join(ROOT, "apps/web/public");

// --- Pack --------------------------------------------------------------------------------

const packArg = process.argv.indexOf("--pack");
const manifest = AssetManifest.parse(
  JSON.parse(readFileSync(path.join(PUBLIC, "assets/manifest.json"), "utf8")),
);
const { name: packName, pack } = activePack(
  manifest,
  packArg > -1 ? process.argv[packArg + 1] : undefined,
);
const missing = REQUIRED_STAMPS.filter((s) => !pack.stamps[s]);
if (missing.length)
  throw new Error(`Al pack "${packName}" le faltan sellos: ${missing.join(", ")}`);

let firstgid = 1;
const tilesets: TiledTileset[] = pack.tilesets.map((t) => {
  const columns = Math.floor(t.imageWidth / t.tileWidth);
  const tilecount = columns * Math.floor(t.imageHeight / t.tileHeight);
  const ts: TiledTileset = {
    firstgid,
    name: t.name,
    // Relativa a seeds/: Tiled la usa para mostrar el mapa al editarlo.
    image: path.relative(path.join(ROOT, "seeds"), path.join(PUBLIC, t.image)),
    imagewidth: t.imageWidth,
    imageheight: t.imageHeight,
    tilewidth: t.tileWidth,
    tileheight: t.tileHeight,
    tilecount,
    columns,
    margin: 0,
    spacing: 0,
  };
  firstgid += tilecount;
  return ts;
});
const tilesetByName = new Map(tilesets.map((t) => [t.name, t]));

function stamp(name: (typeof REQUIRED_STAMPS)[number]): Stamp {
  return pack.stamps[name]!;
}

function gidOf(s: Stamp, col: number, row: number): number {
  const ts = tilesetByName.get(s.tileset)!;
  return ts.firstgid + row * ts.columns + col;
}

// --- Capas -------------------------------------------------------------------------------

type Grid = number[];
const grid = (): Grid => new Array<number>(W * H).fill(0);
const layers = {
  ground: grid(),
  paths: grid(),
  buildings: grid(),
  decor: grid(),
  roofs: grid(),
  collision: grid(),
};
type LayerName = keyof typeof layers;
const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H;
const put = (layer: LayerName, x: number, y: number, gid: number) => {
  if (inside(x, y)) layers[layer][y * W + x] = gid;
};
const collisionGid = gidOf(stamp("collision"), stamp("collision").x, stamp("collision").y);
const block = (x: number, y: number) => put("collision", x, y, collisionGid);
const unblock = (x: number, y: number) => put("collision", x, y, 0);

/** Coloca un sello fijo con su ancla en (x, y). */
function place(layer: LayerName, name: (typeof REQUIRED_STAMPS)[number], x: number, y: number) {
  const s = stamp(name);
  const ox = x - s.anchor[0];
  const oy = y - s.anchor[1];
  for (let j = 0; j < s.h; j++) {
    for (let i = 0; i < s.w; i++) put(layer, ox + i, oy + j, gidOf(s, s.x + i, s.y + j));
  }
  for (const [bx, by] of s.blocks) block(ox + bx, oy + by);
}

/** Rellena un área con un sello en modo patrón (alineado a coordenadas del mapa). */
function pattern(
  layer: LayerName,
  name: (typeof REQUIRED_STAMPS)[number],
  x: number,
  y: number,
  w: number,
  h: number,
) {
  const s = stamp(name);
  for (let j = y; j < y + h; j++) {
    for (let i = x; i < x + w; i++) put(layer, i, j, gidOf(s, s.x + (i % s.w), s.y + (j % s.h)));
  }
}

/** Estira un sello nine-slice sobre un área. */
function nineslice(
  layer: LayerName,
  name: (typeof REQUIRED_STAMPS)[number],
  x: number,
  y: number,
  w: number,
  h: number,
) {
  const s = stamp(name);
  const pick = (i: number, n: number, size: number) => {
    if (size < 3) return Math.min(i, size - 1);
    if (i === 0) return 0;
    if (i === n - 1) return size - 1;
    return 1 + ((i - 1) % (size - 2));
  };
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const interior = i > 0 && j > 0 && i < w - 1 && j < h - 1;
      const [cx, cy] = interior && s.center ? s.center : [pick(i, w, s.w), pick(j, h, s.h)];
      put(layer, x + i, y + j, gidOf(s, s.x + cx, s.y + cy));
    }
  }
}

// --- Objetos -----------------------------------------------------------------------------

let nextObjectId = 1;
const places: TiledObject[] = [];
const spots: TiledObject[] = [];
const lights: TiledObject[] = [];
const windows: TiledObject[] = [];
const str = (name: string, value: string) => ({ name, type: "string", value });
const point = (name: string, type: string, x: number, y: number): TiledObject => ({
  id: nextObjectId++,
  name,
  type,
  x: x * TS + TS / 2,
  y: y * TS + TS / 2,
  width: 0,
  height: 0,
  rotation: 0,
  visible: true,
  point: true,
});

type Rect = { x: number; y: number; w: number; h: number };

function addPlace(id: string, name: string, kind: string, r: Rect, indoor: boolean) {
  places.push({
    id: nextObjectId++,
    name,
    type: "place",
    x: r.x * TS,
    y: r.y * TS,
    width: r.w * TS,
    height: r.h * TS,
    rotation: 0,
    visible: true,
    properties: [
      str("id", id),
      str("name", name),
      str("kind", kind),
      { name: "indoor", type: "bool", value: indoor },
    ],
  });
}

function addSpot(
  id: string,
  name: string,
  placeId: string,
  pose: "sit" | "sleep" | "stand" | "use",
  x: number,
  y: number,
  owner?: string,
) {
  spots.push({
    ...point(name, "spot", x, y),
    properties: [
      str("id", id),
      str("name", name),
      str("placeId", placeId),
      str("pose", pose),
      str("state", "idle"),
      ...(owner ? [str("owner", owner)] : []),
    ],
  });
}

/**
 * Edificio estilo LimeZu: borde de techo, pared de 2 baldosas, suelo, puerta abajo.
 * Por encima (capa roofs): azotea + fachada con la puerta, que el cliente oculta si hay alguien dentro.
 */
function building(
  r: Rect,
  doorX: number,
  wall: "wall_blue" | "wall_red" | "wall_wood" | "wall_grey",
  floor: "floor_home" | "floor_cafe" | "floor_shop",
) {
  const bottom = r.y + r.h - 1;
  pattern("buildings", "ceiling", r.x, r.y, r.w, 1);
  pattern("buildings", "ceiling", r.x, bottom, r.w, 1);
  pattern("buildings", "ceiling", r.x, r.y, 1, r.h);
  pattern("buildings", "ceiling", r.x + r.w - 1, r.y, 1, r.h);
  pattern("buildings", wall, r.x + 1, r.y + 1, r.w - 2, 2);
  pattern("ground", floor, r.x + 1, r.y + 3, r.w - 2, r.h - 4);
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) {
      const border = y <= r.y + 2 || y === bottom || x === r.x || x === r.x + r.w - 1;
      if (border) block(x, y);
    }
  }
  // Puerta: hueco transitable en el borde inferior, con suelo.
  put("buildings", doorX, bottom, 0);
  pattern("ground", floor, doorX, bottom, 1, 1);
  unblock(doorX, bottom);

  // Exterior: azotea + fachada (3 filas) con la puerta alineada.
  const facade = stamp("facade");
  nineslice("roofs", "roof", r.x, r.y, r.w, r.h - facade.h);
  const doorCol = Math.min(2, facade.w - 1);
  const middle = [1, 3, 4].filter((c) => c < facade.w - 1);
  let k = 0;
  for (let i = 0; i < r.w; i++) {
    const x = r.x + i;
    const col =
      i === 0
        ? 0
        : i === r.w - 1
          ? facade.w - 1
          : x === doorX
            ? doorCol
            : (middle[k++ % Math.max(1, middle.length)] ?? 0);
    for (let j = 0; j < facade.h; j++) {
      put("roofs", x, bottom - facade.h + 1 + j, gidOf(facade, facade.x + col, facade.y + j));
    }
    // Columnas de ventana: se iluminan de noche.
    if (col === 1 || col === 4) windows.push(point("ventana", "window", x, bottom - 1));
  }
}

function pathRect(x0: number, y0: number, x1: number, y1: number) {
  const [xa, xb] = [Math.min(x0, x1), Math.max(x0, x1)];
  const [ya, yb] = [Math.min(y0, y1), Math.max(y0, y1)];
  pattern("paths", "path", xa, ya, xb - xa + 1, yb - ya + 1);
}

// --- Trazado -----------------------------------------------------------------------------

pattern("ground", "grass", 0, 0, W, H);

// Caminos
pathRect(0, 24, W - 1, 25); // calle principal
pathRect(8, 12, 8, 23); // casa azul
pathRect(52, 12, 52, 23); // casa roja
pathRect(30, 23, 30, 23); // café
pathRect(57, 26, 57, 37); // bajada a la tienda
pathRect(49, 37, 57, 37);
pathRect(12, 26, 12, 33); // parque
pathRect(6, 33, 18, 33);

// Edificios
const casaAzul = { x: 2, y: 1, w: 12, h: 11 };
const casaRoja = { x: 46, y: 1, w: 12, h: 11 };
const cafe = { x: 23, y: 12, w: 14, h: 11 };
const tienda = { x: 42, y: 27, w: 14, h: 10 };
building(casaAzul, 8, "wall_blue", "floor_home");
building(casaRoja, 52, "wall_red", "floor_home");
building(cafe, 30, "wall_wood", "floor_cafe");
building(tienda, 49, "wall_grey", "floor_shop");

addPlace("casa_azul", "Casa azul", "home", casaAzul, true);
addPlace("casa_roja", "Casa roja", "home", casaRoja, true);
addPlace("cafe_ola", "Café La Ola", "cafe", cafe, true);
addPlace("parque", "Parque del Olvido", "park", { x: 2, y: 27, w: 20, h: 12 }, false);
addPlace("tienda", "Ultramarinos Lete", "shop", tienda, true);

// Casa azul (suelo x 3..12, y 4..10)
place("decor", "bed", 4, 5);
addSpot("cama_azul", "cama", "casa_azul", "sleep", 4, 5, "lucia");
place("decor", "desk", 10, 6);
addSpot("mesa_dibujo", "mesa de dibujo", "casa_azul", "sit", 10, 6);
place("decor", "stove", 7, 6);
addSpot("cocina_azul", "cocina", "casa_azul", "use", 7, 6);
place("paths", "rug", 5, 8);
place("decor", "plant", 12, 4);

// Casa roja (suelo x 47..56, y 4..10)
place("decor", "bed", 48, 5);
addSpot("cama_mateo", "cama de Mateo", "casa_roja", "sleep", 48, 5, "mateo");
place("decor", "bed", 55, 5);
addSpot("cama_carmen", "cama de Carmen", "casa_roja", "sleep", 55, 5, "carmen");
place("decor", "stove", 52, 6);
addSpot("cocina_roja", "cocina", "casa_roja", "use", 52, 6);
place("decor", "table", 50, 8);
place("decor", "bookshelf", 47, 8);

// Café (suelo x 24..35, y 15..21)
place("decor", "coffee_machine", 24, 17);
addSpot("cafetera", "cafetera", "cafe_ola", "use", 24, 17);
place("decor", "counter", 26, 18);
place("decor", "stool", 26, 18);
addSpot("barra", "barra", "cafe_ola", "sit", 26, 18);
place("decor", "table", 32, 15);
place("decor", "chair", 33, 18);
addSpot("mesa_ventana", "mesa junto a la ventana", "cafe_ola", "sit", 33, 18);
place("decor", "plant", 35, 20);
place("decor", "sofa", 25, 20);

// Tienda (suelo x 43..54, y 30..35)
place("decor", "fridge_shelf", 44, 33);
addSpot("estanteria", "estantería", "tienda", "use", 44, 33);
place("decor", "counter", 48, 33);
addSpot("mostrador", "mostrador", "tienda", "use", 48, 33);
place("decor", "fridge_shelf", 52, 33);

// Parque (x 2..21, y 27..38)
place("decor", "bench", 8, 31);
addSpot("banco", "banco", "parque", "sit", 8, 31);
place("decor", "fountain", 15, 33);
addSpot("fuente", "fuente", "parque", "stand", 15, 33);
nineslice("ground", "water", 17, 35, 4, 3);
for (let y = 35; y < 38; y++) for (let x = 17; x < 21; x++) block(x, y);

// Árboles, arbustos y farolas
for (const [x, y] of [
  [4, 30],
  [20, 30],
  [4, 38],
  [11, 38],
  [16, 9],
  [21, 6],
  [39, 6],
  [43, 10],
  [26, 34],
  [34, 38],
  [38, 31],
  [58, 20],
  [41, 21],
  [20, 21],
] as const)
  place("decor", "tree", x, y);
for (const [x, y] of [
  [15, 13],
  [44, 14],
  [38, 18],
  [2, 22],
  [58, 30],
] as const) {
  place("decor", "bush", x, y);
}
for (const x of [5, 18, 38, 44, 57]) {
  place("decor", "lamp", x, 23);
  lights.push(point("farola", "light", x, 23));
}

// --- Ensamblado ---------------------------------------------------------------------------

let layerId = 1;
const tileLayer = (name: LayerName, visible = true) => ({
  type: "tilelayer" as const,
  id: layerId++,
  name,
  width: W,
  height: H,
  x: 0,
  y: 0,
  opacity: 1,
  visible,
  data: layers[name],
});
const objectLayer = (name: string, objects: TiledObject[]) => ({
  type: "objectgroup" as const,
  id: layerId++,
  name,
  draworder: "topdown",
  opacity: 1,
  visible: true,
  x: 0,
  y: 0,
  objects,
});

const map: TiledMap = {
  type: "map",
  version: "1.10",
  tiledversion: "1.11.0",
  orientation: "orthogonal",
  renderorder: "right-down",
  width: W,
  height: H,
  tilewidth: TS,
  tileheight: TS,
  infinite: false,
  properties: [str("name", "Lethetown"), str("assetPack", packName)],
  layers: [
    tileLayer("ground"),
    tileLayer("paths"),
    tileLayer("buildings"),
    tileLayer("decor"),
    tileLayer("roofs"),
    tileLayer("collision", false),
    objectLayer("places", places),
    objectLayer("spots", spots),
    objectLayer("lights", lights),
    objectLayer("windows", windows),
  ],
  nextlayerid: 0,
  nextobjectid: 0,
  tilesets,
};
map.nextlayerid = layerId;
map.nextobjectid = nextObjectId;

// Validación: el parser compartido debe aceptarlo (spots transitables, lugares, etc.).
const world = parseTiledMap(map);
writeFileSync(OUT, JSON.stringify(map) + "\n");
console.log(
  `Mapa generado en ${path.relative(ROOT, OUT)} con el pack "${packName}": ${world.places.length} lugares, ` +
    `${world.places.reduce((n, p) => n + p.objects.length, 0)} spots, ${world.windows.length} ventanas, ` +
    `${world.lights.length} farolas.`,
);
