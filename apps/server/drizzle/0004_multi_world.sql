-- Multi-mundo: tabla worlds, world_id en todas las tablas (los datos existentes pasan al mundo
-- "default") e instantáneas del estado de simulación.
CREATE TABLE "worlds" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"map" text NOT NULL,
	"seed" integer,
	"status" text DEFAULT 'running' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
INSERT INTO "worlds" ("id", "name", "map") VALUES ('default', 'Lethetown', 'seeds/town.tmj');
--> statement-breakpoint
CREATE TABLE "world_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"world_id" text NOT NULL,
	"game_time" double precision NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reason" text NOT NULL,
	"data" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chronicles" ADD COLUMN "world_id" text NOT NULL DEFAULT 'default';--> statement-breakpoint
ALTER TABLE "llm_calls" ADD COLUMN "world_id" text NOT NULL DEFAULT 'default';--> statement-breakpoint
ALTER TABLE "memories" ADD COLUMN "world_id" text NOT NULL DEFAULT 'default';--> statement-breakpoint
ALTER TABLE "memory_audit" ADD COLUMN "world_id" text NOT NULL DEFAULT 'default';--> statement-breakpoint
ALTER TABLE "memory_versions" ADD COLUMN "world_id" text NOT NULL DEFAULT 'default';--> statement-breakpoint
ALTER TABLE "sim_events" ADD COLUMN "world_id" text NOT NULL DEFAULT 'default';--> statement-breakpoint
ALTER TABLE "social_profiles" ADD COLUMN "world_id" text NOT NULL DEFAULT 'default';--> statement-breakpoint
ALTER TABLE "chronicles" ALTER COLUMN "world_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "llm_calls" ALTER COLUMN "world_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "memories" ALTER COLUMN "world_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "memory_audit" ALTER COLUMN "world_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "memory_versions" ALTER COLUMN "world_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "sim_events" ALTER COLUMN "world_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "social_profiles" ALTER COLUMN "world_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "chronicles" DROP CONSTRAINT IF EXISTS "chronicles_pkey";--> statement-breakpoint
ALTER TABLE "chronicles" ADD CONSTRAINT "chronicles_world_id_day_pk" PRIMARY KEY("world_id","day");--> statement-breakpoint
ALTER TABLE "social_profiles" DROP CONSTRAINT "social_profiles_owner_id_about_id_pk";--> statement-breakpoint
ALTER TABLE "social_profiles" ADD CONSTRAINT "social_profiles_world_id_owner_id_about_id_pk" PRIMARY KEY("world_id","owner_id","about_id");--> statement-breakpoint
DROP INDEX "memories_agent_idx";--> statement-breakpoint
DROP INDEX "memories_event_idx";--> statement-breakpoint
DROP INDEX "memory_audit_agent_idx";--> statement-breakpoint
DROP INDEX "sim_events_time_idx";--> statement-breakpoint
ALTER TABLE "world_snapshots" ADD CONSTRAINT "world_snapshots_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chronicles" ADD CONSTRAINT "chronicles_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_calls" ADD CONSTRAINT "llm_calls_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memories" ADD CONSTRAINT "memories_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_audit" ADD CONSTRAINT "memory_audit_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_versions" ADD CONSTRAINT "memory_versions_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sim_events" ADD CONSTRAINT "sim_events_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_profiles" ADD CONSTRAINT "social_profiles_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "world_snapshots_world_idx" ON "world_snapshots" USING btree ("world_id","id");--> statement-breakpoint
CREATE INDEX "llm_calls_world_at_idx" ON "llm_calls" USING btree ("world_id","at");--> statement-breakpoint
CREATE INDEX "memories_world_agent_idx" ON "memories" USING btree ("world_id","agent_id");--> statement-breakpoint
CREATE INDEX "memories_world_event_idx" ON "memories" USING btree ("world_id","event_id");--> statement-breakpoint
CREATE INDEX "memory_audit_world_agent_idx" ON "memory_audit" USING btree ("world_id","agent_id");--> statement-breakpoint
CREATE INDEX "sim_events_world_time_idx" ON "sim_events" USING btree ("world_id","time");
