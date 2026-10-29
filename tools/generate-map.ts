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
  type StampName,
  parseTiledMap,
  type Stamp,
  type TiledMap,
  type TiledObject,
  type TiledTileset,
} from "@lethetown/shared";

const W = 120;
const H = 80;
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

function stamp(name: StampName): Stamp {
  return pack.stamps[name]!;
}

/** ¿Define el pack este sello (opcional)? */
const has = (name: StampName) => Boolean(pack.stamps[name]);

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
function place(layer: LayerName, name: StampName, x: number, y: number) {
  const s = pack.stamps[name];
  if (!s) return; // sello opcional que este pack no tiene
  const ox = x - s.anchor[0];
  const oy = y - s.anchor[1];
  for (let j = 0; j < s.h; j++) {
    for (let i = 0; i < s.w; i++) put(layer, ox + i, oy + j, gidOf(s, s.x + i, s.y + j));
  }
  for (const [bx, by] of s.blocks) block(ox + bx, oy + by);
}

/** Rellena un área con un sello en modo patrón (alineado a coordenadas del mapa). */
function pattern(layer: LayerName, name: StampName, x: number, y: number, w: number, h: number) {
  const s = stamp(name);
  for (let j = y; j < y + h; j++) {
    for (let i = x; i < x + w; i++) put(layer, i, j, gidOf(s, s.x + (i % s.w), s.y + (j % s.h)));
  }
}

/** Estira un sello nine-slice sobre un área. */
function nineslice(layer: LayerName, name: StampName, x: number, y: number, w: number, h: number) {
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

type Wall = "wall_blue" | "wall_red" | "wall_wood" | "wall_grey";
type Floor = "floor_home" | "floor_cafe" | "floor_shop";

/** Habitación estilo LimeZu: borde de techo, pared de 2 baldosas, suelo y puerta abajo. */
function room(r: Rect, doorX: number, wall: Wall, floor: Floor) {
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
}

/**
 * Edificio: habitación y, por encima (capa roofs), azotea + fachada con la puerta, que el
 * cliente oculta si hay alguien dentro.
 */
function building(r: Rect, doorX: number, wall: Wall, floor: Floor) {
  room(r, doorX, wall, floor);
  const bottom = r.y + r.h - 1;
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

const VILLA_W = 8;
const VILLA_H = 13;

/**
 * Casa de 8×13 con su puerta en (x + 2, y + 12). Con los sellos `villa_*` el exterior es una
 * casa completa (tejado a dos aguas) y la habitación empieza dos filas más abajo, bajo el
 * tejado opaco; sin ellos, un edificio normal del mismo tamaño.
 */
function house(x: number, y: number, variant: 1 | 2 | 3 | 4 | 5, wall: Wall): Rect {
  const name = `villa_${variant}` as const;
  const inner = { x, y: y + 2, w: VILLA_W, h: VILLA_H - 2 };
  if (has(name)) {
    room(inner, x + 2, wall, "floor_home");
    place("roofs", name, x, y);
    for (const [wx, wy] of [
      [1, 6],
      [3, 6],
      [6, 6],
      [4, 9],
    ] as const) {
      windows.push(point("ventana", "window", x + wx, y + wy));
    }
  } else {
    building(inner, x + 2, wall, "floor_home");
  }
  // Las dos filas de arriba quedan detrás del tejado: no se pisan.
  for (let i = 0; i < VILLA_W; i++) {
    block(x + i, y);
    block(x + i, y + 1);
  }
  return { x, y, w: VILLA_W, h: VILLA_H };
}

/** Farola (con su luz nocturna) cuyo pie cae en (x, y). */
function lamp(x: number, y: number) {
  place("decor", "lamp", x, y);
  lights.push(point("farola", "light", x, y));
}

function pathRect(x0: number, y0: number, x1: number, y1: number) {
  const [xa, xb] = [Math.min(x0, x1), Math.max(x0, x1)];
  const [ya, yb] = [Math.min(y0, y1), Math.max(y0, y1)];
  pattern("paths", "path", xa, ya, xb - xa + 1, yb - ya + 1);
}

// --- Trazado -----------------------------------------------------------------------------
//
// 120×80 baldosas. De norte a sur: pinar, fila de casas A, calle Norte (y 16-17), fila B
// (casas, biblioteca, escuela y consultorio), calle Mayor (y 37-38), manzana de servicios con
// la plaza y el mercadillo, avenida del Lago (y 56-57) y, abajo, parque, lago, jardín y huerto.
// Dos calles verticales (x 50-51 y 68-69) y la del este (x 118-119) unen las tres horizontales.

pattern("ground", "grass", 0, 0, W, H);

// Calles
pathRect(0, 16, W - 1, 17); // calle Norte
pathRect(0, 37, W - 1, 38); // calle Mayor
pathRect(0, 56, W - 1, 57); // avenida del Lago
pathRect(50, 16, 51, 57);
pathRect(68, 16, 69, 57);
pathRect(118, 16, 119, 57);

// --- Casas -----------------------------------------------------------------------------------

interface HomeDef {
  id: string;
  name: string;
  x: number;
  /** Fila A (y 3, puerta a la calle Norte) o B (y 24, puerta a la calle Mayor). */
  y: 3 | 24;
  variant: 1 | 2 | 3 | 4 | 5;
  wall: Wall;
  /** Camas: [id del spot, nombre, dueño]. */
  beds: [string, string, string][];
  kitchen: string;
}

/** Casa con hasta tres camas en la fila de arriba y la cocina debajo. */
function home(d: HomeDef): Rect {
  const r = house(d.x, d.y, d.variant, d.wall);
  addPlace(d.id, d.name, "home", r, true);
  const cols = [d.x + 1, d.x + 5, d.x + 3];
  d.beds.forEach(([id, name, owner], i) => {
    place("decor", "bed", cols[i]!, d.y + 6);
    addSpot(id, name, d.id, "sleep", cols[i]!, d.y + 6, owner);
  });
  place("decor", "stove", d.x + 3, d.y + 10);
  addSpot(d.kitchen, "cocina", d.id, "use", d.x + 3, d.y + 10);
  place("decor", "plant", d.x + 6, d.y + 10);
  return r;
}

const HOMES: HomeDef[] = [
  // Fila A
  {
    id: "casa_azul",
    name: "Casa azul",
    x: 2,
    y: 3,
    variant: 5,
    wall: "wall_blue",
    beds: [["cama_azul", "cama", "lucia"]],
    kitchen: "cocina_azul",
  },
  {
    id: "casa_amarilla",
    name: "Casa amarilla",
    x: 12,
    y: 3,
    variant: 1,
    wall: "wall_wood",
    beds: [
      ["cama_julian", "cama de Julián", "julian"],
      ["cama_ines", "cama de Inés", "ines"],
    ],
    kitchen: "cocina_amarilla",
  },
  {
    id: "casa_lila",
    name: "Casa lila",
    x: 22,
    y: 3,
    variant: 3,
    wall: "wall_red",
    beds: [["cama_elena", "cama de Elena", "elena"]],
    kitchen: "cocina_lila",
  },
  {
    id: "casa_ocre",
    name: "Casa ocre",
    x: 32,
    y: 3,
    variant: 1,
    wall: "wall_wood",
    beds: [
      ["cama_tomas", "cama de Tomás", "tomas"],
      ["cama_pilar", "cama de Pilar", "pilar"],
    ],
    kitchen: "cocina_ocre",
  },
  {
    id: "casa_marron",
    name: "Casa marrón",
    x: 42,
    y: 3,
    variant: 2,
    wall: "wall_grey",
    beds: [["cama_andres", "cama de Andrés", "andres"]],
    kitchen: "cocina_marron",
  },
  {
    id: "casa_roja",
    name: "Casa roja",
    x: 70,
    y: 3,
    variant: 4,
    wall: "wall_red",
    beds: [
      ["cama_mateo", "cama de Mateo", "mateo"],
      ["cama_carmen", "cama de Carmen", "carmen"],
    ],
    kitchen: "cocina_roja",
  },
  {
    id: "casa_celeste",
    name: "Casa celeste",
    x: 80,
    y: 3,
    variant: 5,
    wall: "wall_blue",
    beds: [["cama_sofia", "cama de Sofía", "sofia"]],
    kitchen: "cocina_celeste",
  },
  {
    id: "casa_granate",
    name: "Casa granate",
    x: 90,
    y: 3,
    variant: 4,
    wall: "wall_red",
    beds: [["cama_rafael", "cama de Rafael", "rafael"]],
    kitchen: "cocina_granate",
  },
  {
    id: "casa_naranja",
    name: "Casa naranja",
    x: 100,
    y: 3,
    variant: 1,
    wall: "wall_wood",
    beds: [
      ["cama_marta", "cama de Marta", "marta"],
      ["cama_leo", "cama de Leo", "leo"],
    ],
    kitchen: "cocina_naranja",
  },
  {
    id: "casa_pino",
    name: "Casa del pinar",
    x: 110,
    y: 3,
    variant: 2,
    wall: "wall_grey",
    beds: [["cama_nuria", "cama de Nuria", "nuria"]],
    kitchen: "cocina_pino",
  },
  // Fila B
  {
    id: "casa_rio",
    name: "Casa del río",
    x: 2,
    y: 24,
    variant: 3,
    wall: "wall_blue",
    beds: [["cama_hugo", "cama de Hugo", "hugo"]],
    kitchen: "cocina_rio",
  },
  {
    id: "casa_colina",
    name: "Casa de la colina",
    x: 12,
    y: 24,
    variant: 5,
    wall: "wall_grey",
    beds: [["cama_valentina", "cama de Valentina", "valentina"]],
    kitchen: "cocina_colina",
  },
  {
    id: "casa_molino",
    name: "Casa del molino",
    x: 22,
    y: 24,
    variant: 2,
    wall: "wall_wood",
    beds: [["cama_ernesto", "cama de Ernesto", "ernesto"]],
    kitchen: "cocina_molino",
  },
  {
    id: "casa_jardin",
    name: "Casa del jardín",
    x: 70,
    y: 24,
    variant: 4,
    wall: "wall_red",
    beds: [
      ["cama_aurora", "cama de Aurora", "aurora"],
      ["cama_clara", "cama de Clara", "clara"],
    ],
    kitchen: "cocina_jardin",
  },
  {
    id: "casa_faro",
    name: "Casa del faro",
    x: 80,
    y: 24,
    variant: 3,
    wall: "wall_blue",
    beds: [["cama_samuel", "cama de Samuel", "samuel"]],
    kitchen: "cocina_faro",
  },
  {
    id: "casa_en_venta",
    name: "Casa en venta",
    x: 90,
    y: 24,
    variant: 1,
    wall: "wall_grey",
    beds: [["cama_vacia", "cama vieja", ""]],
    kitchen: "cocina_vacia",
  },
];
// La cama de la casa en venta no tiene dueño ("" = sin owner).
for (const h of HOMES) home(h);
// Mesa de dibujo de Lucía.
place("decor", "desk", 7, 10);
addSpot("mesa_dibujo", "mesa de dibujo", "casa_azul", "sit", 7, 10);

// --- Edificios públicos ------------------------------------------------------------------

// Ayuntamiento (suelo x 53..66, y 6..14)
const ayuntamiento = { x: 52, y: 3, w: 16, h: 13 };
building(ayuntamiento, 59, "wall_grey", "floor_shop");
addPlace("ayuntamiento", "Ayuntamiento", "other", ayuntamiento, true);
place("decor", "desk", 55, 9);
addSpot("mesa_alcaldia", "mesa de la alcaldía", "ayuntamiento", "sit", 55, 9);
place("decor", "table", 58, 7);
place("decor", "chair", 58, 11);
addSpot("sala_plenos", "sala de plenos", "ayuntamiento", "sit", 58, 11);
place("decor", "chair", 61, 11);
addSpot("silla_pleno", "silla del pleno", "ayuntamiento", "sit", 61, 11);
place("decor", "bookshelf", 64, 6);
place("decor", "plant", 53, 6);
place("decor", "plant", 66, 13);

// Escuela (suelo x 53..66, y 24..35)
const escuela = { x: 52, y: 21, w: 16, h: 16 };
building(escuela, 59, "wall_blue", "floor_home");
addPlace("escuela", "Escuela del pueblo", "other", escuela, true);
place("decor", "desk", 58, 26);
addSpot("mesa_maestra", "mesa de la maestra", "escuela", "sit", 58, 26);
[54, 57, 61, 64].forEach((x, i) => {
  place("decor", "desk", x, 30);
  addSpot(`pupitre_${i + 1}`, `pupitre ${i + 1}`, "escuela", "sit", x, 30);
});
place("decor", "bookshelf", 65, 24);
place("decor", "plant", 53, 34);

// Biblioteca (suelo x 33..48, y 27..35)
const biblioteca = { x: 32, y: 24, w: 18, h: 13 };
building(biblioteca, 40, "wall_wood", "floor_shop");
addPlace("biblioteca", "Biblioteca Mnemósine", "other", biblioteca, true);
for (const x of [33, 35, 37, 44, 46]) place("decor", "bookshelf", x, 27);
place("decor", "desk", 41, 30);
addSpot("mostrador_biblio", "mostrador de préstamo", "biblioteca", "sit", 41, 30);
place("decor", "table", 34, 32);
place("decor", "chair", 35, 35);
addSpot("mesa_lectura", "mesa de lectura", "biblioteca", "sit", 35, 35);
place("decor", "table", 43, 32);
place("decor", "chair", 44, 35);
addSpot("mesa_lectura_2", "mesa del fondo", "biblioteca", "sit", 44, 35);
place("decor", "plant", 48, 34);

// Consultorio (suelo x 101..116, y 27..35)
const consultorio = { x: 100, y: 24, w: 18, h: 13 };
building(consultorio, 108, "wall_blue", "floor_shop");
addPlace("consultorio", "Consultorio médico", "other", consultorio, true);
place("decor", "desk", 104, 29);
addSpot("consulta", "mesa de la consulta", "consultorio", "sit", 104, 29);
place("decor", "bed", 112, 28);
addSpot("camilla", "camilla", "consultorio", "sit", 112, 28);
place("decor", "fridge_shelf", 109, 30);
addSpot("botiquin", "botiquín", "consultorio", "use", 109, 30);
place("decor", "chair", 102, 34);
addSpot("sala_espera", "sala de espera", "consultorio", "sit", 102, 34);
place("decor", "sofa", 113, 33);
place("decor", "plant", 116, 27);

// Café La Ola (suelo x 3..16, y 43..54)
const cafe = { x: 2, y: 40, w: 16, h: 16 };
building(cafe, 9, "wall_wood", "floor_cafe");
addPlace("cafe_ola", "Café La Ola", "cafe", cafe, true);
place("decor", "coffee_machine", 4, 46);
addSpot("cafetera", "cafetera", "cafe_ola", "use", 4, 46);
place("decor", "counter", 7, 47);
place("decor", "stool", 7, 47);
addSpot("barra", "barra", "cafe_ola", "sit", 7, 47);
place("decor", "stool", 8, 47);
addSpot("taburete", "taburete de la barra", "cafe_ola", "sit", 8, 47);
place("decor", "table", 12, 44);
place("decor", "chair", 13, 48);
addSpot("mesa_ventana", "mesa junto a la ventana", "cafe_ola", "sit", 13, 48);
place("decor", "table", 11, 50);
place("decor", "chair", 12, 54);
addSpot("mesa_fondo", "mesa del fondo", "cafe_ola", "sit", 12, 54);
place("decor", "sofa", 3, 51);
addSpot("sofa_cafe", "sofá", "cafe_ola", "sit", 4, 52);
place("decor", "plant", 16, 53);

// Panadería (suelo x 21..32, y 45..54)
const panaderia = { x: 20, y: 42, w: 14, h: 14 };
building(panaderia, 26, "wall_red", "floor_cafe");
addPlace("panaderia", "Panadería Miga", "shop", panaderia, true);
place("decor", "counter", 24, 49);
addSpot("mostrador_pan", "mostrador del pan", "panaderia", "use", 24, 49);
place("decor", "stove", 29, 47);
addSpot("horno", "horno", "panaderia", "use", 29, 47);
place("decor", "fridge_shelf", 22, 53);
addSpot("vitrina", "vitrina de dulces", "panaderia", "use", 22, 53);
place("decor", "table", 28, 50);
place("decor", "chair", 29, 54);
addSpot("mesita_pan", "mesita", "panaderia", "sit", 29, 54);

// Ultramarinos (suelo x 37..48, y 45..54)
const tienda = { x: 36, y: 42, w: 14, h: 14 };
building(tienda, 42, "wall_grey", "floor_shop");
addPlace("tienda", "Ultramarinos Lete", "shop", tienda, true);
place("decor", "fridge_shelf", 38, 48);
addSpot("estanteria", "estantería", "tienda", "use", 38, 48);
place("decor", "counter", 42, 49);
addSpot("mostrador", "mostrador", "tienda", "use", 42, 49);
place("decor", "fridge_shelf", 46, 48);
addSpot("nevera", "nevera", "tienda", "use", 46, 48);
place("decor", "plant", 37, 53);

// Taberna El Faro (suelo x 89..102, y 43..54)
const taberna = { x: 88, y: 40, w: 16, h: 16 };
building(taberna, 95, "wall_red", "floor_cafe");
addPlace("taberna", "Taberna El Faro", "cafe", taberna, true);
place("decor", "counter", 92, 46);
place("decor", "stool", 92, 46);
addSpot("barra_taberna", "barra de la taberna", "taberna", "sit", 92, 46);
place("decor", "stool", 93, 46);
addSpot("taburete_taberna", "taburete", "taberna", "sit", 93, 46);
place("decor", "stove", 99, 45);
addSpot("cocina_taberna", "cocina de la taberna", "taberna", "use", 99, 45);
place("decor", "table", 90, 49);
place("decor", "chair", 91, 53);
addSpot("mesa_taberna", "mesa grande", "taberna", "sit", 91, 53);
place("decor", "table", 97, 49);
place("decor", "chair", 98, 53);
addSpot("mesa_rincon", "mesa del rincón", "taberna", "sit", 98, 53);
place("decor", "plant", 102, 52);

// --- Plaza Mayor y mercadillo ---------------------------------------------------------------

const plaza = { x: 52, y: 40, w: 16, h: 16 };
pathRect(52, 40, 67, 55);
addPlace("plaza", "Plaza Mayor", "park", plaza, false);
place("decor", "fountain", 59, 47);
addSpot("fuente_plaza", "fuente de la plaza", "plaza", "stand", 59, 47);
place("decor", "bench", 54, 50);
addSpot("banco_plaza", "banco de la plaza", "plaza", "sit", 54, 50);
place("decor", "bench", 65, 50);
addSpot("banco_plaza_2", "banco junto al mercadillo", "plaza", "sit", 65, 50);
addSpot("escenario", "rincón del músico", "plaza", "stand", 59, 53);
for (const [x, y] of [
  [53, 42],
  [66, 42],
  [53, 55],
  [66, 55],
] as const) {
  place("decor", has("tree_planter") ? "tree_planter" : "bush", x, y);
}
lamp(56, 44);
lamp(63, 44);

const mercado = { x: 70, y: 40, w: 16, h: 16 };
pathRect(70, 45, 85, 47);
addPlace("mercado", "Mercadillo", "shop", mercado, false);
const carts = [
  ["puesto_fruta", "puesto de fruta", 73, "market_cart_1"],
  ["puesto_flores", "puesto de flores", 78, "market_cart_2"],
  ["puesto_quesos", "puesto de quesos", 83, "market_cart_3"],
] as const;
for (const [id, name, x, cart] of carts) {
  place("decor", has(cart) ? cart : "counter", x, 45);
  addSpot(id, name, "mercado", "use", x, 45);
}
place("decor", "bench", 77, 52);
addSpot("banco_mercado", "banco del mercadillo", "mercado", "sit", 77, 52);
for (const [x, y] of [
  [72, 52],
  [84, 52],
] as const) {
  place("decor", has("planter") ? "planter" : "bush", x, y);
}

// --- Parque del Olvido (x 2..31, y 59..78) ---------------------------------------------------

addPlace("parque", "Parque del Olvido", "park", { x: 2, y: 59, w: 30, h: 20 }, false);
pathRect(12, 58, 12, 77);
pathRect(3, 68, 30, 68);
place("decor", "bench", 8, 63);
addSpot("banco", "banco", "parque", "sit", 8, 63);
place("decor", "fountain", 16, 66);
addSpot("fuente", "fuente", "parque", "stand", 16, 66);
nineslice("ground", "water", 22, 71, 7, 5);
for (let y = 71; y < 76; y++) for (let x = 22; x < 29; x++) block(x, y);
place("decor", "slide", 5, 75);
addSpot("tobogan", "tobogán", "parque", "stand", 5, 75);
place("decor", "swings", 15, 73);
addSpot("columpios", "columpios", "parque", "sit", 15, 73);
place("decor", "sandbox", 7, 76);
place("decor", "trampoline", 21, 63);
place("decor", "swing_tree", 27, 67);
addSpot("arbol_columpio", "árbol del columpio", "parque", "stand", 27, 68);

// --- Lago Leteo (x 34..75, y 59..78) ----------------------------------------------------------

addPlace("lago", "Lago Leteo", "park", { x: 34, y: 59, w: 42, h: 20 }, false);
pathRect(55, 58, 55, 61);
pathRect(36, 61, 73, 61);
nineslice("ground", "water", 38, 63, 34, 13);
for (let y = 63; y < 76; y++) for (let x = 38; x < 72; x++) block(x, y);
addSpot("orilla", "orilla de pesca", "lago", "use", 46, 62);
addSpot("orilla_este", "orilla del este", "lago", "stand", 70, 62);
place("decor", "bench", 62, 60);
addSpot("mirador", "banco del mirador", "lago", "sit", 62, 60);

// --- Jardín del Recuerdo (x 78..93, y 59..78) -------------------------------------------------

addPlace("jardin_recuerdo", "Jardín del Recuerdo", "park", { x: 78, y: 59, w: 16, h: 20 }, false);
pathRect(85, 58, 85, 76);
pathRect(80, 72, 91, 72);
if (has("angel_statue")) {
  place("decor", "angel_statue", 85, 67);
} else {
  place("decor", "fountain", 85, 67);
}
addSpot("estatua_angel", "estatua del ángel", "jardin_recuerdo", "stand", 85, 67);
place("decor", "bench", 82, 74);
addSpot("banco_jardin", "banco del jardín", "jardin_recuerdo", "sit", 82, 74);
place("decor", "bench", 89, 74);
addSpot("banco_jardin_2", "banco de los cipreses", "jardin_recuerdo", "sit", 89, 74);
const FLOWERS = [
  "flowers_blue",
  "flowers_pink",
  "flowers_red",
  "flowers_yellow",
  "flowers_purple",
] as const;
[
  [79, 69],
  [81, 69],
  [88, 69],
  [90, 69],
  [79, 76],
  [91, 76],
].forEach(([x, y], i) => place("paths", FLOWERS[i % FLOWERS.length]!, x!, y!));

// --- Huerto comunitario (x 96..117, y 59..78) ---------------------------------------------------

addPlace("huerto", "Huerto comunitario", "other", { x: 96, y: 59, w: 22, h: 20 }, false);
pathRect(102, 58, 102, 76);
pathRect(97, 71, 112, 71);
const CROPS = ["crop_sprout", "crop_lettuce", "crop_leaf", "crop_corn"] as const;
const beds = [
  [98, 62],
  [103, 62],
  [108, 62],
  [98, 67],
  [103, 67],
  [108, 67],
] as const;
beds.forEach(([bx, by], i) => {
  place("paths", "garden_bed", bx, by);
  for (let j = 1; j < 3; j++) {
    for (let k = 0; k < 4; k++) place("decor", CROPS[(i + k) % CROPS.length]!, bx + k, by + j);
  }
});
addSpot("bancal_tomates", "bancal de tomates", "huerto", "use", 100, 65);
addSpot("bancal_lechugas", "bancal de lechugas", "huerto", "use", 105, 65);
addSpot("bancal_hierbas", "bancal de hierbas", "huerto", "use", 110, 70);
place("decor", "greenhouse", 115, 66);
addSpot("invernadero", "invernadero", "huerto", "use", 115, 66);
for (let x = 98; x <= 112; x += 2) place("decor", "sunflower", x, 75);

// --- Árboles, flores y farolas ----------------------------------------------------------------

// Pinar del norte
for (let x = 0; x < W; x += 3) place("decor", has("pine") ? "pine" : "tree", x, 2);
// Entre las filas de casas: árboles en el centro de cada parcela y flores a los lados.
const LOTS = [2, 12, 22, 32, 42, 70, 80, 90, 100, 110];
const TREES = ["tree", "tree_round", "tree_big"] as const;
LOTS.forEach((x, i) => {
  const t = TREES[i % TREES.length]!;
  place("decor", has(t) ? t : "tree", x + 4, 22);
  place("paths", FLOWERS[i % FLOWERS.length]!, x, 19);
  place("paths", FLOWERS[(i + 2) % FLOWERS.length]!, x + 6, 19);
});
// Setos y cipreses sueltos
for (const [x, y] of [
  [109, 40],
  [114, 40],
  [106, 53],
  [112, 50],
] as const) {
  place("decor", "bush", x, y);
}
for (const [x, y] of [
  [108, 47],
  [115, 47],
  [80, 62],
  [91, 62],
  [36, 70],
  [74, 70],
  [36, 76],
  [74, 76],
  [3, 61],
  [30, 61],
] as const) {
  place("decor", has("cypress") ? "cypress" : "tree", x, y);
}
for (const [x, y] of [
  [3, 78],
  [30, 78],
  [94, 78],
  [118, 78],
  [118, 63],
] as const) {
  place("decor", has("tree_big") ? "tree_big" : "tree", x, y);
}
// Farolas: calle Norte, calle Mayor y avenida del Lago
for (const x of [10, 20, 30, 40, 78, 88, 98, 108]) lamp(x, 18);
for (const x of [10, 20, 30, 78, 88, 98]) lamp(x, 39);
for (const x of [18, 34, 86, 110]) lamp(x, 58);

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
