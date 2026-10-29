/**
 * `pnpm portraits:compose`: compone el retrato animado de cada agente apilando las capas PNG del
 * Portrait Generator de LimeZu (piel → ojos → peinado → accesorios) según la receta `portrait`
 * de seeds/agents.json.
 *
 * Cada capa es una hoja de 10 columnas × 3 filas (talk, nod, shake); el resultado tiene la misma
 * forma y se escribe en assets/vendor/limezu/portraits/generated/ (ignorado por git: es arte de
 * LimeZu): <agente>.png con las piezas de 32x32 (frames de 64 px, para la UI) y <agente>-map.png
 * con las de 16x16 (frames de 32 px, junto a los bocadillos del mapa). También genera
 * preview.png con todos los agentes para revisarlos.
 *
 * La piel y el pelo se recolorean con los colores de `appearance` (los mismos del personaje del
 * mapa), conservando el sombreado: así el retrato y el sprite coinciden.
 *
 *   pnpm portraits:compose
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AgentSeed, paletteShift } from "@lethetown/shared";
import { PNG } from "pngjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORTRAITS = path.join(ROOT, "apps/web/public/assets/vendor/limezu/portraits");
const piecesDir = (size: string) => path.join(PORTRAITS, `Portrait_Generator - ${size}`);
/** Tamaños de pieza que se componen y sufijo del archivo resultante. */
const VARIANTS = [
  { size: "32x32", suffix: "" },
  { size: "16x16", suffix: "-map" },
];
const OUT = path.join(PORTRAITS, "generated");
const COLUMNS = 10;
const ROWS = 3;

const missing = VARIANTS.map((v) => piecesDir(v.size)).find((d) => !existsSync(d));
if (missing) {
  console.error(
    `No encuentro ${path.relative(ROOT, missing)}.\n` +
      "Extrae la carpeta «Portrait Pieces» del zip del Portrait Generator ahí (ver docs/personajes.md).",
  );
  process.exit(1);
}

const pad = (n: number) => String(n).padStart(2, "0");
const read = (size: string, file: string) => {
  const full = path.join(piecesDir(size), file);
  if (!existsSync(full)) throw new Error(`Falta la pieza ${file}`);
  return PNG.sync.read(readFileSync(full));
};

/** Mezcla `top` sobre `base` (alfa "over"), píxel a píxel. */
function over(base: PNG, top: PNG) {
  if (top.width !== base.width || top.height !== base.height) {
    throw new Error("Las capas del retrato no tienen el mismo tamaño");
  }
  for (let i = 0; i < base.data.length; i += 4) {
    const a = top.data[i + 3]! / 255;
    if (a === 0) continue;
    const b = base.data[i + 3]! / 255;
    const outA = a + b * (1 - a);
    for (let c = 0; c < 3; c++) {
      base.data[i + c] = Math.round(
        (top.data[i + c]! * a + base.data[i + c]! * b * (1 - a)) / outA,
      );
    }
    base.data[i + 3] = Math.round(outA * 255);
  }
}

const hex = (d: Buffer | Uint8Array, i: number) =>
  "#" + [0, 1, 2].map((c) => d[i + c]!.toString(16).padStart(2, "0")).join("");

/**
 * Lleva los colores de una capa al tono `target` (paletteShift), tomando como referencia el
 * color más frecuente y sin tocar el contorno (los colores muy oscuros).
 */
function tint(png: PNG, target: string) {
  const counts = new Map<string, number>();
  for (let i = 0; i < png.data.length; i += 4) {
    if (png.data[i + 3] === 0) continue;
    const c = hex(png.data, i);
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  const luma = (c: string) =>
    0.2126 * parseInt(c.slice(1, 3), 16) +
    0.7152 * parseInt(c.slice(3, 5), 16) +
    0.0722 * parseInt(c.slice(5, 7), 16);
  const colors = [...counts.entries()]
    .filter(([c]) => luma(c) > 55)
    .sort((a, b) => b[1] - a[1])
    .map(([c]) => c);
  if (!colors.length) return;
  const table = paletteShift(colors, target);
  for (let i = 0; i < png.data.length; i += 4) {
    if (png.data[i + 3] === 0) continue;
    const to = table.get(hex(png.data, i));
    if (to) png.data.set(to, i);
  }
}

const seeds = AgentSeed.array().parse(
  JSON.parse(readFileSync(path.join(ROOT, "seeds/agents.json"), "utf8")),
);
mkdirSync(OUT, { recursive: true });

const sheets: { id: string; png: PNG }[] = [];
for (const seed of seeds) {
  const r = seed.portrait;
  if (!r) {
    console.log(`- ${seed.id}: sin receta de retrato, se omite`);
    continue;
  }
  for (const { size, suffix } of VARIANTS) {
    const png = read(size, `Skins/Skin ${r.skin}.png`);
    tint(png, seed.appearance.skin);
    over(png, read(size, `Eyes/Eyes ${pad(r.eyes)}.png`));
    const hair = read(size, `Hairstyles/Hairstyle ${pad(r.hair.style)} ${r.hair.color}.png`);
    tint(hair, seed.appearance.hair);
    over(png, hair);
    for (const acc of r.accessories) over(png, read(size, `Accessories/${acc}.png`));
    const file = path.join(OUT, `${seed.id}${suffix}.png`);
    writeFileSync(file, PNG.sync.write(png));
    if (!suffix) sheets.push({ id: seed.id, png });
    console.log(`✓ ${seed.id}: ${path.relative(ROOT, file)}`);
  }
}

// Previsualización: una fila por agente con el primer y el quinto frame de cada animación, ×3.
if (sheets.length > 0) {
  const frame = sheets[0]!.png.width / COLUMNS;
  const SCALE = 3;
  const picks = [0, 4];
  const cols = ROWS * picks.length;
  const preview = new PNG({
    width: cols * frame * SCALE,
    height: sheets.length * frame * SCALE,
  });
  preview.data.fill(200);
  sheets.forEach(({ png }, agentRow) => {
    for (let row = 0; row < ROWS; row++) {
      picks.forEach((col, k) => {
        const dx0 = (row * picks.length + k) * frame * SCALE;
        const dy0 = agentRow * frame * SCALE;
        for (let y = 0; y < frame * SCALE; y++) {
          for (let x = 0; x < frame * SCALE; x++) {
            const sx = col * frame + Math.floor(x / SCALE);
            const sy = row * frame + Math.floor(y / SCALE);
            const si = (sy * png.width + sx) * 4;
            const di = ((dy0 + y) * preview.width + dx0 + x) * 4;
            const a = png.data[si + 3]! / 255;
            for (let c = 0; c < 3; c++) {
              preview.data[di + c] = Math.round(png.data[si + c]! * a + 200 * (1 - a));
            }
            preview.data[di + 3] = 255;
          }
        }
      });
    }
  });
  writeFileSync(path.join(OUT, "preview.png"), PNG.sync.write(preview));
  console.log(`Previsualización: ${path.relative(ROOT, path.join(OUT, "preview.png"))}`);
}
