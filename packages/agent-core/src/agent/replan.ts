import type { PlanItem } from "@lethetown/shared";

/**
 * Cambio de planes sobre la marcha: mete `change` en el plan del día desde `minute` (minuto del
 * día) durante `minutes`, recorta el bloque en curso y aparta lo que se solape. Así el plan que
 * se ve en el inspector es el que el agente sigue de verdad. Pura (testeable).
 */
export function replanAt(
  plan: PlanItem[],
  minute: number,
  change: Pick<PlanItem, "activity" | "activityKind" | "placeId" | "spotId">,
  minutes: number,
): PlanItem[] {
  const start = Math.max(0, Math.min(1439, Math.floor(minute)));
  const duration = Math.max(1, Math.min(Math.round(minutes), 1440 - start));
  const end = start + duration;
  const out: PlanItem[] = [];
  for (const p of plan) {
    const pEnd = p.startMinute + p.durationMin;
    if (pEnd <= start || p.startMinute >= end) {
      out.push(p);
      continue;
    }
    if (p.startMinute < start) out.push({ ...p, durationMin: start - p.startMinute });
    if (pEnd > end) out.push({ ...p, startMinute: end, durationMin: pEnd - end });
  }
  out.push({ ...change, startMinute: start, durationMin: duration, replanned: true });
  return out.sort((a, b) => a.startMinute - b.startMinute);
}
