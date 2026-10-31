/**
 * Acuerdos de una conversación: lo que dos o más agentes dejan acordado hablando («quedamos el
 * viernes en la fuente», «te dejo el libro»). Los devuelve la tarea `social` de fin de charla y el
 * motor los pasa por el mismo manejador que la acción formal (ver docs/decisiones/acciones.md).
 *
 * El tipo es abierto: cada sistema del servidor registra los suyos (hoy, los de `AGREEMENT_TYPES`;
 * `pay` y `teach` llegarán con la economía y los oficios). Uno desconocido se descarta con motivo.
 */
import { z } from "zod";

export const AGREEMENT_TYPES = {
  meeting: "quedar otro rato: placeId, at (HH:MM) y day (hoy|mañana)",
  loan: "prestar un objeto: itemId (from presta, to recibe)",
  return: "devolver algo prestado: itemId (from devuelve)",
  gift: "regalar un objeto: itemId (from regala, to recibe)",
  invite: "ir juntos ahora mismo: placeId (from invita)",
} as const;
export type AgreementType = keyof typeof AGREEMENT_TYPES;

const optionalId = z.string().trim().min(1).max(40).nullable().catch(null).default(null);

export const Agreement = z.object({
  type: z.string().trim().toLowerCase().max(20),
  /** Quien lo propone, da, presta o invita (id). */
  from: optionalId,
  /** Los demás que lo acuerdan (ids). */
  to: z.array(z.string().trim().max(40)).max(5).catch([]).default([]),
  itemId: optionalId,
  placeId: optionalId,
  /** "HH:MM" (citas). */
  at: z.string().trim().max(5).nullable().catch(null).default(null),
  day: z.enum(["hoy", "mañana"]).catch("hoy").default("hoy"),
  /** Para qué ("tomar un café"): motivo de la cita o actividad de la invitación. */
  what: z.string().trim().max(80).catch("").default(""),
  /** La frase de la conversación que lo apoya. */
  quote: z.string().trim().max(200).catch("").default(""),
});
export type Agreement = z.infer<typeof Agreement>;
