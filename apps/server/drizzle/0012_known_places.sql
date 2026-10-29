CREATE TABLE "known_places" (
	"world_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"place_id" text NOT NULL,
	"source" text NOT NULL,
	"learned_at" double precision NOT NULL,
	"told_by" text,
	CONSTRAINT "known_places_world_id_agent_id_place_id_pk" PRIMARY KEY("world_id","agent_id","place_id")
);
--> statement-breakpoint
ALTER TABLE "known_places" ADD CONSTRAINT "known_places_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE cascade ON UPDATE no action;