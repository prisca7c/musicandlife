ALTER TABLE "rooms" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "rooms" CASCADE;--> statement-breakpoint
ALTER TABLE "lesson_requests" DROP CONSTRAINT "lesson_requests_room_id_rooms_id_fk";
--> statement-breakpoint
ALTER TABLE "lessons" DROP CONSTRAINT "lessons_room_id_rooms_id_fk";
--> statement-breakpoint
ALTER TABLE "reschedule_requests" DROP CONSTRAINT "reschedule_requests_proposed_room_id_rooms_id_fk";
--> statement-breakpoint
DROP INDEX IF EXISTS "lessons_org_room_starts_idx";--> statement-breakpoint
ALTER TABLE "lesson_requests" DROP COLUMN IF EXISTS "room_id";--> statement-breakpoint
ALTER TABLE "lessons" DROP COLUMN IF EXISTS "room_id";--> statement-breakpoint
ALTER TABLE "reschedule_requests" DROP COLUMN IF EXISTS "proposed_room_id";