/** Invitaciones a ir juntos ahora mismo a un sitio (caducan enseguida si nadie responde). */
import { z } from "zod";

export const Invitation = z.object({
  /** Id corto dentro del mundo ("v3"). */
  id: z.string(),
  fromId: z.string(),
  to: z.array(z.string()).min(1),
  responses: z.record(z.string(), z.enum(["pending", "accepted", "declined"])),
  placeId: z.string(),
  activity: z.string(),
  createdAt: z.number(),
  expiresAt: z.number(),
});
export type Invitation = z.infer<typeof Invitation>;
