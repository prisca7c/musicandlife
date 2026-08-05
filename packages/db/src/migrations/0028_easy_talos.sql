-- Canonical weekly-series slot a recurring lesson was materialised for. The
-- recurrence worker dedups on this instead of starts_at, so rescheduling a
-- recurring lesson off its slot no longer makes the next nightly run regenerate
-- a duplicate at the old time (double-billing). Null for one-off lessons.
--
-- No data backfill: is_recurring is not reliably set on materialised rows, so
-- the worker instead ADOPTS any existing lesson sitting exactly on a canonical
-- slot (stamps series_slot_at) on its next pass — self-healing within one run.
-- IF NOT EXISTS so it's a harmless no-op where the column already exists.
ALTER TABLE "lessons" ADD COLUMN IF NOT EXISTS "series_slot_at" timestamp with time zone;
