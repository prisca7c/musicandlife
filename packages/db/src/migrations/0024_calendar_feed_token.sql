ALTER TABLE "families" ADD COLUMN "calendar_token" text;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "families_calendar_token_uidx" ON "families" USING btree ("calendar_token");