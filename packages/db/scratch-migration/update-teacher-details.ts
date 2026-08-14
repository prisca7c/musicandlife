// Populates the 5 teacher records (created during the MMS student/family
// migration as bare name-only stubs) with the full contact/payroll/tag data
// supplied afterward. Matches by first+last name against the org's staff.
// Idempotent — safe to re-run.
import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(__dirname, '../../../.env') });

import { eq, and } from 'drizzle-orm';
import { createDb, organizations, staffMembers } from '../src/index';

const db = createDb(process.env.DATABASE_URL!);

interface TeacherUpdate {
  firstName: string;
  lastName: string;
  phone?: string;
  address?: string;
  notes?: string;
  initialLessonCategory?: string;
  defaultDuration: number;
  hourlyRatePence: number; // 0 = unset ("-" in the source sheet)
  payrollBalancePence: number;
  instruments?: string[];
  groupTags?: string[];
}

const UPDATES: TeacherUpdate[] = [
  {
    firstName: 'Christine', lastName: 'Kim',
    phone: '07510540713',
    initialLessonCategory: 'Vocal Lessons', defaultDuration: 60,
    hourlyRatePence: 5000, payrollBalancePence: 342375,
  },
  {
    firstName: 'Dunni', lastName: 'Oluwayemi',
    phone: '07897752562', address: '17 Park Way, Rickmansworth, WD3 7AU',
    initialLessonCategory: 'Guitar lesson (D)', defaultDuration: 30,
    hourlyRatePence: 4000, payrollBalancePence: 848000,
  },
  {
    firstName: 'Franklin', lastName: 'Tam',
    phone: '07908316123', address: '40 Scarlet Court, Damsel Grove, London, N4 2UG',
    initialLessonCategory: 'Piano Lessons', defaultDuration: 30,
    hourlyRatePence: 3500, payrollBalancePence: 756875,
    instruments: ['piano'],
  },
  {
    firstName: 'Orlando', lastName: 'Bonzi',
    phone: '07498865007',
    initialLessonCategory: 'Guitar lesson', defaultDuration: 30,
    hourlyRatePence: 0, payrollBalancePence: 0,
    instruments: ['guitar', 'ukulele', 'bass guitar'],
  },
  {
    firstName: 'Yanice', lastName: 'Bonzi',
    // Source sheet listed "Full Access" where a phone number would be, with no
    // phone actually given — read as an account-permission flag from the old
    // system (My Music Staff), not contact info. Recorded as a note instead of
    // guessed into the phone field. Flagging for the studio to confirm/adjust.
    notes: 'Marked "Full Access" in the My Music Staff export (likely elevated admin-level access in the old system) — not yet reflected in this app\'s staff privileges. Review and adjust manually if this teacher should have broader access here.',
    initialLessonCategory: 'Violin Lessons', defaultDuration: 30,
    hourlyRatePence: 0, payrollBalancePence: 0,
  },
];

async function main() {
  const org = await db.query.organizations.findFirst({ where: eq(organizations.slug, 'music-and-life') });
  if (!org) throw new Error('Org not found');
  const orgId = org.id;

  for (const u of UPDATES) {
    const staff = await db.query.staffMembers.findFirst({
      where: and(eq(staffMembers.organizationId, orgId), eq(staffMembers.firstName, u.firstName), eq(staffMembers.lastName, u.lastName)),
    });
    if (!staff) {
      console.warn(`✗ No staff record found for ${u.firstName} ${u.lastName} — skipped`);
      continue;
    }
    await db.update(staffMembers).set({
      phone: u.phone ?? null,
      address: u.address ?? null,
      notes: u.notes ?? null,
      initialLessonCategory: u.initialLessonCategory ?? null,
      defaultDuration: u.defaultDuration,
      hourlyRate: u.hourlyRatePence,
      payrollBalance: u.payrollBalancePence,
      instruments: u.instruments ?? [],
      groupTags: u.groupTags ?? [],
      updatedAt: new Date(),
    }).where(eq(staffMembers.id, staff.id));
    console.log(`✓ Updated ${u.firstName} ${u.lastName}`);
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
