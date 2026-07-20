import { sql } from 'drizzle-orm';
import type { DbService } from '../db/db.service';

// Cron jobs fire in EVERY running API instance. To stay correct if the app is
// ever scaled past one instance, each scheduled job runs under a Postgres
// advisory lock: whichever instance grabs it runs the job; the others get
// `false` and skip. Uses Postgres (already a dependency), so no external
// coordinator/Redis is needed.
//
// The lock is taken as a TRANSACTION-scoped lock (pg_try_advisory_xact_lock)
// rather than a session-scoped one: the db here is a postgres.js pool, so a
// session lock acquired on one pooled connection couldn't be released on
// another (it would leak and permanently skip the job). A transaction keeps the
// lock on a single connection and releases it automatically when the wrapping
// transaction ends — after `fn` has run. `fn`'s own writes use the normal pool;
// the empty wrapping transaction just holds the mutex for the job's duration.
export async function withAdvisoryLock(
  db: DbService['db'],
  key: number,
  fn: () => Promise<void>,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const res = (await tx.execute(
      sql`SELECT pg_try_advisory_xact_lock(${key}) AS locked`,
    )) as unknown as { locked: boolean }[];
    if (!res[0]?.locked) return false;
    await fn();
    return true;
  });
}
