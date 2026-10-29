CREATE TABLE "inventory_items" (
	"world_id" text NOT NULL,
	"id" text NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"owner_id" text,
	"holder_id" text,
	"place_id" text,
	"loan" jsonb,
	"value" double precision DEFAULT 0 NOT NULL,
	"created_at" double precision NOT NULL,
	"updated_at" double precision NOT NULL,
	CONSTRAINT "inventory_items_world_id_id_pk" PRIMARY KEY("world_id","id")
);
--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inventory_items_holder_idx" ON "inventory_items" USING btree ("world_id","holder_id");