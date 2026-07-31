-- `trial_rate` was already added by 0026_enrollment_trial_rate.sql but never
-- recorded in the migration snapshot, so drizzle re-emits it here. Made
-- idempotent (IF NOT EXISTS) so it's a harmless no-op on any environment that
-- already ran 0026, while keeping the snapshot in sync to stop the drift
-- resurfacing on every future generate.
ALTER TABLE "enrollments" ADD COLUMN IF NOT EXISTS "trial_rate" integer;--> statement-breakpoint
-- One payroll run per teacher per period (closes the check-then-insert race in
-- PayrollService). NOTE: this will fail if duplicate runs already exist — run
-- the pre-check in the PR description and de-duplicate first if it returns rows.
CREATE UNIQUE INDEX IF NOT EXISTS "payroll_runs_period_uq" ON "payroll_runs" USING btree ("organization_id","staff_id","period_start","period_end");