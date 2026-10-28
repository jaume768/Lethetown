/**
 * Genera por código el set de pixel art placeholder (propio, se commitea) en
 * apps/web/public/assets/placeholder/:
 *   - tileset.png  (8×8 baldosas de 16 px: terreno, muros, suelos, muebles, tejado, fachada...)
 *   - character.png (16×16 por frame; 4 filas = abajo/izquierda/derecha/arriba;
 *     columnas = idle, walk ×4, sit, sleep). Pintado con colores "marcador" que el cliente
 *     recolorea con el `appearance` de cada agente.
 * Uso: pnpm assets:placeholder
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "apps/web/public/assets/placeholder");
const T = 16;

/** Colores marcador que el cliente sustituye (ver PLACEHOLDER_MARKERS en el manifest). */
export const MARKERS = { skin: "#ff00ff", hair: "#ff0000", shirt: "#00ff00", pants: "#0000ff" };

type RGBA = [number, number, number, number];
const hex = (h: string, a = 255): RGBA => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16),
  a,
];

class Canvas {
  readonly png: PNG;
  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.png = new PNG({ width: w, height: h });
    this.png.data.fill(0);
  }
  px(x: number, y: number, c: RGBA) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    this.png.data[i] = c[0];
    this.png.data[i + 1] = c[1];
    this.png.data[i + 2] = c[2];
    this.png.data[i + 3] = c[3];
  }
  rect(x: number, y: number, w: number, h: number, c: RGBA) {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.px(i, j, c);
  }
  frame(x: number, y: number, w: number, h: number, c: RGBA) {
    this.rect(x, y, w, 1, c);
    this.rect(x, y + h - 1, w, 1, c);
    this.rect(x, y, 1, h, c);
    this.rect(x + w - 1, y, 1, h, c);
  }
  /** Ruido determinista sobre una baldosa (para texturas de césped, suelos...). */
  speckle(tx: number, ty: number, c: RGBA, seed: number, density = 0.12) {
    let s = seed;
    for (let y = 0; y < T; y++) {
      for (let x = 0; x < T; x++) {
        s = (s * 1103515245 + 12345) & 0x7fffffff;
        if ((s % 1000) / 1000 < density) this.px(tx * T + x, ty * T + y, c);
      }
    }
  }
  save(file: string) {
    writeFileSync(file, PNG.sync.write(this.png));
  }
}

const K = hex("#1d1d2b");

// --- Tileset ---------------------------------------------------------------------------------

function tileset(): Canvas {
  const c = new Canvas(8 * T, 8 * T);
  const at = (tx: number, ty: number) => [tx * T, ty * T] as const;
  const fillTile = (tx: number, ty: number, col: string) => c.rect(tx * T, ty * T, T, T, hex(col));

  // Fila 0: césped, camino, techo, paredes (parte alta) y colisión.
  fillTile(0, 0, "#5fa04e");
  c.speckle(0, 0, hex("#4c8a3f"), 7);
  c.speckle(0, 0, hex("#7cc063"), 11, 0.05);
  fillTile(1, 0, "#a8a29a");
  for (const [x, y] of [
    [1, 1],
    [9, 2],
    [4, 8],
    [12, 9],
    [2, 13],
    [10, 14],
  ]) {
    c.rect(T + x!, y!, 4, 3, hex("#8d877f"));
  }
  fillTile(2, 0, "#2d3142");
  const walls = ["#7aa5d6", "#d68a7a", "#a87a52", "#9aa0b0"];
  walls.forEach((col, i) => {
    const [x, y] = at(3 + i, 0);
    c.rect(x, y, T, T, hex(col));
    c.rect(x, y, T, 2, hex("#f2ecdc"));
    // parte baja (fila 1): zócalo más oscuro
    c.rect(x, y + T, T, T, hex(col));
    c.rect(x, y + 2 * T - 3, T, 3, hex("#3b3b4b"));
  });
  fillTile(7, 0, "#ff00ff");

  // Fila 1: suelos y arbusto.
  const floors: [string, string][] = [
    ["#b98457", "#9a6a42"],
    ["#b0504a", "#8e3c38"],
    ["#e8dca0", "#c8bc82"],
  ];
  floors.forEach(([col, line], i) => {
    fillTile(i, 1, col);
    const [x, y] = at(i, 1);
    for (let k = 0; k < T; k += 4) c.rect(x, y + k, T, 1, hex(line));
  });
  {
    const [x, y] = at(7, 1);
    c.rect(x + 2, y + 4, 12, 10, hex("#3f8a3a"));
    c.rect(x + 4, y + 2, 8, 2, hex("#3f8a3a"));
    c.frame(x + 2, y + 4, 12, 10, K);
  }

  // Agua 3×3 (cols 0-2, filas 2-4): bordes de arena, centro azul.
  for (let j = 0; j < 3; j++) {
    for (let i = 0; i < 3; i++) {
      const [x, y] = at(i, 2 + j);
      c.rect(x, y, T, T, hex("#3a7ac0"));
      c.speckle(i, 2 + j, hex("#6aa8e0"), 3 + i + j * 3, 0.06);
      if (j === 0) c.rect(x, y, T, 3, hex("#d8c890"));
      if (j === 2) c.rect(x, y + T - 3, T, 3, hex("#d8c890"));
      if (i === 0) c.rect(x, y, 3, T, hex("#d8c890"));
      if (i === 2) c.rect(x + T - 3, y, 3, T, hex("#d8c890"));
    }
  }
  // Tejado 3×3 (cols 3-5, filas 2-4): azotea con reborde.
  for (let j = 0; j < 3; j++) {
    for (let i = 0; i < 3; i++) {
      const [x, y] = at(3 + i, 2 + j);
      c.rect(x, y, T, T, hex("#6b5a5a"));
      if (j === 0) c.rect(x, y, T, 3, hex("#c9a87a"));
      if (j === 2) c.rect(x, y + T - 3, T, 3, hex("#c9a87a"));
      if (i === 0) c.rect(x, y, 3, T, hex("#c9a87a"));
      if (i === 2) c.rect(x + T - 3, y, 3, T, hex("#c9a87a"));
    }
  }
  // Árbol 1×2 (col 6, filas 2-3) y farola 1×2 (col 7, filas 2-3).
  {
    const [x, y] = at(6, 2);
    c.rect(x + 1, y + 2, 14, 13, hex("#3f8a3a"));
    c.rect(x + 3, y, 10, 2, hex("#3f8a3a"));
    c.speckle(6, 2, hex("#5fb04e"), 21, 0.2);
    c.rect(x + 6, y + T, 4, 12, hex("#7a5034"));
    c.frame(x + 1, y + 2, 14, 13, K);
  }
  {
    const [x, y] = at(7, 2);
    c.rect(x + 5, y + 2, 6, 5, hex("#ffe9a0"));
    c.frame(x + 5, y + 2, 6, 5, K);
    c.rect(x + 7, y + 7, 2, T + 8, hex("#3b3b4b"));
    c.rect(x + 5, y + T + 13, 6, 3, hex("#3b3b4b"));
  }

  // Fachada 5×1 (cols 3-7, fila 5): borde, ventana, puerta, pared, borde.
  {
    const base = hex("#8a6a52");
    for (let i = 0; i < 5; i++) {
      const [x, y] = at(3 + i, 5);
      c.rect(x, y, T, T, base);
      c.rect(x, y + T - 2, T, 2, hex("#4a3a30"));
    }
    const [wx, wy] = at(4, 5);
    c.rect(wx + 3, wy + 3, 10, 8, hex("#a8d8f0"));
    c.frame(wx + 3, wy + 3, 10, 8, K);
    const [dx, dy] = at(5, 5);
    c.rect(dx + 4, dy + 2, 8, 14, hex("#c07a3a"));
    c.frame(dx + 4, dy + 2, 8, 14, K);
    c.px(dx + 10, dy + 9, hex("#ffd34d"));
    for (const i of [3, 7]) {
      const [x, y] = at(i, 5);
      c.rect(x, y, 2, T, hex("#5a4434"));
    }
  }

  // Filas 6-7: muebles (1×1).
  const furniture: [number, number, (x: number, y: number) => void][] = [
    [
      0,
      6,
      (x, y) => {
        c.rect(x + 2, y + 1, 12, 14, hex("#f2ecdc"));
        c.rect(x + 2, y + 1, 12, 4, hex("#ffffff"));
        c.rect(x + 2, y + 6, 12, 9, hex("#7aa5d6"));
        c.frame(x + 2, y + 1, 12, 14, K);
      },
    ],
    [
      1,
      6,
      (x, y) => {
        c.rect(x + 1, y + 3, 14, 8, hex("#a87a52"));
        c.rect(x + 3, y + 4, 6, 4, hex("#ffffff"));
        c.frame(x + 1, y + 3, 14, 8, K);
      },
    ],
    [
      2,
      6,
      (x, y) => {
        c.rect(x + 4, y + 2, 8, 6, hex("#a87a52"));
        c.rect(x + 4, y + 8, 8, 4, hex("#c69a6a"));
        c.frame(x + 4, y + 2, 8, 10, K);
      },
    ],
    [
      3,
      6,
      (x, y) => {
        c.rect(x + 4, y + 5, 8, 6, hex("#c69a6a"));
        c.frame(x + 4, y + 5, 8, 6, K);
      },
    ],
    [
      4,
      6,
      (x, y) => {
        c.rect(x + 1, y + 2, 14, 10, hex("#c69a6a"));
        c.frame(x + 1, y + 2, 14, 10, K);
      },
    ],
    [
      5,
      6,
      (x, y) => {
        c.rect(x, y + 2, T, 10, hex("#e0e4ec"));
        c.rect(x, y + 2, T, 3, hex("#a87a52"));
        c.frame(x, y + 2, T, 10, K);
      },
    ],
    [
      6,
      6,
      (x, y) => {
        c.rect(x + 1, y + 2, 14, 11, hex("#5a5f70"));
        c.rect(x + 3, y + 4, 4, 3, hex("#e0414f"));
        c.rect(x + 9, y + 4, 4, 3, hex("#e0414f"));
        c.frame(x + 1, y + 2, 14, 11, K);
      },
    ],
    [
      7,
      6,
      (x, y) => {
        c.rect(x + 1, y + 1, 14, 14, hex("#e0e4ec"));
        for (const k of [3, 7, 11])
          c.rect(x + 2, y + k, 12, 2, hex(k === 7 ? "#e0414f" : "#7bc47f"));
        c.frame(x + 1, y + 1, 14, 14, K);
      },
    ],
    [
      0,
      7,
      (x, y) => {
        c.rect(x + 1, y + 1, 14, 14, hex("#7a5034"));
        for (const k of [3, 8]) {
          c.rect(x + 2, y + k, 3, 4, hex("#e0414f"));
          c.rect(x + 6, y + k, 3, 4, hex("#4d8de0"));
          c.rect(x + 10, y + k, 3, 4, hex("#ffd34d"));
        }
        c.frame(x + 1, y + 1, 14, 14, K);
      },
    ],
    [
      1,
      7,
      (x, y) => {
        c.rect(x, y, T, T, hex("#b04a4a"));
        c.frame(x + 2, y + 2, 12, 12, hex("#e8c070"));
      },
    ],
    [
      2,
      7,
      (x, y) => {
        c.rect(x + 5, y + 10, 6, 5, hex("#c07a3a"));
        c.rect(x + 3, y + 2, 10, 8, hex("#3f8a3a"));
        c.frame(x + 3, y + 2, 10, 8, K);
      },
    ],
    [
      3,
      7,
      (x, y) => {
        c.rect(x, y + 3, T, 10, hex("#b04a4a"));
        c.rect(x, y + 3, T, 4, hex("#d06a6a"));
        c.frame(x, y + 3, T, 10, K);
      },
    ],
    [
      4,
      7,
      (x, y) => {
        c.rect(x + 4, y + 2, 8, 12, hex("#5a5f70"));
        c.rect(x + 6, y + 9, 4, 3, hex("#f2ecdc"));
        c.frame(x + 4, y + 2, 8, 12, K);
      },
    ],
    [
      5,
      7,
      (x, y) => {
        c.rect(x, y + 5, T, 4, hex("#c69a6a"));
        c.rect(x, y + 10, T, 3, hex("#a87a52"));
        c.rect(x + 1, y + 13, 2, 3, K);
        c.rect(x + 13, y + 13, 2, 3, K);
      },
    ],
    [
      6,
      7,
      (x, y) => {
        c.rect(x + 1, y + 3, 14, 12, hex("#c9cfdd"));
        c.rect(x + 4, y + 6, 8, 6, hex("#6aa8e0"));
        c.rect(x + 7, y, 2, 6, hex("#c9cfdd"));
        c.frame(x + 1, y + 3, 14, 12, K);
      },
    ],
  ];
  for (const [tx, ty, draw] of furniture) draw(tx * T, ty * T);
  return c;
}

// --- Personaje -------------------------------------------------------------------------------

const DIRS = ["down", "left", "right", "up"] as const;
const COLS = 7; // idle, walk×4, sit, sleep

function character(): Canvas {
  const c = new Canvas(COLS * T, DIRS.length * T);
  const skin = hex(MARKERS.skin);
  const hair = hex(MARKERS.hair);
  const shirt = hex(MARKERS.shirt);
  const pants = hex(MARKERS.pants);
  DIRS.forEach((dir, row) => {
    for (let col = 0; col < COLS; col++) {
      const ox = col * T;
      const oy = row * T;
      if (col === 6) {
        // Dormir: tumbado de lado, con los ojos cerrados.
        c.rect(ox + 2, oy + 8, 5, 5, skin);
        c.rect(ox + 2, oy + 7, 5, 2, hair);
        c.rect(ox + 7, oy + 8, 5, 5, shirt);
        c.rect(ox + 12, oy + 9, 3, 3, pants);
        c.rect(ox + 3, oy + 10, 2, 1, K);
        continue;
      }
      const sitting = col === 5;
      const step = col >= 1 && col <= 4 ? [0, 1, 0, -1][col - 1]! : 0;
      const bob = col >= 1 && col <= 4 && (col === 2 || col === 4) ? 1 : 0;
      const y0 = oy + bob + (sitting ? 2 : 0);
      // Cabeza y pelo
      c.rect(ox + 4, y0 + 1, 8, 7, skin);
      c.rect(ox + 4, y0, 8, 3, hair);
      if (dir === "up") c.rect(ox + 4, y0, 8, 7, hair);
      if (dir === "left") c.rect(ox + 9, y0, 3, 6, hair);
      if (dir === "right") c.rect(ox + 4, y0, 3, 6, hair);
      if (dir === "down") {
        c.px(ox + 6, y0 + 5, K);
        c.px(ox + 9, y0 + 5, K);
      }
      if (dir === "left") c.px(ox + 5, y0 + 5, K);
      if (dir === "right") c.px(ox + 10, y0 + 5, K);
      // Cuerpo
      c.rect(ox + 4, y0 + 8, 8, 4, shirt);
      c.rect(ox + 3, y0 + 8, 1, 3, skin);
      c.rect(ox + 12, y0 + 8, 1, 3, skin);
      // Piernas
      if (sitting) {
        const dx = dir === "left" ? -2 : 2;
        c.rect(ox + 5 + dx, y0 + 12, 6, 2, pants);
      } else {
        c.rect(ox + 5, y0 + 12, 2, 3 + Math.max(0, step), pants);
        c.rect(ox + 9, y0 + 12, 2, 3 + Math.max(0, -step), pants);
      }
      // Contorno mínimo (cabeza)
      c.rect(ox + 3, y0, 1, 7, K);
      c.rect(ox + 12, y0, 1, 7, K);
    }
  });
  return c;
}

mkdirSync(OUT, { recursive: true });
tileset().save(path.join(OUT, "tileset.png"));
character().save(path.join(OUT, "character.png"));
console.log(
  `Placeholder generado en ${path.relative(ROOT, OUT)}: tileset.png (8×8 baldosas), character.png (7×4 frames).`,
);
