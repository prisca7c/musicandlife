import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(__dirname, '../../../.env') });
import { eq, and } from 'drizzle-orm';
import { createDb, organizations, staffMembers, users, passwordResetTokens } from '../src/index';

async function main() {
  const db = createDb(process.env.DATABASE_URL!);
  const org = await db.query.organizations.findFirst({ where: eq(organizations.slug, 'music-and-life') });
  const all = await db.query.staffMembers.findMany({
    where: and(eq(staffMembers.organizationId, org!.id), eq(staffMembers.status, 'active')),
    with: { user: true },
    orderBy: (s, { asc }) => [asc(s.firstName), asc(s.lastName)],
  });
  console.log(`${all.length} active staff members:`);
  for (const s of all) {
    if (!s.user) {
      console.log(`  ${s.firstName} ${s.lastName}: NO LINKED USER ACCOUNT`);
      continue;
    }
    const tokens = await db.query.passwordResetTokens.findMany({
      where: eq(passwordResetTokens.userId, s.user.id),
      orderBy: (t, { desc }) => [desc(t.createdAt)],
    });
    const pending = s.user.passwordHash === 'INVITE_PENDING';
    const latest = tokens[0];
    console.log(
      `  ${s.firstName} ${s.lastName} <${s.user.email}> — password ${pending ? 'NOT SET (invite pending)' : 'set'}, ` +
      `invite tokens: ${tokens.length}${latest ? `, last issued ${latest.createdAt.toISOString()}, expires ${latest.expiresAt.toISOString()}` : ''}`,
    );
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
