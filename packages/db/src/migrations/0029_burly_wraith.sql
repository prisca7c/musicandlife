ALTER TABLE "staff_members" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "staff_members" ADD COLUMN "address" text;--> statement-breakpoint
ALTER TABLE "staff_members" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "staff_members" ADD COLUMN "group_tags" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "staff_members" ADD COLUMN "initial_lesson_category" text;--> statement-breakpoint
ALTER TABLE "staff_members" ADD COLUMN "payroll_balance" integer DEFAULT 0 NOT NULL;