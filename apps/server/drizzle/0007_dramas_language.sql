CREATE TABLE "dramas" (
	"id" text PRIMARY KEY NOT NULL,
	"world_id" text NOT NULL,
	"time" double precision NOT NULL,
	"kind" text NOT NULL,
	"score" real NOT NULL,
	"title" text NOT NULL,
	"agents" text[] DEFAULT '{}' NOT NULL,
	"place_id" text,
	"event_id" text
);
--> statement-breakpoint
ALTER TABLE "worlds" ADD COLUMN "language" text DEFAULT 'es' NOT NULL;--> statement-breakpoint
ALTER TABLE "dramas" ADD CONSTRAINT "dramas_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dramas_world_time_idx" ON "dramas" USING btree ("world_id","time");