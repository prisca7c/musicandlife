-- IF NOT EXISTS on purpose: migrations run in a transaction as a pre-deploy
-- step, so one statement failing on replay rolls back the whole batch and
-- freezes every future deploy (see migration 0013).
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "attachments" jsonb DEFAULT '[]'::jsonb NOT NULL;
