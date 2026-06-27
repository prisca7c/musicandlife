-- Fix pre-existing drift: makeup_credits was dropped in 0008 but never removed from the snapshot history.
-- This statement is a no-op against a real database (table is already gone); it just keeps drizzle-kit's
-- bookkeeping consistent with reality going forward.
DROP TABLE IF EXISTS "makeup_credits" CASCADE;
--> statement-breakpoint

-- Remove the AI recording/transcription pipeline and practice log — both unused, descoped.
DROP TABLE IF EXISTS "lesson_summaries" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "ai_jobs" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "transcripts" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "recordings" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "practice_logs" CASCADE;
--> statement-breakpoint

-- enrollments: duration that `rate` corresponds to, for duration-proration + the "New Default Lesson" shortcut
ALTER TABLE "enrollments" ADD COLUMN IF NOT EXISTS "default_duration" integer DEFAULT 60 NOT NULL;
--> statement-breakpoint

-- families: per-family auto-invoicing settings
ALTER TABLE "families" ADD COLUMN IF NOT EXISTS "billing_start_date" date;
--> statement-breakpoint
ALTER TABLE "families" ADD COLUMN IF NOT EXISTS "billing_mode" text DEFAULT 'postpaid' NOT NULL;
--> statement-breakpoint
ALTER TABLE "families" ADD COLUMN IF NOT EXISTS "invoice_date_offset_days" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "families" ADD COLUMN IF NOT EXISTS "due_date_offset_days" integer DEFAULT 7 NOT NULL;
--> statement-breakpoint
ALTER TABLE "families" ADD COLUMN IF NOT EXISTS "invoice_format" text DEFAULT 'normal' NOT NULL;
--> statement-breakpoint
ALTER TABLE "families" ADD COLUMN IF NOT EXISTS "include_previous_balance" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "families" ADD COLUMN IF NOT EXISTS "auto_email_invoice" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "families" ADD COLUMN IF NOT EXISTS "invoice_footer_note" text;
--> statement-breakpoint

-- families: resource-access subscription (separate fee from lesson billing)
ALTER TABLE "families" ADD COLUMN IF NOT EXISTS "resource_access_paid_until" date;
--> statement-breakpoint

-- resources: filter/search tags (independent of `scope`, which stays the role gate)
ALTER TABLE "resources" ADD COLUMN IF NOT EXISTS "instrument" text;
--> statement-breakpoint
ALTER TABLE "resources" ADD COLUMN IF NOT EXISTS "teacher_id" uuid;
--> statement-breakpoint
ALTER TABLE "resources" ADD COLUMN IF NOT EXISTS "student_id" uuid;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "resources" ADD CONSTRAINT "resources_teacher_id_staff_members_id_fk"
   FOREIGN KEY ("teacher_id") REFERENCES "public"."staff_members"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "resources" ADD CONSTRAINT "resources_student_id_students_id_fk"
   FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- expenses: receipt photo upload
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "receipt_file_id" uuid;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "expenses" ADD CONSTRAINT "expenses_receipt_file_id_files_id_fk"
   FOREIGN KEY ("receipt_file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- email_templates: admin-editable overrides of the hardcoded notification templates
CREATE TABLE IF NOT EXISTS "email_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"template_id" text NOT NULL,
	"subject" text NOT NULL,
	"html" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "email_templates" ADD CONSTRAINT "email_templates_organization_id_organizations_id_fk"
   FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "email_templates_org_template_uidx" ON "email_templates" USING btree ("organization_id","template_id");
--> statement-breakpoint

-- news_posts: studio-wide announcements
CREATE TABLE IF NOT EXISTS "news_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"author_id" uuid,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "news_posts" ADD CONSTRAINT "news_posts_organization_id_organizations_id_fk"
   FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "news_posts" ADD CONSTRAINT "news_posts_author_id_users_id_fk"
   FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "news_posts_org_published_idx" ON "news_posts" USING btree ("organization_id","published_at");
