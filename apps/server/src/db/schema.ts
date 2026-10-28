import {
  doublePrecision,
  index,
  integer,
  pgTable,
  primaryKey,
  real,
  serial,
  text,
  timestamp,
  vector,
} from "drizzle-orm/pg-core";

export const memories = pgTable(
  "memories",
  {
    id: text("id").primaryKey(),
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
  },
  (t) => [
    index("memories_agent_idx").on(t.agentId),
    index("memories_event_idx").on(t.eventId),
    index("memories_embedding_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
  ],
);

export const llmCalls = pgTable("llm_calls", {
  id: serial("id").primaryKey(),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  model: text("model").notNull(),
  task: text("task").notNull(),
  agentId: text("agent_id"),
  inputTokens: integer("input_tokens").notNull(),
  outputTokens: integer("output_tokens").notNull(),
  cacheReadTokens: integer("cache_read_tokens").notNull(),
  cacheWriteTokens: integer("cache_write_tokens").notNull(),
  usd: doublePrecision("usd").notNull(),
});

/** Historial de versiones de un recuerdo (reconsolidación, confusión de fuente). */
export const memoryVersions = pgTable(
  "memory_versions",
  {
    id: serial("id").primaryKey(),
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
    agentId: text("agent_id").notNull(),
    memoryId: text("memory_id").notNull(),
    memoryText: text("memory_text").notNull(),
    action: text("action").notNull(),
    reason: text("reason").notNull(),
    at: doublePrecision("at").notNull(),
  },
  (t) => [index("memory_audit_agent_idx").on(t.agentId)],
);

export const socialProfiles = pgTable(
  "social_profiles",
  {
    ownerId: text("owner_id").notNull(),
    aboutId: text("about_id").notNull(),
    summary: text("summary").notNull(),
    affinity: real("affinity").notNull(),
    trust: real("trust").notNull(),
    lastUpdated: doublePrecision("last_updated").notNull(),
  },
  (t) => [primaryKey({ columns: [t.ownerId, t.aboutId] })],
);

/** Línea de tiempo: todos los eventos de la simulación. */
export const simEvents = pgTable(
  "sim_events",
  {
    id: text("id").primaryKey(),
    time: doublePrecision("time").notNull(),
    agentId: text("agent_id"),
    kind: text("kind").notNull(),
    text: text("text").notNull(),
    participants: text("participants").array().notNull().default([]),
  },
  (t) => [index("sim_events_time_idx").on(t.time)],
);

export const chronicles = pgTable("chronicles", {
  day: integer("day").primaryKey(),
  title: text("title").notNull(),
  text: text("text").notNull(),
});
