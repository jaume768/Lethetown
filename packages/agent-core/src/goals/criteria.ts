/**
 * Criterios de las metas: cuánto falta según lo medido (lógica pura) y cómo se dice en el
 * prompt. Lo medido lo cuenta el servidor (sistema `goals`); el LLM nunca marca el progreso.
 */
import type { GoalCriterion, MeasurableCriterion } from "@lethetown/shared";

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** Lo que cuenta el motor (en una meta `confirmed`, su `measure`). */
export function measureOf(c: GoalCriterion): MeasurableCriterion {
  return c.type === "confirmed" ? c.measure : c;
}

/** Progreso (0..1) de lo medido: minutos para las de horas, veces para el resto. */
export function measuredProgress(criterion: GoalCriterion, measured: number): number {
  const c = measureOf(criterion);
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

/**
 * Progreso de una meta de relación: de lo que había al crearla (`baseline`) al objetivo y, si
 * el criterio pide conversaciones, las que lleva con esa persona (`conversations`).
 */
export function relationshipProgress(
  c: Extract<GoalCriterion, { type: "relationship" }>,
  now: { affinity: number; trust: number; relationshipType: string } | undefined,
  baseline: number | null,
  conversations = 0,
): number {
  if (!now) return 0;
  const parts: number[] = [];
  if (c.conversations) parts.push(clamp01(conversations / c.conversations));
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

type RelationshipCriterion = Extract<GoalCriterion, { type: "relationship" }>;

/**
 * Una meta de relación exigente: el objetivo de afinidad (o de confianza) queda al menos `minGain`
 * por encima de lo que hay al crearla y pide `minConversations` conversaciones con esa persona.
 * Devuelve el criterio ajustado y qué se cambió (para la auditoría), o null si no hizo falta.
 */
export function demandingRelationship(
  c: RelationshipCriterion,
  now: { affinity: number; trust: number } | undefined,
  cfg: { minGain: number; minConversations: number },
): { criterion: RelationshipCriterion; changes: string[] } | null {
  const out = { ...c };
  const changes: string[] = [];
  const round1 = (x: number) => Math.round(x * 100) / 100;
  if (c.affinity !== undefined) {
    const min = Math.min(1, round1((now?.affinity ?? 0) + cfg.minGain));
    if (c.affinity < min) {
      out.affinity = min;
      changes.push(`afinidad ${c.affinity.toFixed(2)} → ${min.toFixed(2)}`);
    }
  } else if (c.trust !== undefined) {
    const min = Math.min(1, round1((now?.trust ?? 0) + cfg.minGain));
    if (c.trust < min) {
      out.trust = min;
      changes.push(`confianza ${c.trust.toFixed(2)} → ${min.toFixed(2)}`);
    }
  }
  if (cfg.minConversations > 0 && (c.conversations ?? 0) < cfg.minConversations) {
    out.conversations = cfg.minConversations;
    changes.push(`y ${cfg.minConversations} conversaciones`);
  }
  return changes.length ? { criterion: out, changes } : null;
}

/** Personas o lugares de un criterio (para saber si viene a cuento en una decisión). */
export function criterionCues(criterion: GoalCriterion): { personId?: string; placeId?: string } {
  const c = measureOf(criterion);
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
  if (c.type === "confirmed") {
    return `${measurableText(c.measure, measured, names)}, y que de verdad: ${c.question}`;
  }
  return measurableText(c, measured, names);
}

function measurableText(
  c: MeasurableCriterion,
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
      const talks = c.conversations
        ? `, tras ${c.conversations} conversaciones (llevas ${measured})`
        : "";
      return `llegar con ${names.person(c.personId)} a ${parts.join(" y ")}${talks}`;
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
      const about = c.topics ? ` hablando de ${c.topics.map((t) => `«${t}»`).join(" o ")}` : "";
      return `${c.count} conversaciones${who}${where}${about} (llevas ${measured})`;
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
  'conversations {"personId":"…"|"people":4|"placeId":"…","topics":["palma"],"count":5} (topics: solo cuentan las charlas en que se dice)',
  'places_discovered {"count":2}',
  'items {"action":"use_object|return_item|give_item|lend_item","count":2}',
  'notes {"count":2}',
  'intentions_kept {"count":3}',
  'confirmed {"question":"¿Le ha dicho lo que siente?","measure":{…uno de los anteriores…}} (para lo que no basta contar: hablar de verdad, reconciliarse, convencer; cuando se cumpla lo medido, lo comprobarás tú con lo que se dijo)',
].join("; ");
