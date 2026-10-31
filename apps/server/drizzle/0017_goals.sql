CREATE TABLE "departures" (
	"world_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"to" text NOT NULL,
	"left_at" double precision NOT NULL,
	"goal_id" text,
	"visits" integer DEFAULT 0 NOT NULL,
	"next_visit_at" double precision,
	"visiting" boolean DEFAULT false NOT NULL,
	CONSTRAINT "departures_world_id_agent_id_pk" PRIMARY KEY("world_id","agent_id")
);
--> statement-breakpoint
CREATE TABLE "goals" (
	"world_id" text NOT NULL,
	"id" text NOT NULL,
	"agent_id" text NOT NULL,
	"level" text NOT NULL,
	"parent_id" text,
	"text" text NOT NULL,
	"status" text NOT NULL,
	"progress" real NOT NULL,
	"motivation" real NOT NULL,
	"frustration" real NOT NULL,
	"criterion" jsonb NOT NULL,
	"measured" double precision DEFAULT 0 NOT NULL,
	"baseline" double precision,
	"seen" text[] DEFAULT '{}' NOT NULL,
	"resource" text,
	"departure" jsonb,
	"created_at" double precision NOT NULL,
	"updated_at" double precision NOT NULL,
	"last_progress_at" double precision NOT NULL,
	"history" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "goals_world_id_id_pk" PRIMARY KEY("world_id","id")
);
--> statement-breakpoint
ALTER TABLE "departures" ADD CONSTRAINT "departures_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "goals_world_agent_idx" ON "goals" USING btree ("world_id","agent_id");