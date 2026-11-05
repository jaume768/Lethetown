/**
 * Rangos de lo que se guarda en columnas `real` y `double` (corrección 3.5). En la partida de una
 * semana, una estabilidad de 3,8·10³⁸ h se salió del `real` de Postgres y se perdieron ticks. Cada
 * valor numérico que escribe agent-core pasa por aquí antes de guardarse: se queda en su rango y
 * un NaN o un infinito no llega a la base de datos (se cambia por un valor seguro).
 */

/** [mínimo, máximo] de una columna. */
export type Range = readonly [number, number];

const UNIT: Range = [0, 1];
const SIGNED: Range = [-1, 1];
/** Horas de juego: muy por encima del tope de agent-core (10 años) y lejos del límite de `real`. */
const STABILITY: Range = [1e-6, 1e9];
/** Cuentas y minutos (double): grandes, pero finitos. */
const COUNT: Range = [-1e12, 1e12];

/** Los rangos por tabla (solo las columnas numéricas que calcula la simulación). */
export const RANGES = {
  memory: { strength: UNIT, stability: STABILITY, emotionalValence: SIGNED },
  memoryVersion: { emotionalValence: SIGNED },
  social: { affinity: SIGNED, trust: UNIT, familiarity: UNIT, grudge: UNIT },
  socialHistory: { affinity: SIGNED, trust: UNIT, familiarity: UNIT },
  goal: { progress: UNIT, motivation: UNIT, frustration: UNIT, measured: COUNT, baseline: COUNT },
  skill: { level: UNIT, peak: UNIT, practiceMinutes: [0, 1e12] as Range },
  loreHolder: { fidelity: UNIT },
  drama: { score: [0, 100] as Range },
} as const;

/** Un número dentro de su rango; NaN pasa a `fallback` (por defecto, el mínimo) y ±∞ al extremo. */
export function inRange(x: number, [min, max]: Range, fallback = min): number {
  if (Number.isNaN(x)) return fallback;
  return Math.min(max, Math.max(min, x));
}

/**
 * La fila (o el parche) con cada columna numérica de `ranges` dentro de su rango. Las que no
 * vienen (un parche parcial) o son null se quedan como están.
 */
export function bounded<T extends object>(row: T, ranges: Readonly<Record<string, Range>>): T {
  const out = { ...row } as Record<string, unknown>;
  for (const [key, range] of Object.entries(ranges)) {
    const v = out[key];
    if (typeof v === "number") out[key] = inRange(v, range);
  }
  return out as T;
}
