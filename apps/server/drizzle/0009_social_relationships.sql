CREATE TABLE "social_profile_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"world_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"about_id" text NOT NULL,
	"at" double precision NOT NULL,
	"affinity" real NOT NULL,
	"trust" real NOT NULL,
	"familiarity" real NOT NULL,
	"relationship_type" text NOT NULL,
	"reason" text NOT NULL,
	"event_id" text
);
--> statement-breakpoint
ALTER TABLE "social_profiles" ADD COLUMN "familiarity" real DEFAULT 0.1 NOT NULL;--> statement-breakpoint
ALTER TABLE "social_profiles" ADD COLUMN "relationship_type" text DEFAULT 'neighbor' NOT NULL;--> statement-breakpoint
ALTER TABLE "social_profiles" ADD COLUMN "bond" text;--> statement-breakpoint
ALTER TABLE "social_profiles" ADD COLUMN "grudge" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "social_profile_history" ADD CONSTRAINT "social_profile_history_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "social_history_world_owner_idx" ON "social_profile_history" USING btree ("world_id","owner_id","about_id","at");--> statement-breakpoint
CREATE INDEX "social_history_world_at_idx" ON "social_profile_history" USING btree ("world_id","at");