CREATE TABLE "commitments" (
	"world_id" text NOT NULL,
	"id" text NOT NULL,
	"organizer_id" text NOT NULL,
	"participants" text[] NOT NULL,
	"responses" jsonb NOT NULL,
	"place_id" text NOT NULL,
	"at" double precision NOT NULL,
	"reason" text NOT NULL,
	"status" text NOT NULL,
	"arrivals" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"forgot" text[] DEFAULT '{}' NOT NULL,
	"intentions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"flags" text[] DEFAULT '{}' NOT NULL,
	"created_at" double precision NOT NULL,
	"updated_at" double precision NOT NULL,
	CONSTRAINT "commitments_world_id_id_pk" PRIMARY KEY("world_id","id")
);
--> statement-breakpoint
ALTER TABLE "commitments" ADD CONSTRAINT "commitments_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "commitments_world_at_idx" ON "commitments" USING btree ("world_id","at");