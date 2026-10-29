/**
 * Rutinas como hábitos (fase 1 de la psicología). Las actividades del día no se guardan una a
 * una como recuerdos: al dormirse, el diario del día (`doneToday`) se resume en un único
 * recuerdo ("El día N: …") y alimenta un rastreador de rutinas. Lo que se repite en varios días
 * (misma actividad, lugar y franja) se convierte en un recuerdo semántico de hábito
 * ("Suelo tomar un café en el café por las mañanas"), que se refuerza cada vez que se repite.
 * Lógica pura: el agente decide cuándo llamarla y la memoria guarda el resultado.
 */
import { z } from "zod";

/** Franja del día de una actividad. */
export const DaySlot = z.enum(["mañana", "mediodía", "tarde", "noche"]);
export type DaySlot = z.infer<typeof DaySlot>;

export const HabitEntry = z.object({
  activity: z.string(),
  placeId: z.string(),
  slot: DaySlot,
  /** Días de juego en que se ha visto (dentro de la ventana). */
  days: z.array(z.number().int()),
  /** Recuerdo semántico del hábito, si ya se formó. */
  memoryId: z.string().nullable(),
});
export type HabitEntry = z.infer<typeof HabitEntry>;

/** Rutinas vistas, por clave "actividad|lugar|franja". */
export const HabitTracker = z.record(z.string(), HabitEntry);
export type HabitTracker = z.infer<typeof HabitTracker>;

export interface DiaryEntry {
  minute: number;
  activity: string;
  placeId: string;
}

export function slotOf(minuteOfDay: number): DaySlot {
  const h = Math.floor(minuteOfDay / 60) % 24;
  if (h >= 5 && h < 12) return "mañana";
  if (h >= 12 && h < 15) return "mediodía";
  if (h >= 15 && h < 20) return "tarde";
  return "noche";
}

export function habitKey(activity: string, placeId: string, slot: DaySlot): string {
  return `${activity.trim().toLowerCase()}|${placeId}|${slot}`;
}

/** Anota el diario de un día en el rastreador y olvida lo que queda fuera de la ventana. */
export function recordDay(
  tracker: HabitTracker,
  entries: DiaryEntry[],
  day: number,
  windowDays: number,
): HabitTracker {
  const next: HabitTracker = {};
  for (const [key, h] of Object.entries(tracker)) {
    const days = h.days.filter((d) => d > day - windowDays);
    // Una rutina que ya no se ve se borra del rastreador (su recuerdo, si lo hay, sigue su curso).
    if (days.length) next[key] = { ...h, days };
  }
  for (const e of entries) {
    const slot = slotOf(e.minute);
    const key = habitKey(e.activity, e.placeId, slot);
    const h = next[key] ?? {
      activity: e.activity.trim(),
      placeId: e.placeId,
      slot,
      days: [],
      memoryId: null,
    };
    if (!h.days.includes(day)) h.days = [...h.days, day];
    next[key] = h;
  }
  return next;
}

/** Rutinas de hoy que ya son hábito (se han visto al menos `minDays` días en la ventana). */
export function dueHabits(tracker: HabitTracker, day: number, minDays: number): HabitEntry[] {
  return Object.values(tracker).filter((h) => h.days.includes(day) && h.days.length >= minDays);
}

const SLOT_PHRASE: Record<DaySlot, string> = {
  mañana: "por las mañanas",
  mediodía: "a mediodía",
  tarde: "por las tardes",
  noche: "por las noches",
};

/** "Suelo tomar un café en Café La Ola por las mañanas." */
export function habitText(h: Pick<HabitEntry, "activity" | "slot">, placeName: string): string {
  return `Suelo ${h.activity} en ${placeName} ${SLOT_PHRASE[h.slot]}.`;
}

/**
 * "El día 3: preparar el desayuno en Casa azul, atender el café en Café La Ola…", sin LLM.
 * Las entradas seguidas iguales se juntan.
 */
export function dayDiaryText(
  day: number,
  entries: DiaryEntry[],
  placeName: (id: string) => string,
): string {
  const parts: string[] = [];
  for (const e of entries) {
    const part = `${e.activity} en ${placeName(e.placeId)}`;
    if (parts.at(-1) !== part) parts.push(part);
  }
  return `El día ${day}: ${parts.join(", ")}.`;
}
