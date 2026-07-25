CREATE TABLE IF NOT EXISTS "resource_subscribers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"access_token" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"paid_until" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "resource_subscribers_access_token_unique" UNIQUE("access_token")
);
--> statement-breakpoint
ALTER TABLE "resources" ADD COLUMN IF NOT EXISTS "delivery" text DEFAULT 'download' NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "resource_subscribers" ADD CONSTRAINT "resource_subscribers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "resource_subscribers_org_email_uidx" ON "resource_subscribers" USING btree ("organization_id","email");