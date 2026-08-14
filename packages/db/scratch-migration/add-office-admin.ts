// Promotes office@musicandlife.co.uk to an admin account (password 'asdf',
// temporary — they can change it from Settings) and emails them the login
// details. Requested directly by the studio owner in chat.
import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(__dirname, '../../../.env') });

import { eq, and } from 'drizzle-orm';
import { hash } from 'argon2';
import { createDb, organizations, users, memberships } from '../src/index';

const EMAIL = 'office@musicandlife.co.uk';
const PASSWORD = 'asdf';

const db = createDb(process.env.DATABASE_URL!);

async function sendWelcomeEmail() {
  const baseUrl = (process.env.SENDER_API_URL ?? 'https://api.sender.net/v2').replace(/\/$/, '');
  const token = process.env.SENDER_API_KEY!;
  const from = process.env.EMAIL_FROM ?? 'Music & Life <no-reply@musiclife.studio>';
  const fromMatch = from.match(/^(.*?)\s*<(.+)>$/);
  const fromAddr = fromMatch ? { email: fromMatch[2].trim(), name: fromMatch[1].trim() || undefined } : { email: from };

  const html = `
  <div style="font-family:'Lexend','Helvetica Neue',Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;background:#f6f4ec;padding:32px 24px">
    <div style="background:#ffffff;border-radius:16px;padding:32px;border:1px solid #e5e2d5">
      <h1 style="color:#1e3a2e;font-size:20px;margin:0 0 16px">Your admin account is ready</h1>
      <p style="color:#33372f;font-size:14px;line-height:22px;margin:0 0 16px">
        You've been given full admin access to the Music &amp; Life studio portal.
      </p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:22px 0;background:#f1efe6;border-radius:12px">
        <tr><td style="padding:16px 20px;font-family:'Lexend',Arial,sans-serif;font-size:14px;line-height:24px;color:#33372f">
          <div style="color:#8a887c;font-size:12px;text-transform:uppercase;letter-spacing:.6px;margin-bottom:6px">Your login details</div>
          <div><strong>Portal:</strong> <a href="https://lirico.uk/login" style="color:#2f6a4d">lirico.uk/login</a></div>
          <div><strong>Email:</strong> ${EMAIL}</div>
          <div><strong>Temporary password:</strong> ${PASSWORD}</div>
        </td></tr>
      </table>
      <p style="color:#8a887c;font-size:13px;line-height:20px;margin:0">
        This is a temporary password — please sign in and change it from Settings when you get a chance.
      </p>
      <table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:28px auto 6px">
        <tr><td style="border-radius:10px;background:#1e3a2e">
          <a href="https://lirico.uk/login" style="display:inline-block;padding:14px 34px;font-family:'Lexend',Arial,sans-serif;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px">Sign in</a>
        </td></tr>
      </table>
    </div>
  </div>`;

  const res = await fetch(`${baseUrl}/message/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      from: fromAddr,
      to: { email: EMAIL },
      subject: 'Your Music & Life admin account',
      html,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Email send failed: ${res.status} ${body}`);
  }
}

async function main() {
  const org = await db.query.organizations.findFirst({ where: eq(organizations.slug, 'music-and-life') });
  if (!org) throw new Error('Org not found');
  const orgId = org.id;

  const passwordHash = await hash(PASSWORD);
  let user = await db.query.users.findFirst({ where: eq(users.email, EMAIL) });
  if (!user) {
    const [created] = await db.insert(users).values({ email: EMAIL, passwordHash, emailVerifiedAt: new Date() }).returning();
    user = created!;
    console.log(`✓ Created user: ${EMAIL}`);
  } else {
    await db.update(users).set({ passwordHash }).where(eq(users.id, user.id));
    console.log(`✓ Updated password for existing user: ${EMAIL}`);
  }

  const existingMembership = await db.query.memberships.findFirst({
    where: and(eq(memberships.userId, user.id), eq(memberships.organizationId, orgId)),
  });
  if (!existingMembership) {
    await db.insert(memberships).values({ userId: user.id, organizationId: orgId, baseRole: 'admin' });
    console.log('✓ Created admin membership');
  } else if (existingMembership.baseRole !== 'admin') {
    await db.update(memberships).set({ baseRole: 'admin' }).where(eq(memberships.id, existingMembership.id));
    console.log(`✓ Promoted existing membership from '${existingMembership.baseRole}' to 'admin'`);
  } else {
    console.log('Already an admin.');
  }

  await sendWelcomeEmail();
  console.log(`✓ Sent welcome email to ${EMAIL}`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
