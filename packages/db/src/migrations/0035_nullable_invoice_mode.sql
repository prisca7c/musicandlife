ALTER TABLE "families" ALTER COLUMN "invoice_mode" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "families" ALTER COLUMN "invoice_mode" DROP DEFAULT;
