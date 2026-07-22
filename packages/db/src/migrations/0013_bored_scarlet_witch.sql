-- Fully idempotent rooms removal. `DROP TABLE "rooms" CASCADE` already drops the
-- three FK constraints that reference rooms, so the explicit DROP CONSTRAINT
-- statements below must be IF EXISTS or migrate aborts with
-- `constraint "..." does not exist` (the whole migration then rolls back and
-- every deploy fails at this step). Guarding every statement also makes the
-- migration safe to run whether or not `rooms` was already dropped.
ALTER TABLE IF EXISTS "rooms" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE IF EXISTS "rooms" CASCADE;--> statement-breakpoint
ALTER TABLE "lesson_requests" DROP CONSTRAINT IF EXISTS "lesson_requests_room_id_rooms_id_fk";
--> statement-breakpoint
ALTER TABLE "lessons" DROP CONSTRAINT IF EXISTS "lessons_room_id_rooms_id_fk";
--> statement-breakpoint
ALTER TABLE "reschedule_requests" DROP CONSTRAINT IF EXISTS "reschedule_requests_proposed_room_id_rooms_id_fk";
--> statement-breakpoint
DROP INDEX IF EXISTS "lessons_org_room_starts_idx";--> statement-breakpoint
ALTER TABLE "lesson_requests" DROP COLUMN IF EXISTS "room_id";--> statement-breakpoint
ALTER TABLE "lessons" DROP COLUMN IF EXISTS "room_id";--> statement-breakpoint
ALTER TABLE "reschedule_requests" DROP COLUMN IF EXISTS "proposed_room_id";
