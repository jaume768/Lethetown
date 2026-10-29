import type { Appearance } from "../schemas/agent";

const rgb = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

/**
 * Sustituye en un buffer RGBA los colores marcador por los del aspecto del agente.
 * Pura (sin canvas) para poder testearla; el cliente la aplica sobre getImageData().
 */
export function recolorPixels(
  data: Uint8ClampedArray | Uint8Array,
  markers: Record<"skin" | "hair" | "shirt" | "pants", string>,
  appearance: Pick<Appearance, "skin" | "hair" | "shirt" | "pants">,
): number {
  const table = (["skin", "hair", "shirt", "pants"] as const).map(
    (k) => [rgb(markers[k]), rgb(appearance[k])] as const,
  );
  let changed = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    for (const [from, to] of table) {
      if (data[i] === from[0] && data[i + 1] === from[1] && data[i + 2] === from[2]) {
        data[i] = to[0];
        data[i + 1] = to[1];
        data[i + 2] = to[2];
        changed++;
        break;
      }
    }
  }
  return changed;
}

/** Grupo de colores de una hoja que representa una parte del personaje (pelo, camisa...). */
export interface PaletteGroup {
  /** Colores de la hoja (#rrggbb); el primero es la referencia del tono base. */
  colors: string[];
  /** Solo píxeles con esta y (dentro del frame) o más; sirve cuando dos partes comparten color. */
  minY?: number;
  /** Solo píxeles con esta y (dentro del frame) o menos. */
  maxY?: number;
}

export type PalettePart = "skin" | "hair" | "shirt" | "pants";

type Hsl = [number, number, number];

function toHsl([r, g, b]: [number, number, number]): Hsl {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h =
    max === rn
      ? (gn - bn) / d + (gn < bn ? 6 : 0)
      : max === gn
        ? (bn - rn) / d + 2
        : (rn - gn) / d + 4;
  return [h / 6, s, l];
}

function fromHsl([h, s, l]: Hsl): [number, number, number] {
  if (s === 0) return [l, l, l].map((v) => Math.round(v * 255)) as [number, number, number];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t: number) => {
    const u = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
    if (u < 1 / 6) return p + (q - p) * 6 * u;
    if (u < 1 / 2) return q;
    if (u < 2 / 3) return p + (q - p) * (2 / 3 - u) * 6;
    return p;
  };
  return [channel(h + 1 / 3), channel(h), channel(h - 1 / 3)].map((v) => Math.round(v * 255)) as [
    number,
    number,
    number,
  ];
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * Tabla de sustitución de un grupo: cada color pasa al tono y la saturación del color destino
 * y conserva su luminosidad relativa respecto a la referencia (así se mantiene el sombreado).
 */
export function paletteShift(
  colors: string[],
  target: string,
): Map<string, [number, number, number]> {
  const ref = toHsl(rgb(colors[0]!));
  const to = toHsl(rgb(target));
  const out = new Map<string, [number, number, number]>();
  for (const c of colors) {
    const [, s, l] = toHsl(rgb(c));
    const sat = ref[1] > 0 ? clamp01(to[1] * (s / ref[1])) : to[1];
    out.set(c.toLowerCase(), fromHsl([to[0], sat, clamp01(to[2] + (l - ref[2]))]));
  }
  return out;
}

/**
 * Recolorea una hoja de personaje con sombreado (p. ej. las de LimeZu): cada parte de
 * `palette` se desplaza al color del `appearance`. `width` es el ancho de la imagen y
 * `frameHeight` el alto de un frame (para los límites minY/maxY). Pura, para poder testearla.
 */
export function recolorPalette(
  data: Uint8ClampedArray | Uint8Array,
  width: number,
  frameHeight: number,
  palette: Partial<Record<PalettePart, PaletteGroup>>,
  appearance: Pick<Appearance, PalettePart>,
): number {
  const groups = (Object.entries(palette) as [PalettePart, PaletteGroup][]).map(([part, g]) => ({
    ...g,
    table: paletteShift(g.colors, appearance[part]),
  }));
  const hex = (i: number) =>
    "#" + [0, 1, 2].map((c) => data[i + c]!.toString(16).padStart(2, "0")).join("");
  let changed = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const y = Math.floor(i / 4 / width) % frameHeight;
    const color = hex(i);
    for (const g of groups) {
      if ((g.minY !== undefined && y < g.minY) || (g.maxY !== undefined && y > g.maxY)) continue;
      const to = g.table.get(color);
      if (!to) continue;
      data[i] = to[0];
      data[i + 1] = to[1];
      data[i + 2] = to[2];
      changed++;
      break;
    }
  }
  return changed;
}
