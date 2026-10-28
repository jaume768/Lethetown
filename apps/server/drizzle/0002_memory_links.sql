ALTER TABLE "memories" ADD COLUMN "event_id" text;--> statement-breakpoint
ALTER TABLE "memories" ADD COLUMN "links" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "memories" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "memories" ADD COLUMN "forgotten_at" double precision;--> statement-breakpoint
CREATE INDEX "memories_event_idx" ON "memories" USING btree ("event_id");