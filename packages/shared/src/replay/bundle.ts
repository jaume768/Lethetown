import { z } from "zod";
import { AgentState } from "../schemas/agent";
import { Chronicle, SimEvent } from "../schemas/api";
import { Drama } from "../schemas/drama";
import { Goal } from "../schemas/goals";
import { Lore, LoreHolder } from "../schemas/lore";
import {
  Clarity,
  MemoryAuditEntry,
  MemoryVersion,
  MemoryView,
  SocialProfile,
  SocialProfileChange,
} from "../schemas/memory";
import { MemoryEffectMessage, ThinkingMessage, WorldStateMessage } from "../schemas/messages";
import { SkillState } from "../schemas/skills";
import { World } from "../schemas/world";

/**
 * Paquete de repetición (`pnpm replay:pack`): una partida grabada que la web reproduce sin
 * servidor, sin LLM y sin coste. Todo lo que lleva sale tal cual de la partida (lo que dijeron,
 * los dramas, las crónicas…); nada se inventa ni se reescribe.
 *
 * Es una **lista blanca**: cada parte pasa por su esquema zod (que descarta las claves que no
 * conoce), así que nada que no esté aquí (costes, usuarios, correos, claves, rutas locales,
 * moderación…) llega al paquete. Si añades un campo, piensa si se puede publicar.
 */
export const REPLAY_FORMAT = "lethetown-replay";
/** Sube al cambiar la forma del paquete (el reproductor rechaza las que no entiende). */
export const REPLAY_VERSION = 1;

export const ReplayMeta = z.object({
  /** Semilla de la partida (SIM_SEED), si se sabe. */
  seed: z.number().int().nullable(),
  /** Día real en que se jugó (AAAA-MM-DD), para la marca «Repetición de una partida real». */
  playedOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  /** Modelos que hablaron por los vecinos (IDs públicos, p. ej. «claude-haiku-5-5»), o «mock». */
  models: z.array(z.string().max(80)).max(10),
  /** Versión del código con que se jugó (commit de git, corto). */
  code: z
    .string()
    .regex(/^[0-9a-f]{7,40}$/)
    .nullable(),
  /** Minutos de juego que cubre el paquete. */
  from: z.number(),
  to: z.number(),
  durationMinutes: z.number().nonnegative(),
  /** Baldosas por minuto de juego al andar (para interpolar entre fotos). */
  walkTilesPerMinute: z.number().positive().default(6),
});
export type ReplayMeta = z.infer<typeof ReplayMeta>;

/** Mensajes del servidor que se reproducen (sin costes, estado del director ni deltas). */
export const ReplayServerMessage = z.discriminatedUnion("type", [
  z.object({ type: z.literal("event"), event: SimEvent }),
  z.object({ type: z.literal("drama"), drama: Drama }),
  z.object({ type: z.literal("chronicle"), chronicle: Chronicle }),
  ThinkingMessage,
  MemoryEffectMessage,
  WorldStateMessage,
]);
export type ReplayServerMessage = z.infer<typeof ReplayServerMessage>;

/** Un mensaje con su minuto de juego (los de «pensando» y memoria no lo traen: se deduce). */
export const ReplayMessage = z.object({ t: z.number(), msg: ReplayServerMessage });
export type ReplayMessage = z.infer<typeof ReplayMessage>;

/** Parche de un agente: su id y solo los campos que cambiaron desde la foto anterior. */
export const AgentPatch = AgentState.partial().extend({
  id: z.string(),
  /** Campos opcionales que dejó de tener (`companionId`, `talking`…). */
  unset: z.array(z.string()).optional(),
});
export type AgentPatch = z.infer<typeof AgentPatch>;

/**
 * Foto del estado de los agentes. La primera lleva a todos enteros; las demás, solo los campos
 * que cambiaron de cada uno desde la anterior (el plan del día, casi nunca) y `removed`, los
 * que ya no están.
 */
export const ReplayFrame = z.object({
  time: z.number(),
  agents: z.array(AgentPatch),
  removed: z.array(z.string()).optional(),
});
export type ReplayFrame = z.infer<typeof ReplayFrame>;

/** Pista de posiciones (`record --track`): cada minuto, [id, x, y] de los que se movieron. */
export const ReplayTrack = z.object({
  time: z.number(),
  p: z.array(z.tuple([z.string(), z.number(), z.number()])),
});
export type ReplayTrack = z.infer<typeof ReplayTrack>;

/**
 * Un recuerdo con su fuerza a lo largo de la repetición: muestras [minuto, fuerza, claridad]
 * calculadas al empaquetar con la misma curva de olvido del motor (agent-core). Antes de la
 * primera muestra se usa la fuerza que tenía al recordarlo por última vez.
 */
export const ReplayMemory = MemoryView.extend({
  strengthAt: z.array(z.tuple([z.number(), z.number(), Clarity])),
  /** Cuándo se archivó (resumido en otro), según la auditoría; null si no. */
  archivedAt: z.number().nullable().default(null),
});
export type ReplayMemory = z.infer<typeof ReplayMemory>;

/** Lo de la base de datos (`world:export`) que usan los paneles de la repetición. */
export const ReplayData = z.object({
  memories: z.array(ReplayMemory),
  /** Lo que cambió en la memoria (sin el ruido de archivar o reforzar). */
  audit: z.array(MemoryAuditEntry),
  /** Textos anteriores de cada recuerdo (`at`: cuándo dejó de decir eso). */
  versions: z.array(MemoryVersion),
  profiles: z.array(SocialProfile),
  history: z.array(SocialProfileChange),
  goals: z.array(Goal),
  skills: z.array(SkillState),
  /** Etiquetas del catálogo de habilidades (id → «panadería»). */
  skillLabels: z.record(z.string(), z.string()),
  lore: z.array(Lore),
  holders: z.array(LoreHolder),
});
export type ReplayData = z.infer<typeof ReplayData>;

export const ReplayBundle = z.object({
  format: z.literal(REPLAY_FORMAT),
  version: z.literal(REPLAY_VERSION),
  meta: ReplayMeta,
  /** El mundo (lugares, objetos, colisiones) y el mapa Tiled que lo pinta (del repo). */
  world: World,
  map: z.record(z.string(), z.unknown()),
  messages: z.array(ReplayMessage),
  frames: z.array(ReplayFrame).min(1),
  track: z.array(ReplayTrack).optional(),
  data: ReplayData.optional(),
});
export type ReplayBundle = z.infer<typeof ReplayBundle>;

/** Vacío para los paneles cuando el paquete no trae la base de datos. */
export const EMPTY_REPLAY_DATA: ReplayData = {
  memories: [],
  audit: [],
  versions: [],
  profiles: [],
  history: [],
  goals: [],
  skills: [],
  skillLabels: {},
  lore: [],
  holders: [],
};
