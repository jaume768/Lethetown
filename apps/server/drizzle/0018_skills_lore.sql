CREATE TABLE "lore" (
	"world_id" text NOT NULL,
	"id" text NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"skill" text,
	"place_id" text,
	"elements" jsonb NOT NULL,
	"origin" jsonb NOT NULL,
	"created_at" double precision NOT NULL,
	"lost_at" double precision,
	CONSTRAINT "lore_world_id_id_pk" PRIMARY KEY("world_id","id")
);
--> statement-breakpoint
CREATE TABLE "lore_holders" (
	"world_id" text NOT NULL,
	"lore_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"fidelity" real NOT NULL,
	"elements" jsonb NOT NULL,
	"learned_from" text,
	"learned_at" double precision NOT NULL,
	"last_used_at" double precision,
	"forgotten_at" double precision,
	CONSTRAINT "lore_holders_world_id_lore_id_agent_id_pk" PRIMARY KEY("world_id","lore_id","agent_id")
);
--> statement-breakpoint
CREATE TABLE "skills" (
	"world_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"skill" text NOT NULL,
	"level" real NOT NULL,
	"peak" real NOT NULL,
	"practice_minutes" double precision DEFAULT 0 NOT NULL,
	"last_used_at" double precision,
	"learned_from" text,
	"history" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" double precision NOT NULL,
	CONSTRAINT "skills_world_id_agent_id_skill_pk" PRIMARY KEY("world_id","agent_id","skill")
);
--> statement-breakpoint
ALTER TABLE "lore" ADD CONSTRAINT "lore_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lore_holders" ADD CONSTRAINT "lore_holders_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skills" ADD CONSTRAINT "skills_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE cascade ON UPDATE no action;