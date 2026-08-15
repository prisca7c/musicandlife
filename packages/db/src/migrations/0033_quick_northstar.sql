ALTER TABLE "staff_members" ALTER COLUMN "hourly_rate" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "staff_members" ALTER COLUMN "hourly_rate" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "staff_members" ALTER COLUMN "payroll_balance" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "staff_members" ALTER COLUMN "payroll_balance" DROP NOT NULL;