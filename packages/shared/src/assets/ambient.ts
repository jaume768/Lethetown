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

/** Partículas del tiempo, en coordenadas de pantalla normalizadas (0..1 por segundo). */
export interface WeatherParticles {
  /** `streak`: rayas (lluvia, viento) · `flake`: copos (nieve). */
  kind: "streak" | "flake" | "none";
  count: number;
  color: number;
  alpha: number;
  /** Caída (fracción de la pantalla por segundo) y deriva horizontal hacia la izquierda. */
  fall: number;
  drift: number;
  /** Largo de la raya o tamaño del copo, en píxeles. */
  size: number;
}

/** Cómo se ve cada tiempo atmosférico. */
export interface WeatherLook {
  /** Color hacia el que se tiñe el velo multiplicativo y cuánto (0..1). */
  tint: number;
  mix: number;
  /** Opacidad extra del velo. */
  extra: number;
  /** Luces de ventanas y farolas extra (0..1). */
  lights: number;
  particles: WeatherParticles;
  /** Niebla: velo claro (no multiplicativo) por encima del mapa, 0..1. */
  fog: number;
  /** Relámpagos: segundos reales de media entre destellos (0 = sin relámpagos). */
  flashEvery: number;
}

const NONE: WeatherParticles = {
  kind: "none",
  count: 0,
  color: 0,
  alpha: 0,
  fall: 0,
  drift: 0,
  size: 0,
};

export const WEATHER_LOOK: Record<Weather, WeatherLook> = {
  sunny: { tint: 0xffffff, mix: 0, extra: 0, lights: 0, particles: NONE, fog: 0, flashEvery: 0 },
  cloudy: {
    tint: 0x5a6478,
    mix: 0.6,
    extra: 0.12,
    lights: 0.2,
    particles: NONE,
    fog: 0,
    flashEvery: 0,
  },
  rain: {
    tint: 0x5a6478,
    mix: 0.6,
    extra: 0.25,
    lights: 0.5,
    particles: {
      kind: "streak",
      count: 260,
      color: 0xb8d4ff,
      alpha: 0.55,
      fall: 1.2,
      drift: 0.15,
      size: 7,
    },
    fog: 0,
    flashEvery: 0,
  },
  storm: {
    tint: 0x3a4258,
    mix: 0.7,
    extra: 0.4,
    lights: 0.8,
    particles: {
      kind: "streak",
      count: 420,
      color: 0xc8dcff,
      alpha: 0.7,
      fall: 2,
      drift: 0.5,
      size: 10,
    },
    fog: 0,
    flashEvery: 6,
  },
  snow: {
    tint: 0xc8d6f0,
    mix: 0.5,
    extra: 0.1,
    lights: 0.3,
    particles: {
      kind: "flake",
      count: 220,
      color: 0xffffff,
      alpha: 0.9,
      fall: 0.16,
      drift: 0.05,
      size: 2,
    },
    fog: 0.12,
    flashEvery: 0,
  },
  fog: {
    tint: 0xb4bac6,
    mix: 0.4,
    extra: 0.08,
    lights: 0.4,
    particles: NONE,
    fog: 0.38,
    flashEvery: 0,
  },
  wind: {
    tint: 0xdde3ea,
    mix: 0.2,
    extra: 0.05,
    lights: 0,
    particles: {
      kind: "streak",
      count: 70,
      color: 0xffffff,
      alpha: 0.3,
      fall: 0.06,
      drift: 1.6,
      size: 14,
    },
    fog: 0,
    flashEvery: 0,
  },
  heat: {
    tint: 0xffc070,
    mix: 0.6,
    extra: 0.14,
    lights: 0,
    particles: NONE,
    fog: 0,
    flashEvery: 0,
  },
};

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
  const look = WEATHER_LOOK[weather];
  if (!look.mix && !look.extra && !look.lights) return base;
  // Mal tiempo: más oscuro y teñido; las luces se encienden antes.
  return {
    tint: lerpColor(base.tint, look.tint, look.mix),
    alpha: Math.min(0.75, base.alpha + look.extra),
    lights: Math.min(1, base.lights + look.lights),
  };
}
