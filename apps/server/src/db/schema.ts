import {
  doublePrecision,
  index,
  integer,
  pgTable,
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
  },
  (t) => [
    index("memories_agent_idx").on(t.agentId),
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
