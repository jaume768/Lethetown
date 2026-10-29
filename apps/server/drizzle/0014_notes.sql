CREATE TABLE "notes" (
	"world_id" text NOT NULL,
	"id" text NOT NULL,
	"author_id" text NOT NULL,
	"kind" text NOT NULL,
	"to_id" text,
	"place_id" text NOT NULL,
	"text" text NOT NULL,
	"created_at" double precision NOT NULL,
	"expires_at" double precision NOT NULL,
	"read_by" text[] DEFAULT '{}' NOT NULL,
	CONSTRAINT "notes_world_id_id_pk" PRIMARY KEY("world_id","id")
);
--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notes_world_expires_idx" ON "notes" USING btree ("world_id","expires_at");