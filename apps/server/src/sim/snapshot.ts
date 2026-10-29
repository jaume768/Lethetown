import { AgentMind } from "@lethetown/agent-core";
import {
  ActivityKind,
  AgentState,
  Commitment,
  Invitation,
  Note,
  Item,
  SimSpeed,
  TilePoint,
  Weather,
} from "@lethetown/shared";
import { z } from "zod";

/** Sube este número si cambias la forma de la instantánea (las antiguas se ignoran). */
export const SIM_SNAPSHOT_VERSION = 16;

/** Percepción pendiente (misma forma que `Perception` de agent-core). */
const Perception = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("arrived"),
    agentId: z.string(),
    name: z.string(),
    action: z.string(),
    placeId: z.string(),
  }),
  z.object({
    kind: z.literal("speech"),
    fromId: z.string(),
    fromName: z.string(),
    text: z.string(),
    placeId: z.string(),
    eventId: z.string().optional(),
    toName: z.string().optional(),
  }),
  z.object({
    kind: z.literal("overheard"),
    fromId: z.string().nullable(),
    fromName: z.string(),
    toName: z.string(),
    fragment: z.string(),
    placeId: z.string(),
    eventId: z.string().optional(),
  }),
  z.object({ kind: z.literal("thought"), text: z.string() }),
  z.object({
    kind: z.literal("world"),
    text: z.string(),
    placeId: z.string().nullable(),
    eventId: z.string().optional(),
  }),
]);

const Heard = z.object({
  fromId: z.string(),
  fromName: z.string(),
  text: z.string(),
  eventId: z.string(),
  toName: z.string().optional(),
});

export const SimSnapshot = z.object({
  version: z.literal(SIM_SNAPSHOT_VERSION),
  time: z.number(),
  speed: SimSpeed,
  weather: Weather,
  spots: z.array(z.object({ id: z.string(), state: z.string() })),
  agents: z.array(
    z.object({
      id: z.string(),
      state: AgentState,
      /** Estado interno (hábitos, diario…) que no viaja al cliente. */
      mind: AgentMind,
      workingMemory: z.array(
        z.object({ text: z.string(), memoryId: z.string().optional(), addedAt: z.number() }),
      ),
      runtime: z.object({
        travelling: z.boolean(),
        arrival: z
          .object({
            destId: z.string(),
            goal: TilePoint,
            thenAction: z.string(),
            thenKind: ActivityKind,
            at: z.number(),
          })
          .nullable(),
        plannedDay: z.number(),
        seenHere: z.array(z.string()),
        inbox: z.array(Heard),
        pending: z.array(Perception),
        knownStates: z.array(z.tuple([z.string(), z.string()])),
        overrideUntil: z.number(),
        utteredAt: z.number().nullable(),
        lastMaintenance: z.number().nullable(),
        lastConsolidation: z.number(),
        consolidatedNight: z.number(),
        weatherChecked: z.string().nullable(),
        convWarned: z.string().nullable(),
        following: z.object({ who: z.string(), until: z.number() }).nullable().default(null),
        normWarned: z.string().nullable().default(null),
      }),
    }),
  ),
  conversations: z.array(
    z.object({
      id: z.string(),
      members: z.array(z.string()).min(2),
      turns: z.number(),
      lastAt: z.number(),
      transcript: z.array(z.string()),
      pairs: z.record(z.string(), z.number()).default({}),
    }),
  ),
  /** Citas vivas y recientes, y el contador de ids. */
  meetings: z.array(Commitment).default([]),
  meetingSeq: z.number().int().nonnegative().default(0),
  /** Objetos del inventario y el contador de ids. */
  items: z.array(Item).default([]),
  itemSeq: z.number().int().nonnegative().default(0),
  /** Objetos del mapa que volverán solos a otro estado (spotId → cuándo, a qué y desde cuál). */
  /** Invitaciones a ir juntos ahora mismo (caducan enseguida). */
  invitations: z.array(Invitation).default([]),
  invitationSeq: z.number().int().nonnegative().default(0),
  /** Notas vivas y el contador de ids. */
  notes: z.array(Note).default([]),
  noteSeq: z.number().int().nonnegative().default(0),
  /** Invitados de cada casa (lugar → agente → hasta cuándo). */
  guests: z.record(z.string(), z.record(z.string(), z.number())).default({}),
  objectTimers: z
    .record(z.string(), z.object({ at: z.number(), state: z.string(), from: z.string() }))
    .default({}),
});
export type SimSnapshot = z.infer<typeof SimSnapshot>;

/** Valida una instantánea leída de la BD; null si es de otra versión o está corrupta. */
export function parseSnapshot(data: unknown): SimSnapshot | null {
  const parsed = SimSnapshot.safeParse(data);
  return parsed.success ? parsed.data : null;
}
