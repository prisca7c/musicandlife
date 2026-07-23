-- Drop `staff_availability`: an exact duplicate of `availability`
-- (schema/scheduling.ts) that nothing in the API ever read. The slot generator,
-- the booking conflict check and every availability endpoint use
-- `availability`; the only writer of this table was the QA seed, which left
-- those teachers with no bookable hours at all.
--
-- IF EXISTS on purpose. Migrations run in a transaction as a pre-deploy step,
-- so a single statement that fails on replay rolls the whole thing back and
-- freezes every future deploy — which is what migration 0013 did.
DROP TABLE IF EXISTS "staff_availability" CASCADE;
