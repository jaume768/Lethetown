/**
 * Metas (sistema `goals`): una meta vital, proyectos y pasos, cada uno con un criterio que el
 * motor sabe medir con lo que existe en la simulación. El LLM propone y redacta; el motor mide.
 * Ver docs/decisiones/metas.md.
 */
import { z } from "zod";

export const GoalLevel = z.enum(["life", "project", "step"]);
export type GoalLevel = z.infer<typeof GoalLevel>;

export const GoalStatus = z.enum(["active", "achieved", "abandoned", "postponed"]);
export type GoalStatus = z.infer<typeof GoalStatus>;

const count = (max: number) => z.coerce.number().int().positive().max(max);
const hours = z.coerce.number().positive().max(200);
const id = z.string().min(1).max(40);

/**
 * Catálogo de criterios medibles (todo lo cuenta el motor desde que se crea la meta). Una meta
 * que no encaja en ninguno no se crea.
 */
export const GoalCriterion = z.discriminatedUnion("type", [
  /** Horas haciendo algo cuya actividad contiene alguna palabra clave ("foto", "revelar"). */
  z.object({
    type: z.literal("activity_hours"),
    keywords: z.array(z.string().min(3).max(30)).min(1).max(6),
    hours,
  }),
  /** Horas en un lugar. */
  z.object({ type: z.literal("place_time"), placeId: id, hours }),
  /** Veces que va a un lugar. */
  z.object({ type: z.literal("visits"), placeId: id, count: count(100) }),
  /** Llegar a una afinidad, confianza o tipo de relación con alguien (su ficha social). */
  z.object({
    type: z.literal("relationship"),
    personId: id,
    affinity: z.coerce.number().min(-1).max(1).optional(),
    trust: z.coerce.number().min(0).max(1).optional(),
    relationship: z.enum(["friendship", "neighbor", "work", "family", "rivalry"]).optional(),
  }),
  /** Citas cumplidas: con alguien, o con N personas distintas. */
  z.object({
    type: z.literal("meetings"),
    personId: id.optional(),
    people: count(20).optional(),
    count: count(50),
  }),
  /** Conversaciones: con alguien, con N personas distintas o en un lugar. */
  z.object({
    type: z.literal("conversations"),
    personId: id.optional(),
    people: count(20).optional(),
    placeId: id.optional(),
    count: count(200),
  }),
  /** Lugares del pueblo descubiertos. */
  z.object({ type: z.literal("places_discovered"), count: count(30) }),
  /** Objetos usados, devueltos, regalados o prestados. */
  z.object({
    type: z.literal("items"),
    action: z.enum(["use_object", "return_item", "give_item", "lend_item"]),
    count: count(50),
  }),
  /** Notas publicadas en el tablón o dejadas a alguien. */
  z.object({ type: z.literal("notes"), count: count(30) }),
  /** Intenciones cumplidas (memoria prospectiva). */
  z.object({ type: z.literal("intentions_kept"), count: count(50) }),
  /** Para una meta vital: proyectos suyos conseguidos (los que avanzan cuentan su parte). */
  z.object({ type: z.literal("projects"), count: count(10) }),
]);
export type GoalCriterion = z.infer<typeof GoalCriterion>;
export type GoalCriterionType = GoalCriterion["type"];

export const GoalHistoryEntry = z.object({
  /** Minuto de juego. */
  at: z.number(),
  status: GoalStatus,
  progress: z.number(),
  motivation: z.number(),
  frustration: z.number(),
  /** Por qué cambió (legible). */
  reason: z.string(),
});
export type GoalHistoryEntry = z.infer<typeof GoalHistoryEntry>;

export const Goal = z.object({
  /** Id corto dentro del mundo ("g12"). */
  id: z.string(),
  agentId: z.string(),
  level: GoalLevel,
  parentId: z.string().nullable(),
  text: z.string(),
  status: GoalStatus,
  /** 0..1, lo calcula el motor. */
  progress: z.number().min(0).max(1),
  motivation: z.number().min(0).max(1),
  frustration: z.number().min(0).max(1),
  criterion: GoalCriterion,
  /** Lo medido desde que se creó (minutos, veces…), según el criterio. */
  measured: z.number().default(0),
  /** Valor de partida (afinidad o confianza al crearla), para las de relación. */
  baseline: z.number().nullable().default(null),
  /** Lo ya contado (personas distintas, conversaciones), para no contar dos veces. */
  seen: z.array(z.string()).default([]),
  /** Lo que se disputa con otros (la casa en venta, los clientes de la tarde): metas en conflicto. */
  resource: z.string().max(40).nullable().default(null),
  /** Si la meta es irse del pueblo: adónde (al conseguirla, un adulto se marcha). */
  departure: z.object({ to: z.string() }).nullable().default(null),
  createdAt: z.number(),
  updatedAt: z.number(),
  /** Último avance (para la frustración por estancarse). */
  lastProgressAt: z.number(),
  history: z.array(GoalHistoryEntry).default([]),
});
export type Goal = z.infer<typeof Goal>;

/** Meta inicial de una semilla: vital con sus proyectos (y quizá pasos). */
const SeedStep = z.object({ text: z.string(), criterion: GoalCriterion });
const SeedProject = SeedStep.extend({
  resource: z.string().max(40).optional(),
  steps: z.array(SeedStep).default([]),
});
export const SeedGoal = z.object({
  text: z.string(),
  departure: z.object({ to: z.string() }).optional(),
  /** Proyectos conseguidos que hacen falta para la meta vital (por defecto, todos). */
  needs: z.number().int().positive().optional(),
  projects: z.array(SeedProject).min(1).max(3),
});
export type SeedGoal = z.infer<typeof SeedGoal>;

/** Un vecino que se fue del pueblo (sistema `goals`). */
export const Departure = z.object({
  agentId: z.string(),
  to: z.string(),
  /** Minuto de juego en que se fue. */
  leftAt: z.number(),
  /** De la meta que lo llevó a irse. */
  goalId: z.string().nullable(),
  visits: z.number().int().nonnegative(),
  /** Próxima visita programada (null = no vuelve). */
  nextVisitAt: z.number().nullable(),
  /** Ahora está de visita en el pueblo. */
  visiting: z.boolean(),
});
export type Departure = z.infer<typeof Departure>;

export const AgentGoalsResponse = z.object({
  agentId: z.string(),
  now: z.number(),
  goals: z.array(Goal),
});
export type AgentGoalsResponse = z.infer<typeof AgentGoalsResponse>;

export const DeparturesResponse = z.object({ now: z.number(), items: z.array(Departure) });
export type DeparturesResponse = z.infer<typeof DeparturesResponse>;

/** Lugar de quien no está en el pueblo (se fue a vivir fuera): no es un lugar del mapa. */
export const AWAY_LOCATION = "fuera";
