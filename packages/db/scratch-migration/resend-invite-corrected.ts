import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(__dirname, '../../../.env') });
import { eq, and } from 'drizzle-orm';
import { randomBytes, createHash } from 'crypto';
import { createDb, organizations, staffMembers, passwordResetTokens } from '../src/index';

function parseAddress(raw: string): { email: string; name?: string } {
  const match = raw.match(/^(.*?)\s*<(.+)>$/);
  return match ? { email: match[2].trim(), name: match[1].trim() || undefined } : { email: raw.trim() };
}

const TARGETS: Array<[string, string]> = [
  ['Christine', 'Kim'],
  ['Dunni', 'Oluwayemi'],
  ['Franklin', 'Tam'],
  ['Orlando', 'Bonzi'],
];

async function sendInvite(db: ReturnType<typeof createDb>, orgId: string, firstName: string, lastName: string) {
  const staff = await db.query.staffMembers.findFirst({
    where: and(eq(staffMembers.organizationId, orgId), eq(staffMembers.firstName, firstName), eq(staffMembers.lastName, lastName)),
    with: { user: true },
  });
  if (!staff || !staff.user) throw new Error(`${firstName} ${lastName}: staff/user record not found`);

  const rawToken = randomBytes(32).toString('hex');
  const tokenHash = createHash('sha256').update(rawToken).digest('hex');
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await db.insert(passwordResetTokens).values({ userId: staff.user.id, tokenHash, expiresAt });

  // Production domain (see apps/api/src/email/branding.ts portalUrl) — NOT the
  // local .env's WEB_URL, which is a dev-only localhost value.
  const link = `https://lirico.uk/reset-password?token=${rawToken}`;
  const subject = "You've been added to Music & Life OS";
  const html = `<p>Hi ${staff.firstName},</p><p>You've been added as a teacher at Music &amp; Life. Set your password to access your portal:</p><p><a href="${link}">Set password</a></p><p>This link expires in 7 days.</p>`;

  const from = parseAddress(process.env.EMAIL_FROM ?? 'Music & Life <no-reply@musiclife.studio>');
  const baseUrl = (process.env.SENDER_API_URL ?? 'https://api.sender.net/v2').replace(/\/$/, '');
  const res = await fetch(`${baseUrl}/message/send`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.SENDER_API_KEY}`,
    },
    body: JSON.stringify({ from, to: parseAddress(staff.user.email), subject, html }),
    signal: AbortSignal.timeout(20_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`${firstName} ${lastName}: send failed ${res.status} ${body}`);
  }
  console.log(`Invite email sent to ${staff.user.email} (${firstName} ${lastName})`);
}

async function main() {
  const db = createDb(process.env.DATABASE_URL!);
  const org = await db.query.organizations.findFirst({ where: eq(organizations.slug, 'music-and-life') });
  for (const [firstName, lastName] of TARGETS) {
    await sendInvite(db, org!.id, firstName, lastName);
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
