/**
 * Modo cine (repetición): formatos de vídeo de redes, sus zonas seguras y el dibujo de los
 * subtítulos y la marca sobre el lienzo del clip (lo mismo que se ve en pantalla, en el vídeo).
 */
export type ClipFormat = "9:16" | "4:5" | "16:9";
export const CLIP_FORMATS: readonly ClipFormat[] = ["9:16", "4:5", "16:9"];

/** Tamaño de salida de cada formato (píxeles del vídeo). */
export const FORMAT_SIZE: Record<ClipFormat, { w: number; h: number }> = {
  "9:16": { w: 1080, h: 1920 },
  "4:5": { w: 1080, h: 1350 },
  "16:9": { w: 1920, h: 1080 },
};

/**
 * Zona segura (fracción del marco que tapan los botones de la red): en 9:16 (TikTok, Reels)
 * arriba el menú, abajo la descripción y a la derecha los botones; en 4:5 y 16:9, un margen.
 */
export const SAFE_ZONE: Record<
  ClipFormat,
  { top: number; bottom: number; left: number; right: number }
> = {
  "9:16": { top: 0.13, bottom: 0.22, left: 0.06, right: 0.16 },
  "4:5": { top: 0.06, bottom: 0.08, left: 0.06, right: 0.06 },
  "16:9": { top: 0.06, bottom: 0.08, left: 0.05, right: 0.05 },
};

type Safe = { top: number; bottom: number; left: number; right: number };

/** Pantalla partida: arriba y abajo en 9:16; una al lado de la otra en los demás. */
export function splitStacked(format: ClipFormat): boolean {
  return format === "9:16";
}

/** Tamaño de los subtítulos en una mitad respecto al marco entero. */
export const SPLIT_SCALE = 0.75;

/** Margen (fracción) en el lado de una mitad que da a la otra. */
const SPLIT_GAP = 0.03;

/**
 * Zona segura de una mitad de la pantalla partida (en fracciones de la mitad): la del marco
 * entero en los lados que tocan el borde y un margen pequeño en el que da a la otra mitad.
 */
export function halfSafe(format: ClipFormat, half: 0 | 1): Safe {
  const s = SAFE_ZONE[format];
  if (splitStacked(format)) {
    return half === 0
      ? { top: s.top * 2, bottom: SPLIT_GAP, left: s.left, right: s.right }
      : { top: SPLIT_GAP, bottom: s.bottom * 2, left: s.left, right: s.right };
  }
  return half === 0
    ? { top: s.top, bottom: s.bottom, left: s.left * 2, right: SPLIT_GAP }
    : { top: s.top, bottom: s.bottom, left: SPLIT_GAP, right: s.right * 2 };
}

/** Lo que ocupan abajo los subtítulos (fracción del alto) encima de la zona segura. */
const SUBTITLE_SPACE = 0.2;

/**
 * Cuánto quedan los encuadrados por encima del centro (fracción del alto) para caer en medio de
 * lo que se ve: entre la zona segura de arriba y los subtítulos de abajo.
 */
export function directorOffsetFor(safe: Safe): number {
  const middle = (safe.top + (1 - safe.bottom - SUBTITLE_SPACE)) / 2;
  return Math.min(0.3, Math.max(-0.1, 0.5 - middle));
}

/** Rectángulo de cada mitad dentro de un marco de w×h. */
export function halfRects(
  format: ClipFormat,
  w: number,
  h: number,
): [
  { x: number; y: number; w: number; h: number },
  { x: number; y: number; w: number; h: number },
] {
  if (splitStacked(format)) {
    const hh = Math.round(h / 2);
    return [
      { x: 0, y: 0, w, h: hh },
      { x: 0, y: hh, w, h: h - hh },
    ];
  }
  const hw = Math.round(w / 2);
  return [
    { x: 0, y: 0, w: hw, h },
    { x: hw, y: 0, w: w - hw, h },
  ];
}

export interface SubtitleLine {
  id: string;
  name: string;
  /** Color del nombre (el de su ropa en el mapa). */
  color: string;
  text: string;
}

export interface CineOverlay {
  format: ClipFormat;
  lines: SubtitleLine[];
  /** Marca: [«Repetición de una partida real · modelo · fecha», «lethetown.com»], o null. */
  watermark: [string, string] | null;
  /** Contador de días («Día 3») y su opacidad (0–1), o nada. */
  day?: { label: string; alpha: number } | null;
  /** Etiqueta de la mitad (pantalla partida: «Semilla 7»), o nada. */
  label?: string | null;
  /** Otra zona segura (la de una mitad de la pantalla partida). */
  safe?: Safe;
  /** Ancho máximo de la marca (fracción del marco; en pantalla partida, menos). */
  markWidth?: number;
  /** Tamaño de los subtítulos respecto al normal (en una mitad, algo menos). */
  scale?: number;
}

/** Cuánto (ms reales) se ve el contador de días, y cuánto tarda en apagarse al final. */
export const DAY_CARD_MS = 2600;
const DAY_FADE_MS = 600;

/** Opacidad del contador de días: entero hasta el final, y se apaga en `DAY_FADE_MS`. */
export function dayAlpha(until: number, now: number): number {
  const left = until - now;
  return left <= 0 ? 0 : Math.min(1, left / DAY_FADE_MS);
}

/** Tamaño de letra del contador de días (px) para un marco de `h` de alto. */
export function daySize(format: ClipFormat, h: number): number {
  return Math.round(subtitleSize(format, h) * 2.4);
}

/** Tamaño de letra de los subtítulos (px) para un marco de `h` de alto. */
export function subtitleSize(format: ClipFormat, h: number): number {
  return Math.round(h * (format === "16:9" ? 0.045 : format === "4:5" ? 0.036 : 0.03));
}

/** Parte un texto en líneas de como mucho `maxWidth` (medido con el contexto). */
function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > maxWidth) {
      out.push(line);
      line = word;
    } else line = next;
  }
  if (line) out.push(line);
  return out;
}

/** Subtítulos (nombre en color + frase, con fondo) y marca, dentro de la zona segura. */
export function drawCineOverlay(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  o: CineOverlay,
) {
  const safe = o.safe ?? SAFE_ZONE[o.format];
  const left = w * safe.left;
  const right = w * (1 - safe.right);
  const size = Math.round(subtitleSize(o.format, h) * (o.scale ?? 1));
  ctx.save();
  ctx.textBaseline = "top";
  if (o.watermark) {
    const small = Math.round(size * 0.5);
    ctx.font = `600 ${small}px 'Pixelify Sans', sans-serif`;
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.shadowColor = "rgba(0,0,0,0.8)";
    ctx.shadowBlur = 4;
    let y = h * safe.top;
    const markW = o.markWidth !== undefined ? w * o.markWidth : right - left;
    for (const l of wrap(ctx, o.watermark[0], markW)) {
      ctx.fillText(l, left, y);
      y += small * 1.25;
    }
    ctx.font = `700 ${Math.round(small * 1.1)}px 'Pixelify Sans', sans-serif`;
    ctx.fillStyle = "#f0b84c";
    ctx.fillText(o.watermark[1], left, y);
    ctx.shadowBlur = 0;
  }
  if (o.label) {
    const small = Math.round(size * 0.6);
    ctx.font = `700 ${small}px 'Pixelify Sans', sans-serif`;
    const lw = ctx.measureText(o.label).width;
    const pad = small * 0.35;
    const x = right - lw - pad * 2;
    const y = h * safe.top;
    ctx.fillStyle = "rgba(10,12,18,0.78)";
    ctx.fillRect(x, y, lw + pad * 2, small + pad * 2);
    ctx.fillStyle = "#f0b84c";
    ctx.fillText(o.label, x + pad, y + pad);
  }
  if (o.day && o.day.alpha > 0) {
    const big = daySize(o.format, h);
    ctx.save();
    ctx.globalAlpha = o.day.alpha;
    ctx.font = `700 ${big}px 'Pixelify Sans', sans-serif`;
    ctx.textAlign = "center";
    ctx.fillStyle = "#ffffff";
    ctx.shadowColor = "rgba(0,0,0,0.85)";
    ctx.shadowBlur = big * 0.15;
    ctx.fillText(o.day.label, w / 2, h * safe.top + h * (1 - safe.top - safe.bottom) * 0.18);
    ctx.restore();
  }
  // De abajo arriba: la última frase, justo encima de la zona tapada.
  let bottom = h * (1 - safe.bottom);
  const pad = size * 0.35;
  for (const line of [...o.lines].reverse()) {
    ctx.font = `600 ${size}px 'Pixelify Sans', sans-serif`;
    const nameText = `${line.name}: `;
    const rows = wrap(ctx, nameText + line.text, right - left - pad * 2);
    const boxH = rows.length * size * 1.2 + pad * 2;
    const top = bottom - boxH;
    ctx.fillStyle = "rgba(10,12,18,0.78)";
    ctx.fillRect(left, top, right - left, boxH);
    rows.forEach((row, i) => {
      const y = top + pad + i * size * 1.2;
      if (i === 0 && row.startsWith(nameText.trim())) {
        ctx.fillStyle = line.color;
        ctx.fillText(nameText, left + pad, y);
        const nw = ctx.measureText(nameText).width;
        ctx.fillStyle = "#ffffff";
        ctx.fillText(row.slice(nameText.length), left + pad + nw, y);
      } else {
        ctx.fillStyle = "#ffffff";
        ctx.fillText(row, left + pad, y);
      }
    });
    bottom = top - size * 0.3;
  }
  ctx.restore();
}

/** Cuánto (ms reales) se queda un subtítulo: lo justo para leerlo. */
export function subtitleMs(text: string): number {
  return Math.min(8000, 2200 + text.length * 55);
}

/** «2026-11-03» → «03/11/2026». */
export function formatPlayedOn(date: string | null): string {
  if (!date) return "";
  const [y, m, d] = date.split("-");
  return `${d}/${m}/${y}`;
}

/** Dibuja el centro de `src` con la proporción del rectángulo (el recorte de los clips). */
export function drawCentered(
  ctx: CanvasRenderingContext2D,
  src: CanvasImageSource & { width: number; height: number },
  r: { x: number; y: number; w: number; h: number },
) {
  const ratio = r.w / r.h;
  let cropW = src.width;
  let cropH = Math.round(cropW / ratio);
  if (cropH > src.height) {
    cropH = src.height;
    cropW = Math.round(cropH * ratio);
  }
  const sx = Math.round((src.width - cropW) / 2);
  const sy = Math.round((src.height - cropH) / 2);
  ctx.drawImage(src, sx, sy, cropW, cropH, r.x, r.y, r.w, r.h);
}
