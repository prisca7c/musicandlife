import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(__dirname, '../../../.env') });

import { eq } from 'drizzle-orm';
import { createDb, organizations, users, memberships } from './index';
import { hash } from 'argon2';

const db = createDb(process.env.DATABASE_URL!);

async function seedAdmin() {
  console.log('Seeding org + admin user only (no demo data)…');

  await db.insert(organizations)
    .values({ name: 'Music & Life', slug: 'music-and-life', timezone: 'Europe/London', currency: 'GBP', country: 'GB' })
    .onConflictDoNothing();

  const org = await db.query.organizations.findFirst({ where: eq(organizations.slug, 'music-and-life') });
  if (!org) { console.error('Could not find org'); process.exit(1); }

  const adminEmail = process.env.SEED_ADMIN_EMAIL!;
  const adminHash = await hash(process.env.SEED_ADMIN_PASSWORD!);
  const [admin] = await db
    .insert(users)
    .values({ email: adminEmail, passwordHash: adminHash, emailVerifiedAt: new Date() })
    .onConflictDoNothing()
    .returning();

  if (admin) {
    await db.insert(memberships).values({ userId: admin.id, organizationId: org.id, baseRole: 'admin' }).onConflictDoNothing();
    console.log(`Admin created: ${adminEmail}`);
  } else {
    console.log(`User ${adminEmail} already exists — no changes made.`);
  }

  console.log('Done ✓');
  process.exit(0);
}

seedAdmin().catch((err) => { console.error(err); process.exit(1); });
