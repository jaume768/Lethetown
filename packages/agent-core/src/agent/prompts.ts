import type { AgentSeed, Needs, Place, PlanItem } from "@lethetown/shared";

/** Convierte minutos de juego en "día N, HH:MM". */
export function formatGameTime(minutes: number): string {
  const day = Math.floor(minutes / 1440);
  return `día ${day}, ${formatClock(minutes % 1440)}`;
}

export function formatClock(minuteOfDay: number): string {
  const h = Math.floor(minuteOfDay / 60) % 24;
  const m = Math.floor(minuteOfDay % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function parseClock(hhmm: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 23 || m > 59) return null;
  return h * 60 + m;
}

/**
 * Prefijo fijo del agente: identidad + lugares + reglas de formato. No debe contener nada
 * que cambie entre llamadas (ni la hora, ni el estado) para que el prompt caching funcione.
 */
export function identityPrompt(seed: AgentSeed, places: Place[]): string {
  const placeLines = places.map((p) => `- ${p.id} (${p.kind}): ${p.name}`).join("\n");
  return `Eres ${seed.name}, ${seed.age} años, habitante de un pequeño pueblo.
Rasgos: ${seed.traits.join(", ")}.
${seed.description}
Tu casa: ${seed.homeId}

## Lugares del pueblo (id (tipo): nombre)
${placeLines}

## Reglas
- Vives tu vida con naturalidad; eres coherente con tus rasgos y tus recuerdos.
- Tus recuerdos pueden ser vagos o incompletos; no inventes detalles que no recuerdas.
- Usa solo ids de lugares de la lista anterior.
- Responde SIEMPRE con un único objeto JSON válido, sin texto antes ni después.`;
}

export function planPrompt(opts: { now: number; needs: Needs; recalled: string }): string {
  return `TAREA: plan
Es ${formatGameTime(opts.now)}. Planifica tu día desde las 07:00 hasta las 22:00 (de 22:00 a 07:00 duermes en casa).
Necesidades (0 = vacía, 1 = llena): energía ${opts.needs.energy.toFixed(2)}, hambre ${opts.needs.hunger.toFixed(2)}, social ${opts.needs.social.toFixed(2)}.
Lo que recuerdas ahora:
${opts.recalled}

Formato:
{"plan":[{"start":"HH:MM","durationMin":60,"activity":"descripción breve","placeId":"id"}]}
Entre 4 y 8 bloques, en orden, sin solaparse.`;
}

export interface PerceptionLine {
  text: string;
}

export function importancePrompt(observations: string[]): string {
  const lines = observations.map((o, i) => `${i + 1}. ${o}`).join("\n");
  return `TAREA: importance
Valora cada observación desde tu punto de vista.
importance: 1 (trivial, p. ej. ver a alguien pasar) .. 10 (vital, p. ej. una ruptura).
valence: -1 (muy negativa) .. 1 (muy positiva).
Observaciones:
${lines}

Formato:
{"ratings":[{"importance":3,"valence":0.1}]}  (una entrada por observación, en el mismo orden)`;
}

export function decidePrompt(opts: {
  now: number;
  locationId: string;
  action: string;
  moodLabel: string;
  needs: Needs;
  planItem: PlanItem | undefined;
  present: { id: string; name: string; action: string }[];
  heard: { fromId: string; fromName: string; text: string }[];
  workingMemory: string;
}): string {
  const present = opts.present.length
    ? opts.present.map((p) => `${p.id}=${p.name} (${p.action})`).join("; ")
    : "nadie";
  const heard = opts.heard.length
    ? opts.heard.map((h) => `${h.fromId}=${h.fromName}: "${h.text}"`).join("\n")
    : "(nada)";
  const plan = opts.planItem
    ? `${opts.planItem.activity} en ${opts.planItem.placeId} (desde ${formatClock(opts.planItem.startMinute)}, ${opts.planItem.durationMin} min)`
    : "nada previsto";
  return `TAREA: decide
Es ${formatGameTime(opts.now)}. Estás en ${opts.locationId} haciendo: ${opts.action}.
Ánimo: ${opts.moodLabel}. Energía ${opts.needs.energy.toFixed(2)}, hambre ${opts.needs.hunger.toFixed(2)}, social ${opts.needs.social.toFixed(2)}.
Tu plan ahora: ${plan}
PRESENTES: ${present}
HABLAN:
${heard}
Memoria de trabajo:
${opts.workingMemory}

Elige una opción:
- "continue": sigues con tu plan.
- "react": cambias de actividad (indica action y placeId).
- "talk": dices algo breve a alguien presente (indica to = id y say).
Formato:
{"choice":"continue|react|talk","action":"...","placeId":"...","to":"...","say":"..."}`;
}
