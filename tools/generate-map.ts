/**
 * Genera seeds/town.tmj: un mapa Tiled JSON válido (se puede abrir y editar en Tiled).
 * Las baldosas se eligen por nombre semántico (packages/shared/src/map/tiles.ts).
 * Uso: pnpm map:generate
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PLACEHOLDER_TILESET_COLUMNS,
  TILE_INDEX,
  TILE_NAMES,
  parseTiledMap,
  type TileName,
  type TiledMap,
  type TiledObject,
} from "@lethetown/shared";

const W = 60;
const H = 40;
const TS = 16;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "seeds/town.tmj");

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
const gid = (name: TileName) => TILE_INDEX[name] + 1;
const set = (g: Grid, x: number, y: number, name: TileName | null) => {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  g[y * W + x] = name ? gid(name) : 0;
};
const fill = (g: Grid, x: number, y: number, w: number, h: number, name: TileName | null) => {
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) set(g, i, j, name);
};
const block = (x: number, y: number) => set(layers.collision, x, y, "collision");

let nextObjectId = 1;
const places: TiledObject[] = [];
const spots: TiledObject[] = [];
const lights: TiledObject[] = [];

function str(name: string, value: string) {
  return { name, type: "string", value };
}

function addPlace(
  id: string,
  name: string,
  kind: string,
  r: { x: number; y: number; w: number; h: number },
  indoor: boolean,
) {
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
  furniture: TileName | null,
  owner?: string,
) {
  if (furniture) set(layers.decor, x, y, furniture);
  spots.push({
    id: nextObjectId++,
    name,
    type: "spot",
    // Centro de la baldosa, como punto.
    x: x * TS + TS / 2,
    y: y * TS + TS / 2,
    width: 0,
    height: 0,
    rotation: 0,
    visible: true,
    point: true,
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

/** Edificio: muros con ventanas, puerta, suelo y tejado. */
function building(
  r: { x: number; y: number; w: number; h: number },
  door: { x: number; y: number },
  floor: TileName,
) {
  fill(layers.ground, r.x, r.y, r.w, r.h, floor);
  for (let x = r.x; x < r.x + r.w; x++) {
    for (const y of [r.y, r.y + r.h - 1]) {
      const window = y === r.y && (x - r.x) % 3 === 2 && x < r.x + r.w - 1;
      set(layers.buildings, x, y, window ? "wall_window" : "wall");
      block(x, y);
    }
  }
  for (let y = r.y; y < r.y + r.h; y++) {
    for (const x of [r.x, r.x + r.w - 1]) {
      set(layers.buildings, x, y, "wall");
      block(x, y);
    }
  }
  set(layers.buildings, door.x, door.y, "door");
  set(layers.collision, door.x, door.y, null);
  fill(layers.roofs, r.x, r.y, r.w, r.h, "roof");
  fill(layers.roofs, r.x, r.y + r.h - 1, r.w, 1, "roof_edge");
}

function pathLine(x0: number, y0: number, x1: number, y1: number, width = 1) {
  const [xa, xb] = [Math.min(x0, x1), Math.max(x0, x1)];
  const [ya, yb] = [Math.min(y0, y1), Math.max(y0, y1)];
  fill(layers.paths, xa, ya, xb - xa + width, yb - ya + width, "path");
}

function tree(x: number, y: number) {
  set(layers.decor, x, y, "tree");
  block(x, y);
}

// --- Terreno -------------------------------------------------------------------------
fill(layers.ground, 0, 0, W, H, "grass");
for (let i = 0; i < 90; i++) {
  // Flores repartidas de forma determinista.
  set(layers.ground, (i * 37) % W, (i * 23 + 7) % H, "grass_flowers");
}

// --- Caminos -------------------------------------------------------------------------
pathLine(0, 24, W - 1, 24, 2); // calle principal (y 24-25)
pathLine(8, 11, 8, 24); // casa azul
pathLine(52, 11, 52, 24); // casa roja
pathLine(30, 23, 30, 24); // café
pathLine(49, 25, 49, 26); // tienda
pathLine(12, 25, 12, 30); // parque
pathLine(6, 30, 18, 30); // paseo del parque

// --- Edificios -----------------------------------------------------------------------
const casaAzul = { x: 2, y: 2, w: 12, h: 9 };
const casaRoja = { x: 46, y: 2, w: 12, h: 9 };
const cafe = { x: 23, y: 13, w: 14, h: 10 };
const tienda = { x: 42, y: 26, w: 14, h: 9 };
building(casaAzul, { x: 8, y: 10 }, "wood_floor");
building(casaRoja, { x: 52, y: 10 }, "wood_floor");
building(cafe, { x: 30, y: 22 }, "wood_floor");
building(tienda, { x: 49, y: 26 }, "tile_floor");

// --- Lugares -------------------------------------------------------------------------
addPlace("casa_azul", "Casa azul", "home", casaAzul, true);
addPlace("casa_roja", "Casa roja", "home", casaRoja, true);
addPlace("cafe_ola", "Café La Ola", "cafe", cafe, true);
addPlace("parque", "Parque del Olvido", "park", { x: 2, y: 27, w: 20, h: 12 }, false);
addPlace("tienda", "Ultramarinos Lete", "shop", tienda, true);

// --- Spots (objetos con pose) ---------------------------------------------------------
addSpot("cama_azul", "cama", "casa_azul", "sleep", 4, 4, "bed", "lucia");
addSpot("mesa_dibujo", "mesa de dibujo", "casa_azul", "sit", 10, 4, "desk");
addSpot("cocina_azul", "cocina", "casa_azul", "use", 11, 8, "stove");
set(layers.decor, 7, 6, "rug");

addSpot("cama_mateo", "cama de Mateo", "casa_roja", "sleep", 48, 4, "bed", "mateo");
addSpot("cama_carmen", "cama de Carmen", "casa_roja", "sleep", 55, 4, "bed", "carmen");
addSpot("cocina_roja", "cocina", "casa_roja", "use", 54, 8, "stove");
set(layers.decor, 50, 7, "table");

fill(layers.decor, 25, 15, 5, 1, "counter");
addSpot("cafetera", "cafetera", "cafe_ola", "use", 24, 15, "coffee_machine");
addSpot("barra", "barra", "cafe_ola", "sit", 27, 16, "chair");
addSpot("mesa_ventana", "mesa junto a la ventana", "cafe_ola", "sit", 33, 17, "chair");
set(layers.decor, 34, 17, "table");

addSpot("banco", "banco", "parque", "sit", 8, 31, "bench");
set(layers.decor, 15, 34, "fountain");
block(15, 34);
addSpot("fuente", "fuente", "parque", "stand", 15, 33, null);
fill(layers.ground, 17, 35, 4, 3, "water");
for (let y = 35; y < 38; y++) for (let x = 17; x < 21; x++) block(x, y);

addSpot("mostrador", "mostrador", "tienda", "use", 48, 30, "counter");
addSpot("estanteria", "estantería", "tienda", "use", 44, 28, "shelf");

// --- Decoración exterior ---------------------------------------------------------------
for (const [x, y] of [
  [3, 28],
  [6, 28],
  [20, 28],
  [3, 33],
  [3, 37],
  [10, 37],
  [21, 32],
  [17, 3],
  [20, 6],
  [38, 4],
  [41, 9],
  [35, 30],
  [38, 36],
  [26, 34],
  [58, 20],
])
  tree(x!, y!);
for (const [x, y] of [
  [14, 12],
  [44, 12],
  [22, 20],
  [38, 20],
  [40, 34],
])
  set(layers.decor, x!, y!, "bush");
for (const x of [5, 18, 37, 44, 57]) {
  set(layers.decor, x, 23, "lamp");
  block(x, 23);
  lights.push({
    id: nextObjectId++,
    name: "farola",
    type: "light",
    x: x * TS + TS / 2,
    y: 23 * TS + TS / 2,
    width: 0,
    height: 0,
    rotation: 0,
    visible: true,
    point: true,
  });
}

// --- Ensamblado ------------------------------------------------------------------------
const tilecount = TILE_NAMES.length;
const columns = PLACEHOLDER_TILESET_COLUMNS;
let layerId = 1;
const tileLayer = (name: keyof typeof layers, visible = true) => ({
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
  properties: [str("name", "Lethetown")],
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
  ],
  nextlayerid: 0,
  nextobjectid: nextObjectId,
  tilesets: [
    {
      firstgid: 1,
      name: "town",
      // Relativa a seeds/: Tiled la usa para mostrar el mapa al editarlo.
      image: "../apps/web/public/assets/placeholder/tileset.png",
      imagewidth: columns * TS,
      imageheight: Math.ceil(tilecount / columns) * TS,
      tilewidth: TS,
      tileheight: TS,
      tilecount,
      columns,
      margin: 0,
      spacing: 0,
      tiles: [
        { id: TILE_INDEX.wall_window, properties: [{ name: "window", type: "bool", value: true }] },
      ],
    },
  ],
};
map.nextlayerid = layerId;

// Validación: el parser compartido debe aceptarlo.
const world = parseTiledMap(map);
writeFileSync(OUT, JSON.stringify(map, null, 1) + "\n");
console.log(
  `Mapa generado en ${path.relative(ROOT, OUT)}: ${world.places.length} lugares, ` +
    `${world.places.reduce((n, p) => n + p.objects.length, 0)} spots, ${world.windows.length} ventanas.`,
);
