-- Add is_trial_lesson column to lessons
ALTER TABLE "lessons" ADD COLUMN IF NOT EXISTS "is_trial_lesson" boolean DEFAULT false NOT NULL;
--> statement-breakpoint

-- Create lesson_credits table (replaces makeup_credits)
CREATE TABLE IF NOT EXISTS "lesson_credits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"enrollment_id" uuid,
	"type" text NOT NULL,
	"source_lesson_id" uuid,
	"source_payment_id" uuid,
	"used_in_lesson_id" uuid,
	"status" text DEFAULT 'available' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- Migrate existing makeup_credits into lesson_credits
INSERT INTO "lesson_credits" (
	"id", "organization_id", "student_id", "source_lesson_id",
	"type", "status", "created_at"
)
SELECT
	"id", "organization_id", "student_id", "source_lesson_id",
	'makeup' AS "type",
	CASE WHEN "status" = 'used' THEN 'used' ELSE 'available' END AS "status",
	"created_at"
FROM "makeup_credits";
--> statement-breakpoint

-- Drop old makeup_credits table
DROP TABLE IF EXISTS "makeup_credits";
--> statement-breakpoint

-- Add payment methods for gocardless and revolut
-- (no-op: status/method columns are plain text, enum enforced at app layer only)

-- Foreign keys for lesson_credits
DO $$ BEGIN
 ALTER TABLE "lesson_credits" ADD CONSTRAINT "lesson_credits_organization_id_organizations_id_fk"
   FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lesson_credits" ADD CONSTRAINT "lesson_credits_student_id_students_id_fk"
   FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lesson_credits" ADD CONSTRAINT "lesson_credits_enrollment_id_enrollments_id_fk"
   FOREIGN KEY ("enrollment_id") REFERENCES "public"."enrollments"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lesson_credits" ADD CONSTRAINT "lesson_credits_source_lesson_id_lessons_id_fk"
   FOREIGN KEY ("source_lesson_id") REFERENCES "public"."lessons"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lesson_credits" ADD CONSTRAINT "lesson_credits_source_payment_id_payments_id_fk"
   FOREIGN KEY ("source_payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lesson_credits" ADD CONSTRAINT "lesson_credits_used_in_lesson_id_lessons_id_fk"
   FOREIGN KEY ("used_in_lesson_id") REFERENCES "public"."lessons"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "lesson_credits_student_status_idx" ON "lesson_credits" USING btree ("student_id","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lesson_credits_org_idx" ON "lesson_credits" USING btree ("organization_id");
