import type { Emote } from "@lethetown/shared";
import type Phaser from "phaser";

/**
 * Pixel art propio dibujado por código (no depende de ningún pack): emotes de 9×9, bocadillo
 * nine-slice, destello y halos de luz. Cada carácter de la rejilla es un píxel de la paleta.
 */
const PALETTE: Record<string, string> = {
  k: "#1d1d2b",
  w: "#ffffff",
  g: "#9aa0b0",
  r: "#e0414f",
  p: "#f59ab5",
  y: "#ffd34d",
  o: "#f08a3c",
  b: "#4d8de0",
  c: "#8fd6ff",
  n: "#8a5a3c",
  l: "#c9cfdd",
};

const EMOTE_ART: Record<Emote, string[]> = {
  dots: [
    ".........",
    ".........",
    ".........",
    ".........",
    "kk.kk.kk.",
    "ww.ww.ww.",
    ".........",
    ".........",
    ".........",
  ],
  zzz: [
    "....kkkk.",
    "....kwwk.",
    ".....kk..",
    "....kwwk.",
    "kkk.kkkk.",
    "kwk......",
    ".k.......",
    "kwk......",
    "kkk......",
  ],
  heart: [
    ".........",
    ".kk...kk.",
    "krrk.krrk",
    "krprkrrrk",
    "krrrrrrrk",
    ".krrrrrk.",
    "..krrrk..",
    "...krk...",
    "....k....",
  ],
  anger: [
    "..k...k..",
    ".krk.krk.",
    "..krkrk..",
    "kk.krk.kk",
    "krrk.krrk",
    "kk.krk.kk",
    "..krkrk..",
    ".krk.krk.",
    "..k...k..",
  ],
  cup: [
    "...k.k...",
    "..k.k....",
    ".........",
    "kkkkkkk..",
    "kwwwwwkkk",
    "kwnnnwk.k",
    "kwwwwwkkk",
    ".kwwwk...",
    "..kkk....",
  ],
  flame: [
    "....k....",
    "...kok...",
    "...kok...",
    "..koyok..",
    ".koyyyok.",
    ".koywyok.",
    ".koyyyok.",
    "..koook..",
    "...kkk...",
  ],
  book: [
    ".........",
    "kkkk.kkkk",
    "kbbbkbbbk",
    "kbwwkwwbk",
    "kbwwkwwbk",
    "kbwwkwwbk",
    "kbbbkbbbk",
    "kkkkkkkkk",
    ".........",
  ],
  gear: [
    "...kkk...",
    ".kkgggkk.",
    ".kgglggk.",
    "kgglklggk",
    "kglkkklgk",
    "kgglklggk",
    ".kgglggk.",
    ".kkgggkk.",
    "...kkk...",
  ],
  idea: [
    "...kkk...",
    "..kyyyk..",
    ".kyywyyk.",
    ".kyyyyyk.",
    ".kyyyyyk.",
    "..kyyyk..",
    "...kgk...",
    "...kgk...",
    "...kkk...",
  ],
  question: [
    "..kkkkk..",
    ".kwwwwwk.",
    ".kwkkkwk.",
    "..k..kwk.",
    "....kwk..",
    "...kwk...",
    "...kkk...",
    "...kwk...",
    "...kkk...",
  ],
  cloud: [
    ".........",
    "...kkk...",
    "..klllk..",
    ".kklllkk.",
    "klllllllk",
    "klkklkklk",
    "klllllllk",
    ".kkkkkkk.",
    ".........",
  ],
  exclaim: [
    "...kkk...",
    "...kyk...",
    "...kyk...",
    "...kyk...",
    "...kyk...",
    "...kkk...",
    "...kyk...",
    "...kkk...",
    ".........",
  ],
  sparkle: [
    "....y....",
    "....y....",
    "...ywy...",
    "yyywwwyyy",
    "...ywy...",
    "....y....",
    "....y....",
    ".........",
    ".........",
  ],
};

/** Bocadillo 9×9 (esquinas de 3 px): blanco con borde oscuro. */
const BUBBLE = [
  ".kkkkkkk.",
  "kwwwwwwwk",
  "kwwwwwwwk",
  "kwwwwwwwk",
  "kwwwwwwwk",
  "kwwwwwwwk",
  "kwwwwwwwk",
  "kwwwwwwwk",
  ".kkkkkkk.",
];
const BUBBLE_TAIL = ["kwwwk", ".kwk.", "..k.."];
/** Tamaño de las esquinas del nine-slice del bocadillo. */
export const BUBBLE_CORNER = 3;

function drawGrid(scene: Phaser.Scene, key: string, rows: string[]) {
  if (scene.textures.exists(key)) return;
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const tex = scene.textures.createCanvas(key, w, h);
  if (!tex) return;
  const ctx = tex.getContext();
  rows.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      const color = PALETTE[ch];
      if (!color) return;
      ctx.fillStyle = color;
      ctx.fillRect(x, y, 1, 1);
    }),
  );
  tex.refresh();
}

/** Halo radial para luces nocturnas (ventanas, farolas). */
function drawGlow(scene: Phaser.Scene, key: string, radius: number, color: string) {
  if (scene.textures.exists(key)) return;
  const size = radius * 2;
  const tex = scene.textures.createCanvas(key, size, size);
  if (!tex) return;
  const ctx = tex.getContext();
  const g = ctx.createRadialGradient(radius, radius, 0, radius, radius, radius);
  g.addColorStop(0, color);
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  tex.refresh();
}

export const emoteKey = (e: Emote) => `emote:${e}`;

export function createPixelTextures(scene: Phaser.Scene): void {
  for (const [name, art] of Object.entries(EMOTE_ART))
    drawGrid(scene, emoteKey(name as Emote), art);
  // "Pensando": tres fotogramas con 1, 2 y 3 puntos.
  for (let n = 1; n <= 3; n++) {
    drawGrid(
      scene,
      `${emoteKey("dots")}${n}`,
      EMOTE_ART.dots.map((row, y) =>
        y === 4 || y === 5 ? row.slice(0, n * 3).padEnd(9, ".") : row,
      ),
    );
  }
  drawGrid(scene, "bubble", BUBBLE);
  drawGrid(scene, "bubble-tail", BUBBLE_TAIL);
  drawGrid(scene, "pixel", ["w"]);
  drawGlow(scene, "glow-lamp", 28, "rgba(255,214,140,0.85)");
  drawGlow(scene, "glow-window", 14, "rgba(255,200,110,0.9)");
}
