CREATE TABLE IF NOT EXISTS "bank_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"booked_on" date NOT NULL,
	"amount" integer NOT NULL,
	"reference" text,
	"description" text,
	"fingerprint" text NOT NULL,
	"matched_family_id" uuid,
	"matched_claim_id" uuid,
	"payment_id" uuid,
	"status" text DEFAULT 'unmatched' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payment_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"family_id" uuid NOT NULL,
	"invoice_id" uuid,
	"amount" integer NOT NULL,
	"reference" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"matched_transaction_id" uuid,
	"payment_id" uuid,
	"confirmed_by" uuid,
	"confirmed_at" timestamp with time zone,
	"resolved_manually" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "families" ADD COLUMN "payment_reference" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_matched_family_id_families_id_fk" FOREIGN KEY ("matched_family_id") REFERENCES "public"."families"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_matched_claim_id_payment_claims_id_fk" FOREIGN KEY ("matched_claim_id") REFERENCES "public"."payment_claims"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payment_claims" ADD CONSTRAINT "payment_claims_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payment_claims" ADD CONSTRAINT "payment_claims_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payment_claims" ADD CONSTRAINT "payment_claims_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payment_claims" ADD CONSTRAINT "payment_claims_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payment_claims" ADD CONSTRAINT "payment_claims_confirmed_by_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bank_transactions_org_fingerprint_uidx" ON "bank_transactions" USING btree ("organization_id","fingerprint");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bank_transactions_org_status_idx" ON "bank_transactions" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_claims_org_status_idx" ON "payment_claims" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_claims_family_idx" ON "payment_claims" USING btree ("organization_id","family_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "payment_claims_open_invoice_uidx" ON "payment_claims" USING btree ("invoice_id") WHERE "payment_claims"."status" = 'pending' AND "payment_claims"."invoice_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "families_org_payment_reference_uidx" ON "families" USING btree ("organization_id","payment_reference");