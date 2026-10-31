CREATE TABLE "knowledge_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"world_id" text NOT NULL,
	"at" double precision NOT NULL,
	"agent_id" text,
	"kind" text NOT NULL,
	"term" text NOT NULL,
	"label" text NOT NULL,
	"text" text NOT NULL,
	"source" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "knowledge_log" ADD CONSTRAINT "knowledge_log_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "knowledge_log_world_at_idx" ON "knowledge_log" USING btree ("world_id","at");