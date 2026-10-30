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
  /** Lo que se pasa de largo se recorta después (según su forma de hablar), no se rechaza. */
  text: z
    .string()
    .trim()
    .min(1)
    .transform((t) => t.slice(0, 400)),
});

/** Una o varias personas (acepta un id suelto). */
const People = z
  .union([z.string(), z.array(z.string())])
  .transform((v) => (Array.isArray(v) ? v : [v]))
  .pipe(z.array(z.string().min(1)).min(1).max(4));

/** Proponer una cita (a quien está aquí): lugar, hora de hoy o de mañana y motivo. */
export const ProposeMeetingAction = z.object({
  type: z.literal("propose_meeting"),
  with: People,
  placeId: z.string().min(1),
  /** "HH:MM" */
  at: z.string().regex(/^\d{1,2}:\d{2}$/),
  day: z.enum(["hoy", "mañana"]).catch("hoy").default("hoy"),
  reason: z.string().trim().min(1).max(160),
});

/** Aceptar una cita que le han propuesto. */
export const AcceptMeetingAction = z.object({
  type: z.literal("accept_meeting"),
  meetingId: z.string().min(1),
});

/** Rechazar una cita que le han propuesto. */
export const DeclineMeetingAction = z.object({
  type: z.literal("decline_meeting"),
  meetingId: z.string().min(1),
  reason: z.string().trim().max(160).optional(),
});

/** Anular una cita en la que está. */
export const CancelMeetingAction = z.object({
  type: z.literal("cancel_meeting"),
  meetingId: z.string().min(1),
  reason: z.string().trim().max(160).optional(),
});

/** Explorar el pueblo: el motor elige una ruta hacia lo que no conoce (zona opcional). */
export const ExploreAction = z.object({
  type: z.literal("explore"),
  zone: z.enum(["norte", "sur", "este", "oeste"]).nullish().catch(null),
});

/** Usar un objeto de aquí con uno de sus verbos (ver PUEDES USAR). */
export const UseObjectAction = z.object({
  type: z.literal("use_object"),
  objectId: z.string().min(1),
  verb: z.string().min(1),
});

/** Regalar algo tuyo a alguien presente (o devolverle lo suyo). */
export const GiveItemAction = z.object({
  type: z.literal("give_item"),
  itemId: z.string().min(1),
  to: z.string().min(1),
});

/** Prestar algo tuyo a alguien presente durante unos días. */
export const LendItemAction = z.object({
  type: z.literal("lend_item"),
  itemId: z.string().min(1),
  to: z.string().min(1),
  days: z.coerce.number().int().min(1).max(14).catch(3).default(3),
});

/** Devolver algo prestado a su dueño (que tiene que estar aquí). */
export const ReturnItemAction = z.object({
  type: z.literal("return_item"),
  itemId: z.string().min(1),
});

/** Coger algo que está aquí (tuyo o de nadie). */
export const TakeItemAction = z.object({
  type: z.literal("take_item"),
  itemId: z.string().min(1),
});

/** Dejar aquí algo tuyo que llevas. */
export const LeaveItemAction = z.object({
  type: z.literal("leave_item"),
  itemId: z.string().min(1),
});

/** Invitar a quien está aquí a ir contigo ahora a un sitio (a tu casa, a tomar algo…). */
export const InviteAction = z.object({
  type: z.literal("invite"),
  with: People,
  placeId: z.string().min(1),
  activity: z.string().trim().min(1).max(160),
});

/** Aceptar una invitación: vais juntos (y le acompañas un rato). */
export const AcceptInviteAction = z.object({
  type: z.literal("accept_invite"),
  inviteId: z.string().min(1),
});

export const DeclineInviteAction = z.object({
  type: z.literal("decline_invite"),
  inviteId: z.string().min(1),
  reason: z.string().trim().max(160).optional(),
});

/** Acompañar a alguien que está aquí: vas donde vaya durante un rato. */
export const FollowAction = z.object({
  type: z.literal("follow"),
  who: z.string().min(1),
});

/** Colgar una nota en el tablón de la plaza (la puede leer cualquiera). */
export const PostNoteAction = z.object({
  type: z.literal("post_note"),
  text: z.string().trim().min(1).max(280),
});

/** Dejar aquí una nota para alguien (la leerá cuando pase por aquí). */
export const LeaveNoteAction = z.object({
  type: z.literal("leave_note"),
  to: z.string().min(1),
  text: z.string().trim().min(1).max(280),
});

export const AgentAction = z.discriminatedUnion("type", [
  DoActivityAction,
  SayAction,
  ProposeMeetingAction,
  AcceptMeetingAction,
  DeclineMeetingAction,
  CancelMeetingAction,
  ExploreAction,
  UseObjectAction,
  GiveItemAction,
  LendItemAction,
  ReturnItemAction,
  TakeItemAction,
  LeaveItemAction,
  InviteAction,
  AcceptInviteAction,
  DeclineInviteAction,
  FollowAction,
  PostNoteAction,
  LeaveNoteAction,
]);
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
    description:
      "le dices algo a alguien que está aquí, como se habla de verdad: una réplica corta (a veces una o dos palabras), sin saludar en cada turno ni repetir lo ya dicho",
  },
  propose_meeting: {
    type: "propose_meeting",
    params:
      '{"with":["id de alguien presente"],"placeId":"…","at":"HH:MM","day":"hoy|mañana","reason":"…"}',
    description: "propones quedar con quien está aquí en un sitio y a una hora",
  },
  accept_meeting: {
    type: "accept_meeting",
    params: '{"meetingId":"…"}',
    description: "aceptas una cita que te han propuesto (ver AGENDA)",
  },
  decline_meeting: {
    type: "decline_meeting",
    params: '{"meetingId":"…","reason":"…"}',
    description: "rechazas una cita que te han propuesto",
  },
  cancel_meeting: {
    type: "cancel_meeting",
    params: '{"meetingId":"…","reason":"…"}',
    description: "anulas una cita de tu agenda",
  },
  explore: {
    type: "explore",
    params: '{"zone":"norte|sur|este|oeste o null"}',
    description: "sales a explorar el pueblo y descubrir sitios que no conoces",
  },
  use_object: {
    type: "use_object",
    params: '{"objectId":"…","verb":"…"}',
    description: "usas un objeto de aquí (ver PUEDES USAR)",
  },
  give_item: {
    type: "give_item",
    params: '{"itemId":"…","to":"id de alguien presente"}',
    description: "le regalas algo tuyo que llevas (ver LLEVAS)",
  },
  lend_item: {
    type: "lend_item",
    params: '{"itemId":"…","to":"id de alguien presente","days":3}',
    description: "le prestas algo tuyo unos días",
  },
  return_item: {
    type: "return_item",
    params: '{"itemId":"…"}',
    description: "devuelves algo prestado a su dueño, que está aquí",
  },
  take_item: {
    type: "take_item",
    params: '{"itemId":"…"}',
    description: "coges algo de aquí (ver AQUÍ HAY)",
  },
  leave_item: {
    type: "leave_item",
    params: '{"itemId":"…"}',
    description: "dejas aquí algo tuyo que llevas",
  },
  invite: {
    type: "invite",
    params: '{"with":["id de alguien presente"],"placeId":"…","activity":"…"}',
    description: "invitas a quien está aquí a ir contigo ahora a un sitio",
  },
  accept_invite: {
    type: "accept_invite",
    params: '{"inviteId":"…"}',
    description: "aceptas una invitación y vais juntos (ver INVITACIONES)",
  },
  decline_invite: {
    type: "decline_invite",
    params: '{"inviteId":"…","reason":"…"}',
    description: "rechazas una invitación",
  },
  follow: {
    type: "follow",
    params: '{"who":"id de alguien presente"}',
    description: "acompañas a alguien de aquí un rato, vaya donde vaya",
  },
  post_note: {
    type: "post_note",
    params: '{"text":"…"}',
    description: "cuelgas una nota en el tablón de la plaza (la leerá quien pase)",
  },
  leave_note: {
    type: "leave_note",
    params: '{"to":"id de alguien","text":"…"}',
    description: "dejas aquí una nota para alguien (la leerá cuando pase por aquí)",
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
