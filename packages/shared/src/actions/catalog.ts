/**
 * Catálogo cerrado de acciones de los agentes. La IA decide qué quiere hacer eligiendo una de
 * estas acciones con sus parámetros; el motor (apps/server/src/sim/actions) comprueba las
 * precondiciones y la ejecuta. Aquí vive la parte compartida de cada acción: su esquema zod y
 * cómo se presenta en el prompt. Para añadir una acción, ver docs/decisiones/acciones.md.
 */
import { z } from "zod";
import { ActivityKind } from "../schemas/agent";

/** activityKind desconocido → undefined (el motor lo deduce del texto). */
const LooseActivityKind = z
  .string()
  .nullish()
  .transform((v) => (ActivityKind.safeParse(v).success ? (v as ActivityKind) : undefined));

const NullableId = z
  .string()
  .nullish()
  .transform((v) => (v && v !== "null" ? v : null));

/** Cambiar de actividad o ir a otro sitio (lo que antes era "react"). */
export const DoActivityAction = z.object({
  type: z.literal("do_activity"),
  activity: z.string().trim().min(1).max(160),
  activityKind: LooseActivityKind,
  placeId: z.string().min(1),
  spotId: NullableId,
});

/** Decir algo breve a alguien presente (lo que antes era "talk"). */
export const SayAction = z.object({
  type: z.literal("say"),
  to: z.string().min(1),
  text: z.string().trim().min(1).max(400),
});

export const AgentAction = z.discriminatedUnion("type", [DoActivityAction, SayAction]);
export type AgentAction = z.infer<typeof AgentAction>;
export type ActionType = AgentAction["type"];

/** Cómo se presenta una acción en el prompt de decidir. */
export interface ActionSpec {
  type: ActionType;
  /** Parámetros en JSON de ejemplo (sin `type`), como los verá el modelo. */
  params: string;
  /** Para qué sirve, en una frase. */
  description: string;
}

export const ACTION_SPECS: Record<ActionType, ActionSpec> = {
  do_activity: {
    type: "do_activity",
    params: '{"activity":"…","activityKind":"…","placeId":"…","spotId":"… o null"}',
    description: "cambias de actividad o vas a otro sitio (spotId opcional)",
  },
  say: {
    type: "say",
    params: '{"to":"id de alguien presente","text":"…"}',
    description: "dices algo breve a alguien que está aquí",
  },
};

/** "- say {…}: dices algo…": una línea del prompt por acción disponible. */
export function actionLine(type: ActionType): string {
  const s = ACTION_SPECS[type];
  return `- ${s.type} ${s.params}: ${s.description}.`;
}

/**
 * Personas a las que afecta una acción (para la protección de menores y los registros): los
 * parámetros que nombran a alguien.
 */
export function actionPeople(action: AgentAction): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(action)) {
    if (["to", "with", "personId", "agentId"].includes(k) && typeof v === "string") out.push(v);
    if (["people", "with"].includes(k) && Array.isArray(v))
      out.push(...v.filter((x) => typeof x === "string"));
  }
  return out;
}

/** Todo el texto libre de una acción (para la protección de menores). */
export function actionText(action: AgentAction): string {
  return Object.entries(action)
    .filter(([k, v]) => k !== "type" && typeof v === "string")
    .map(([, v]) => v as string)
    .join(" ");
}
