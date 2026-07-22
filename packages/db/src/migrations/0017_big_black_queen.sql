-- Guarded so a replay or a partially-applied run can't abort the migration and
-- freeze every deploy the way 0013 did.
ALTER TABLE "lesson_requests" ADD COLUMN IF NOT EXISTS "counter_starts_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "lesson_requests" ADD COLUMN IF NOT EXISTS "counter_starts_at_2" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "lesson_requests" ADD COLUMN IF NOT EXISTS "counter_starts_at_3" timestamp with time zone;
