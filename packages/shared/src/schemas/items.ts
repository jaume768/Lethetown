/** Objetos que se llevan encima (inventario): dueño, quién lo tiene, dónde está y préstamos. */
import { z } from "zod";

export const ItemLoan = z.object({
  /** Quién lo prestó (el dueño) y a quién. */
  from: z.string(),
  to: z.string(),
  since: z.number(),
  /** Cuándo debería devolverlo (minuto de juego). */
  dueAt: z.number(),
  /** Ya se avisó al dueño de que no se lo han devuelto. */
  overdueNoticed: z.boolean().default(false),
});
export type ItemLoan = z.infer<typeof ItemLoan>;

export const Item = z.object({
  /** Id corto dentro del mundo ("i3"). */
  id: z.string(),
  /** Tipo ("libro", "paraguas"...): para iconos y, más adelante, para la economía. */
  kind: z.string(),
  name: z.string(),
  description: z.string().default(""),
  /** Dueño (null = de nadie, p. ej. algo encontrado). */
  ownerId: z.string().nullable(),
  /** Quién lo lleva encima (null si está dejado en un sitio). */
  holderId: z.string().nullable(),
  /** Dónde está dejado (si nadie lo lleva). */
  placeId: z.string().nullable().default(null),
  loan: ItemLoan.nullable().default(null),
  /** Valor (para una economía futura; 0 = sin precio). */
  value: z.number().nonnegative().default(0),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type Item = z.infer<typeof Item>;

/** Objeto de partida en la semilla de un agente (su dueño). */
export const SeedItem = z.object({
  kind: z.string(),
  name: z.string(),
  description: z.string().default(""),
  /** Se lo ha prestado a alguien (que lo lleva encima al empezar). */
  lentTo: z.string().optional(),
  /** Días que quedan para que se lo devuelvan (si está prestado). */
  dueInDays: z.number().positive().default(2),
  value: z.number().nonnegative().default(0),
});
export type SeedItem = z.infer<typeof SeedItem>;

export const InventoryResponse = z.object({
  agentId: z.string(),
  now: z.number(),
  /** Lo que lleva encima y lo suyo (aunque lo tenga otro o esté en otro sitio). */
  items: z.array(Item),
});
export type InventoryResponse = z.infer<typeof InventoryResponse>;
