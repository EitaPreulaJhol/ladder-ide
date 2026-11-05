CREATE TABLE "share_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"share_id" text NOT NULL,
	"reason" text NOT NULL,
	"details" text,
	"reporter_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shares" ADD COLUMN "size_bytes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "shares" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shares" ADD COLUMN "hidden" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "shares" ADD COLUMN "report_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "share_reports" ADD CONSTRAINT "share_reports_share_id_shares_id_fk" FOREIGN KEY ("share_id") REFERENCES "public"."shares"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "share_reports_unique_reporter" ON "share_reports" USING btree ("share_id","reporter_hash");--> statement-breakpoint
CREATE INDEX "shares_expires_at_idx" ON "shares" USING btree ("expires_at");--> statement-breakpoint
UPDATE "shares" SET "size_bytes" = octet_length("project"::text) WHERE "size_bytes" = 0;
