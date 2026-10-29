import { z } from "zod";

/** Estado de una cita: propuesta → aceptada → cumplida | fallida; o cancelada. */
export const CommitmentStatus = z.enum(["proposed", "accepted", "done", "failed", "cancelled"]);
export type CommitmentStatus = z.infer<typeof CommitmentStatus>;

/** Respuesta de cada invitado. */
export const CommitmentResponse = z.enum(["pending", "accepted", "declined"]);
export type CommitmentResponse = z.infer<typeof CommitmentResponse>;

/** Una cita entre agentes (compromiso de verse en un lugar a una hora). */
export const Commitment = z.object({
  /** Id corto dentro del mundo ("c3"), para que el modelo lo maneje bien. */
  id: z.string(),
  organizerId: z.string(),
  /** Todos los implicados, incluido quien la propone. */
  participants: z.array(z.string()).min(2),
  /** Respuesta de cada participante (quien propone, "accepted"). */
  responses: z.record(z.string(), CommitmentResponse),
  placeId: z.string(),
  /** Minuto de juego absoluto en que empieza. */
  at: z.number(),
  reason: z.string(),
  status: CommitmentStatus,
  /** Minuto de juego en que llegó cada uno (los que llegaron). */
  arrivals: z.record(z.string(), z.number()).default({}),
  /** Quién se olvidó de ir (lo decide su memoria). */
  forgot: z.array(z.string()).default([]),
  /** Recuerdo de la intención de cada participante (memoria prospectiva). */
  intentions: z.record(z.string(), z.string()).default({}),
  /** Marcas del motor ("left:lucia" = ya salió hacia la cita; "waited:mateo"…). */
  flags: z.array(z.string()).default([]),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type Commitment = z.infer<typeof Commitment>;

export const CommitmentsResponse = z.object({
  agentId: z.string(),
  now: z.number(),
  items: z.array(Commitment),
});
export type CommitmentsResponse = z.infer<typeof CommitmentsResponse>;
