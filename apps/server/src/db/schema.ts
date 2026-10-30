import type { MemoryMeta } from "@lethetown/shared";
import {
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  serial,
  text,
  timestamp,
  uniqueIndex,
  vector,
} from "drizzle-orm/pg-core";

/** Mundo por defecto: al que se asignan los datos anteriores al multi-mundo y los alias de la API. */
export const DEFAULT_WORLD_ID = "default";

/** Cada pueblo simulado. Todas las demás tablas cuelgan de un mundo. */
export const worlds = pgTable("worlds", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  /** Mapa Tiled (ruta relativa a la raíz del repo, p. ej. seeds/town.tmj). */
  map: text("map").notNull(),
  /** Semilla del azar (null = aleatoria en cada arranque). */
  seed: integer("seed"),
  /** running | paused | stopped. */
  status: text("status").notNull().default("running"),
  /** Idioma en el que hablan y escriben los agentes y el cronista (es | en). */
  language: text("language").notNull().default("es"),
  /** Sistemas desactivados en este mundo (`{ "notes": false }`); los que no aparecen, activos. */
  systems: jsonb("systems").$type<Record<string, boolean>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

const worldId = () =>
  text("world_id")
    .notNull()
    .references(() => worlds.id, { onDelete: "cascade" });

export const memories = pgTable(
  "memories",
  {
    id: text("id").primaryKey(),
    worldId: worldId(),
    agentId: text("agent_id").notNull(),
    text: text("text").notNull(),
    gist: text("gist"),
    embedding: vector("embedding", { dimensions: 384 }).notNull(),
    /** Minutos de juego. */
    createdAt: doublePrecision("created_at").notNull(),
    lastAccessedAt: doublePrecision("last_accessed_at").notNull(),
    importance: integer("importance").notNull(),
    emotionalValence: real("emotional_valence").notNull(),
    strength: real("strength").notNull(),
    stability: real("stability").notNull(),
    accessCount: integer("access_count").notNull().default(0),
    source: text("source").notNull(),
    type: text("type").notNull(),
    people: text("people").array().notNull().default([]),
    placeId: text("place_id"),
    eventId: text("event_id"),
    links: text("links").array().notNull().default([]),
    status: text("status").notNull().default("active"),
    forgottenAt: doublePrecision("forgotten_at"),
    /** Marcas del recuerdo (juventud, falso recuerdo, intención…): ver MemoryMeta. */
    meta: jsonb("meta").$type<MemoryMeta>().notNull().default({}),
  },
  (t) => [
    index("memories_world_agent_idx").on(t.worldId, t.agentId),
    index("memories_world_event_idx").on(t.worldId, t.eventId),
    index("memories_embedding_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
  ],
);

export const llmCalls = pgTable(
  "llm_calls",
  {
    id: serial("id").primaryKey(),
    worldId: worldId(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    model: text("model").notNull(),
    task: text("task").notNull(),
    agentId: text("agent_id"),
    inputTokens: integer("input_tokens").notNull(),
    outputTokens: integer("output_tokens").notNull(),
    cacheReadTokens: integer("cache_read_tokens").notNull(),
    cacheWriteTokens: integer("cache_write_tokens").notNull(),
    usd: doublePrecision("usd").notNull(),
  },
  (t) => [index("llm_calls_world_at_idx").on(t.worldId, t.at)],
);

/** Historial de versiones de un recuerdo (reconsolidación, confusión de fuente). */
export const memoryVersions = pgTable(
  "memory_versions",
  {
    id: serial("id").primaryKey(),
    worldId: worldId(),
    memoryId: text("memory_id").notNull(),
    version: integer("version").notNull(),
    text: text("text").notNull(),
    emotionalValence: real("emotional_valence").notNull(),
    source: text("source").notNull(),
    at: doublePrecision("at").notNull(),
    reason: text("reason").notNull(),
  },
  (t) => [index("memory_versions_memory_idx").on(t.memoryId)],
);

/** Cada decisión de olvido/transformación con su motivo. */
export const memoryAudit = pgTable(
  "memory_audit",
  {
    id: serial("id").primaryKey(),
    worldId: worldId(),
    agentId: text("agent_id").notNull(),
    memoryId: text("memory_id").notNull(),
    memoryText: text("memory_text").notNull(),
    action: text("action").notNull(),
    reason: text("reason").notNull(),
    at: doublePrecision("at").notNull(),
  },
  (t) => [index("memory_audit_world_agent_idx").on(t.worldId, t.agentId)],
);

export const socialProfiles = pgTable(
  "social_profiles",
  {
    worldId: worldId(),
    ownerId: text("owner_id").notNull(),
    aboutId: text("about_id").notNull(),
    summary: text("summary").notNull(),
    affinity: real("affinity").notNull(),
    trust: real("trust").notNull(),
    familiarity: real("familiarity").notNull().default(0.1),
    /** family | friendship | neighbor | work | rivalry | romantic. */
    relationshipType: text("relationship_type").notNull().default("neighbor"),
    /** Vínculo de base de las semillas (family | romantic | work) o null. */
    bond: text("bond"),
    /** Rencor mínimo que dejan las ofensas importantes. */
    grudge: real("grudge").notNull().default(0),
    lastUpdated: doublePrecision("last_updated").notNull(),
  },
  (t) => [primaryKey({ columns: [t.worldId, t.ownerId, t.aboutId] })],
);

/** Historial de las fichas sociales: cada cambio con su motivo (evolución de las relaciones). */
export const socialProfileHistory = pgTable(
  "social_profile_history",
  {
    id: serial("id").primaryKey(),
    worldId: worldId(),
    ownerId: text("owner_id").notNull(),
    aboutId: text("about_id").notNull(),
    /** Minutos de juego. */
    at: doublePrecision("at").notNull(),
    affinity: real("affinity").notNull(),
    trust: real("trust").notNull(),
    familiarity: real("familiarity").notNull(),
    relationshipType: text("relationship_type").notNull(),
    reason: text("reason").notNull(),
    eventId: text("event_id"),
  },
  (t) => [
    index("social_history_world_owner_idx").on(t.worldId, t.ownerId, t.aboutId, t.at),
    index("social_history_world_at_idx").on(t.worldId, t.at),
  ],
);

/** Línea de tiempo: todos los eventos de la simulación. */
export const simEvents = pgTable(
  "sim_events",
  {
    id: text("id").primaryKey(),
    worldId: worldId(),
    time: doublePrecision("time").notNull(),
    agentId: text("agent_id"),
    kind: text("kind").notNull(),
    text: text("text").notNull(),
    participants: text("participants").array().notNull().default([]),
    /** Acción del catálogo que lo produjo y si salió bien ({ action, ok }). */
    meta: jsonb("meta").$type<{ action?: string; ok?: boolean; group?: string[] }>(),
  },
  (t) => [index("sim_events_world_time_idx").on(t.worldId, t.time)],
);

export const chronicles = pgTable(
  "chronicles",
  {
    worldId: worldId(),
    day: integer("day").notNull(),
    title: text("title").notNull(),
    text: text("text").notNull(),
  },
  (t) => [primaryKey({ columns: [t.worldId, t.day] })],
);

/**
 * Instantáneas del estado de simulación (runtime de agentes, objetos, clima y reloj), cada hora
 * de juego y al apagar. Al arrancar se restaura la última.
 */
export const worldSnapshots = pgTable(
  "world_snapshots",
  {
    id: serial("id").primaryKey(),
    worldId: worldId(),
    /** Minutos de juego. */
    gameTime: doublePrecision("game_time").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** hourly | shutdown | manual. */
    reason: text("reason").notNull(),
    data: jsonb("data").notNull(),
  },
  (t) => [index("world_snapshots_world_idx").on(t.worldId, t.id)],
);

// --- Seguridad ------------------------------------------------------------------------------

/**
 * Usuarios con rol. `provider` = "local" (usuario + contraseña argon2) o, más adelante, un
 * proveedor OAuth ("github", "google"...) identificado por `providerSubject`.
 */
export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    username: text("username").notNull(),
    /** viewer | director | admin. */
    role: text("role").notNull(),
    /** Hash argon2id (null en usuarios OAuth). */
    passwordHash: text("password_hash"),
    provider: text("provider").notNull().default("local"),
    providerSubject: text("provider_subject"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("users_username_idx").on(t.username),
    uniqueIndex("users_provider_subject_idx").on(t.provider, t.providerSubject),
  ],
);

/** Sesiones: se guarda el SHA-256 del token, nunca el token (que solo vive en la cookie). */
export const sessions = pgTable(
  "sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

/** Textos de usuario rechazados por la moderación (voz interior, estados de objetos...). */
export const moderationLog = pgTable(
  "moderation_log",
  {
    id: serial("id").primaryKey(),
    worldId: worldId(),
    userId: text("user_id"),
    /** thought | spot | name... */
    kind: text("kind").notNull(),
    text: text("text").notNull(),
    reason: text("reason").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("moderation_log_world_idx").on(t.worldId, t.at)],
);

// --- Procesos separados (api + sim-worker) -------------------------------------------------

/**
 * Qué worker ejecuta cada mundo. Un worker reclama mundos sin dueño o con la lease caducada
 * y la renueva cada pocos segundos; si muere, otro la recoge al caducar.
 */
export const worldLeases = pgTable("world_leases", {
  worldId: text("world_id")
    .primaryKey()
    .references(() => worlds.id, { onDelete: "cascade" }),
  owner: text("owner").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Mensajes del bus demasiado grandes para NOTIFY (límite ~8 KB): se notifica solo el id. */
export const busMessages = pgTable("bus_messages", {
  id: serial("id").primaryKey(),
  payload: jsonb("payload").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Ajustes globales compartidos por todos los procesos (p. ej. el kill switch). */
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Feed de "dramas": eventos de alto interés con dónde y cuándo ocurrieron. */
export const dramas = pgTable(
  "dramas",
  {
    id: text("id").primaryKey(),
    worldId: worldId(),
    time: doublePrecision("time").notNull(),
    kind: text("kind").notNull(),
    score: real("score").notNull(),
    title: text("title").notNull(),
    agents: text("agents").array().notNull().default([]),
    placeId: text("place_id"),
    eventId: text("event_id"),
  },
  (t) => [index("dramas_world_time_idx").on(t.worldId, t.time)],
);

/** Citas entre agentes (compromisos): quién, dónde, cuándo y cómo acabó. */
export const commitments = pgTable(
  "commitments",
  {
    worldId: worldId(),
    /** Id corto dentro del mundo ("c3"). */
    id: text("id").notNull(),
    organizerId: text("organizer_id").notNull(),
    participants: text("participants").array().notNull(),
    responses: jsonb("responses")
      .$type<Record<string, "pending" | "accepted" | "declined">>()
      .notNull(),
    placeId: text("place_id").notNull(),
    /** Minuto de juego en que empieza. */
    at: doublePrecision("at").notNull(),
    reason: text("reason").notNull(),
    /** proposed | accepted | done | failed | cancelled. */
    status: text("status").notNull(),
    arrivals: jsonb("arrivals").$type<Record<string, number>>().notNull().default({}),
    forgot: text("forgot").array().notNull().default([]),
    intentions: jsonb("intentions").$type<Record<string, string>>().notNull().default({}),
    flags: text("flags").array().notNull().default([]),
    createdAt: doublePrecision("created_at").notNull(),
    updatedAt: doublePrecision("updated_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.worldId, t.id] }),
    index("commitments_world_at_idx").on(t.worldId, t.at),
  ],
);

/** Lugares que conoce cada agente (y cómo los conoció). */
export const knownPlaces = pgTable(
  "known_places",
  {
    worldId: worldId(),
    agentId: text("agent_id").notNull(),
    placeId: text("place_id").notNull(),
    /** seed | seen | explored | told. */
    source: text("source").notNull(),
    /** Minuto de juego en que lo conoció. */
    learnedAt: doublePrecision("learned_at").notNull(),
    toldBy: text("told_by"),
  },
  (t) => [primaryKey({ columns: [t.worldId, t.agentId, t.placeId] })],
);

/** Objetos que se llevan encima (inventario), con dueño, quién lo tiene y préstamo. */
export const inventoryItems = pgTable(
  "inventory_items",
  {
    worldId: worldId(),
    /** Id corto dentro del mundo ("i3"). */
    id: text("id").notNull(),
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    ownerId: text("owner_id"),
    holderId: text("holder_id"),
    placeId: text("place_id"),
    loan: jsonb("loan").$type<{
      from: string;
      to: string;
      since: number;
      dueAt: number;
      overdueNoticed: boolean;
    }>(),
    value: doublePrecision("value").notNull().default(0),
    createdAt: doublePrecision("created_at").notNull(),
    updatedAt: doublePrecision("updated_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.worldId, t.id] }),
    index("inventory_items_holder_idx").on(t.worldId, t.holderId),
  ],
);

/** Notas: en el tablón (públicas) o dejadas para alguien (privadas); caducan. */
export const notes = pgTable(
  "notes",
  {
    worldId: worldId(),
    /** Id corto dentro del mundo ("n3"). */
    id: text("id").notNull(),
    authorId: text("author_id").notNull(),
    /** public | private. */
    kind: text("kind").notNull(),
    toId: text("to_id"),
    placeId: text("place_id").notNull(),
    text: text("text").notNull(),
    createdAt: doublePrecision("created_at").notNull(),
    expiresAt: doublePrecision("expires_at").notNull(),
    readBy: text("read_by").array().notNull().default([]),
  },
  (t) => [
    primaryKey({ columns: [t.worldId, t.id] }),
    index("notes_world_expires_idx").on(t.worldId, t.expiresAt),
  ],
);
