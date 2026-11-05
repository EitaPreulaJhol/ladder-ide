CREATE TABLE "shares" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"schema_version" integer NOT NULL,
	"project" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "shares_created_at_idx" ON "shares" USING btree ("created_at");