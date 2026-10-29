/** Notas escritas: en el tablón de la plaza (públicas) o dejadas para alguien (privadas). */
import { z } from "zod";

export const Note = z.object({
  /** Id corto dentro del mundo ("n3"). */
  id: z.string(),
  authorId: z.string(),
  kind: z.enum(["public", "private"]),
  /** Para quién es (las privadas). */
  toId: z.string().nullable(),
  /** Dónde está (el lugar del tablón, o donde se dejó). */
  placeId: z.string(),
  text: z.string().max(400),
  createdAt: z.number(),
  expiresAt: z.number(),
  /** Quién la ha leído. */
  readBy: z.array(z.string()).default([]),
});
export type Note = z.infer<typeof Note>;

export const NotesResponse = z.object({ now: z.number(), items: z.array(Note) });
export type NotesResponse = z.infer<typeof NotesResponse>;
