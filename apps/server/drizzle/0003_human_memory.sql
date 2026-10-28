CREATE TABLE "chronicles" (
	"day" integer PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"text" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memory_audit" (
	"id" serial PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"memory_id" text NOT NULL,
	"memory_text" text NOT NULL,
	"action" text NOT NULL,
	"reason" text NOT NULL,
	"at" double precision NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memory_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"memory_id" text NOT NULL,
	"version" integer NOT NULL,
	"text" text NOT NULL,
	"emotional_valence" real NOT NULL,
	"source" text NOT NULL,
	"at" double precision NOT NULL,
	"reason" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sim_events" (
	"id" text PRIMARY KEY NOT NULL,
	"time" double precision NOT NULL,
	"agent_id" text,
	"kind" text NOT NULL,
	"text" text NOT NULL,
	"participants" text[] DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_profiles" (
	"owner_id" text NOT NULL,
	"about_id" text NOT NULL,
	"summary" text NOT NULL,
	"affinity" real NOT NULL,
	"trust" real NOT NULL,
	"last_updated" double precision NOT NULL,
	CONSTRAINT "social_profiles_owner_id_about_id_pk" PRIMARY KEY("owner_id","about_id")
);
--> statement-breakpoint
CREATE INDEX "memory_audit_agent_idx" ON "memory_audit" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "memory_versions_memory_idx" ON "memory_versions" USING btree ("memory_id");--> statement-breakpoint
CREATE INDEX "sim_events_time_idx" ON "sim_events" USING btree ("time");