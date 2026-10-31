/**
 * Criterios de las metas: cuánto falta según lo medido (lógica pura) y cómo se dice en el
 * prompt. Lo medido lo cuenta el servidor (sistema `goals`); el LLM nunca marca el progreso.
 */
import type { GoalCriterion } from "@lethetown/shared";

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** Progreso (0..1) de lo medido: minutos para las de horas, veces para el resto. */
export function measuredProgress(c: GoalCriterion, measured: number): number {
  switch (c.type) {
    case "activity_hours":
    case "place_time":
      return clamp01(measured / 60 / c.hours);
    case "relationship":
    case "projects":
      // Se calculan aparte (ficha social; proyectos hijos).
      return 0;
    default:
      return clamp01(measured / c.count);
  }
}

/** Progreso de una meta de relación: de lo que había al crearla (`baseline`) al objetivo. */
export function relationshipProgress(
  c: Extract<GoalCriterion, { type: "relationship" }>,
  now: { affinity: number; trust: number; relationshipType: string } | undefined,
  baseline: number | null,
): number {
  if (!now) return 0;
  const parts: number[] = [];
  const toward = (cur: number, target: number) => {
    const from = baseline ?? 0;
    if (cur >= target) return 1;
    if (target <= from) return cur >= target ? 1 : 0;
    return clamp01((cur - from) / (target - from));
  };
  if (c.affinity !== undefined) parts.push(toward(now.affinity, c.affinity));
  if (c.trust !== undefined) parts.push(toward(now.trust, c.trust));
  if (c.relationship) parts.push(now.relationshipType === c.relationship ? 1 : 0);
  return parts.length ? Math.min(...parts) : 0;
}

/** El valor de partida que importa para una meta de relación (afinidad o confianza). */
export function relationshipBaseline(
  c: Extract<GoalCriterion, { type: "relationship" }>,
  now: { affinity: number; trust: number } | undefined,
): number | null {
  if (!now) return null;
  if (c.affinity !== undefined) return now.affinity;
  if (c.trust !== undefined) return now.trust;
  return null;
}

/** Personas o lugares de un criterio (para saber si viene a cuento en una decisión). */
export function criterionCues(c: GoalCriterion): { personId?: string; placeId?: string } {
  return {
    ...("personId" in c && c.personId ? { personId: c.personId } : {}),
    ...("placeId" in c && c.placeId ? { placeId: c.placeId } : {}),
  };
}

const RELATIONSHIP_LABEL: Record<string, string> = {
  friendship: "amistad",
  neighbor: "vecinos",
  work: "trabajo",
  family: "familia",
  rivalry: "rivalidad",
};
const ITEM_VERB: Record<string, string> = {
  use_object: "usar objetos",
  return_item: "devolver cosas prestadas",
  give_item: "regalar algo",
  lend_item: "prestar algo",
};

const hoursText = (min: number) => {
  const h = Math.round((min / 60) * 10) / 10;
  return `${String(h).replace(".", ",")} h`;
};

/** Cómo se dice el criterio en el prompt, con lo que lleva: «pasar 6 h … (llevas 1,5 h)». */
export function criterionText(
  c: GoalCriterion,
  measured: number,
  names: { person(id: string): string; place(id: string): string },
): string {
  switch (c.type) {
    case "activity_hours":
      return `pasar ${c.hours} h en algo de ${c.keywords.map((k) => `«${k}»`).join(" o ")} (llevas ${hoursText(measured)})`;
    case "place_time":
      return `pasar ${c.hours} h en ${names.place(c.placeId)} (llevas ${hoursText(measured)})`;
    case "visits":
      return `ir ${c.count} veces a ${names.place(c.placeId)} (llevas ${measured})`;
    case "relationship": {
      const parts = [
        ...(c.affinity !== undefined ? [`afinidad ${c.affinity.toFixed(1)}`] : []),
        ...(c.trust !== undefined ? [`confianza ${c.trust.toFixed(1)}`] : []),
        ...(c.relationship ? [RELATIONSHIP_LABEL[c.relationship] ?? c.relationship] : []),
      ];
      return `llegar con ${names.person(c.personId)} a ${parts.join(" y ")}`;
    }
    case "meetings": {
      const who = c.personId
        ? `con ${names.person(c.personId)}`
        : c.people
          ? `con ${c.people} personas distintas`
          : "con alguien";
      return `${c.count} citas cumplidas ${who} (llevas ${measured})`;
    }
    case "conversations": {
      const who = c.personId
        ? ` con ${names.person(c.personId)}`
        : c.people
          ? ` con ${c.people} personas distintas`
          : "";
      const where = c.placeId ? ` en ${names.place(c.placeId)}` : "";
      return `${c.count} conversaciones${who}${where} (llevas ${measured})`;
    }
    case "places_discovered":
      return `descubrir ${c.count} sitios del pueblo (llevas ${measured})`;
    case "items":
      return `${ITEM_VERB[c.action]}: ${c.count} veces (llevas ${measured})`;
    case "notes":
      return `dejar ${c.count} notas (llevas ${measured})`;
    case "intentions_kept":
      return `cumplir ${c.count} cosas que te propongas (llevas ${measured})`;
    case "projects":
      return `conseguir ${c.count} de sus proyectos`;
  }
}

/** El catálogo, compacto, para la consolidación (qué criterios puede proponer el modelo). */
export const CRITERIA_CATALOG = [
  'activity_hours {"keywords":["foto"],"hours":6}',
  'place_time {"placeId":"…","hours":5}',
  'visits {"placeId":"…","count":3}',
  'relationship {"personId":"…","affinity":0.5|"trust":0.6|"relationship":"friendship"}',
  'meetings {"personId":"…"|"people":3,"count":2}',
  'conversations {"personId":"…"|"people":4|"placeId":"…","count":5}',
  'places_discovered {"count":2}',
  'items {"action":"use_object|return_item|give_item|lend_item","count":2}',
  'notes {"count":2}',
  'intentions_kept {"count":3}',
].join("; ");
