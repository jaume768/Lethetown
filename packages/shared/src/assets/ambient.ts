import type { Weather } from "../schemas/world";

export interface Ambient {
  /** Color del velo (0xRRGGBB) que se multiplica sobre el mapa. */
  tint: number;
  /** Opacidad del velo (0 = pleno día). */
  alpha: number;
  /** Intensidad de ventanas y farolas encendidas (0..1). */
  lights: number;
}

interface Key {
  minute: number;
  tint: number;
  alpha: number;
  lights: number;
}

/** Fotogramas clave del día (minuto del día). Entre ellos se interpola. */
const KEYS: Key[] = [
  { minute: 0, tint: 0x1b2450, alpha: 0.62, lights: 1 },
  { minute: 5 * 60, tint: 0x1b2450, alpha: 0.6, lights: 1 },
  { minute: 6 * 60 + 30, tint: 0xd98a5b, alpha: 0.3, lights: 0.4 },
  { minute: 8 * 60, tint: 0xffffff, alpha: 0, lights: 0 },
  { minute: 18 * 60, tint: 0xffffff, alpha: 0, lights: 0 },
  { minute: 19 * 60 + 30, tint: 0xd9735b, alpha: 0.3, lights: 0.5 },
  { minute: 21 * 60, tint: 0x1b2450, alpha: 0.58, lights: 1 },
  { minute: 24 * 60, tint: 0x1b2450, alpha: 0.62, lights: 1 },
];

function lerpColor(a: number, b: number, t: number): number {
  const ch = (c: number, s: number) => (c >> s) & 0xff;
  const mix = (s: number) => Math.round(ch(a, s) + (ch(b, s) - ch(a, s)) * t);
  return (mix(16) << 16) | (mix(8) << 8) | mix(0);
}

/** Luz ambiente para una hora del juego (minutos desde el inicio) y un tiempo atmosférico. */
export function ambientAt(gameMinutes: number, weather: Weather = "sunny"): Ambient {
  const m = ((gameMinutes % 1440) + 1440) % 1440;
  let i = 0;
  while (i < KEYS.length - 2 && KEYS[i + 1]!.minute <= m) i++;
  const a = KEYS[i]!;
  const b = KEYS[i + 1]!;
  const t = b.minute === a.minute ? 0 : (m - a.minute) / (b.minute - a.minute);
  const base: Ambient = {
    tint: lerpColor(a.tint, b.tint, t),
    alpha: a.alpha + (b.alpha - a.alpha) * t,
    lights: a.lights + (b.lights - a.lights) * t,
  };
  if (weather === "sunny") return base;
  // Nublado/lluvia: más oscuro y gris; las luces se encienden antes.
  const extra = weather === "rain" ? 0.25 : 0.12;
  return {
    tint: lerpColor(base.tint, 0x5a6478, 0.6),
    alpha: Math.min(0.75, base.alpha + extra),
    lights: Math.min(1, base.lights + (weather === "rain" ? 0.5 : 0.2)),
  };
}
