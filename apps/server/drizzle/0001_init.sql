CREATE TABLE "llm_calls" (
	"id" serial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"model" text NOT NULL,
	"task" text NOT NULL,
	"agent_id" text,
	"input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"cache_read_tokens" integer NOT NULL,
	"cache_write_tokens" integer NOT NULL,
	"usd" double precision NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memories" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"text" text NOT NULL,
	"gist" text,
	"embedding" vector(384) NOT NULL,
	"created_at" double precision NOT NULL,
	"last_accessed_at" double precision NOT NULL,
	"importance" integer NOT NULL,
	"emotional_valence" real NOT NULL,
	"strength" real NOT NULL,
	"stability" real NOT NULL,
	"access_count" integer DEFAULT 0 NOT NULL,
	"source" text NOT NULL,
	"type" text NOT NULL,
	"people" text[] DEFAULT '{}' NOT NULL,
	"place_id" text
);
--> statement-breakpoint
CREATE INDEX "memories_agent_idx" ON "memories" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "memories_embedding_idx" ON "memories" USING hnsw ("embedding" vector_cosine_ops);