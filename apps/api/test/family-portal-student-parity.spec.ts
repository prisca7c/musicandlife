import {
  FamilyPortalController, currentStudioWeekMonday, mergeSlotsIntoWindows,
} from '../src/family-portal/family-portal.controller';
import { ROLES_KEY } from '../src/auth/decorators/roles.decorator';
import type { RequestUser } from '@music-life/types';

/**
 * The owner wants the student portal at full parity with the parent portal —
 * a "student" login may be an adult with no guardian account at all, managing
 * their own booking and money. This used to be gated in two different ways:
 *
 *  1. `dashboard()` zeroed out `balance`/`outstandingInvoice` whenever the
 *     viewer was a student, even though the family's real numbers are the
 *     same regardless of who's looking.
 *  2. Several endpoints (`mark-paid`, `payment-details`,
 *     `resource-subscription` get+subscribe, `invoices`) were `@Roles('guardian')`,
 *     which the hierarchical RolesGuard treats as EXCLUDING student (10 < 20)
 *     even though the handlers already scope to `requireFamily()`, the same
 *     scoping a student already gets on booking/cancel/notes.
 */

describe('FamilyPortalController.dashboard — money parity for a student viewer', () => {
  function makeController(viewerRole: 'student' | 'guardian', selfId: string) {
    const family = {
      id: 'fam-1',
      balanceCached: -4500,
      students: [{ id: selfId, firstName: 'Al', lastName: 'Ex', status: 'active', enrollments: [] }],
    };
    const db = {
      db: {
        query: {
          guardians: { findFirst: async () => (viewerRole === 'guardian' ? { familyId: 'fam-1' } : undefined) },
          students: {
            findFirst: async (arg: unknown) => {
              // resolveFamilyId's student lookup vs dashboard's "self" lookup —
              // both want the same row here.
              void arg;
              return viewerRole === 'student' ? { id: selfId, familyId: 'fam-1' } : undefined;
            },
          },
          families: { findFirst: async () => family },
          lessons: { findFirst: async () => undefined },
          notes: { findFirst: async () => undefined },
          invoices: {
            findFirst: async () => ({
              id: 'inv-1', number: 'INV-0009', total: 4500, dueDate: '2026-08-20', status: 'sent',
            }),
          },
        },
      },
    };
    const attendance = { getLessonCreditBalance: async () => ({ total: 3, prepaid: 3, makeup: 0 }) };
    return new FamilyPortalController(
      db as never, {} as never, attendance as never, {} as never, {} as never, {} as never, {} as never,
    );
  }

  const user = (role: 'student' | 'guardian'): RequestUser =>
    ({ userId: 'u-1', orgId: 'org-1', role } as unknown as RequestUser);

  it('a student viewer sees the same real balance a guardian would, not zero', async () => {
    const ctrl = makeController('student', 's-me');
    const out = await ctrl.dashboard(user('student'));
    expect(out.viewer).toBe('student');
    expect(out.balance).toBe(-4500);
  });

  it('a student viewer sees their outstanding invoice, not null', async () => {
    const ctrl = makeController('student', 's-me');
    const out = await ctrl.dashboard(user('student'));
    expect(out.outstandingInvoice).not.toBeNull();
    expect(out.outstandingInvoice?.number).toBe('INV-0009');
  });

  it('a guardian viewer still sees the same real numbers (unchanged behaviour)', async () => {
    const ctrl = makeController('guardian', 's-me');
    const out = await ctrl.dashboard(user('guardian'));
    expect(out.balance).toBe(-4500);
    expect(out.outstandingInvoice?.number).toBe('INV-0009');
  });
});

describe('FamilyPortalController — money/billing endpoints admit a student caller', () => {
  const rolesFor = (method: string) =>
    Reflect.getMetadata(ROLES_KEY, (FamilyPortalController.prototype as never as Record<string, unknown>)[method] as object);

  it.each([
    'markInvoicePaid', 'getPaymentDetails', 'getResourceSubscription', 'subscribeResources', 'getFamilyInvoices',
  ])('%s is @Roles("student"), admitting a student caller (guardian=20 > student=10 in the hierarchy, so a plain @Roles("guardian") excludes students)', (method) => {
    expect(rolesFor(method)).toEqual(['student']);
  });
});

describe('currentStudioWeekMonday', () => {
  it('returns the Monday of the studio-local week as YYYY-MM-DD', () => {
    // Real Date is used (not mocked) — just assert the shape and that it lands
    // on a Monday, since the exact date depends on when the suite runs.
    const monday = currentStudioWeekMonday('Europe/London');
    expect(monday).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const dow = new Date(`${monday}T12:00:00Z`).getUTCDay();
    expect(dow).toBe(1); // Monday
  });
});

describe('mergeSlotsIntoWindows', () => {
  const tz = 'Europe/London';
  const slot = (dateIso: string) => ({ startsAt: dateIso });

  it('merges consecutive 15-minute-apart starts into one contiguous window', () => {
    // 14:00, 14:15, 14:30 UTC on a Monday in winter (GMT, no DST offset) — a
    // family could book any of these as a 60-minute lesson start, so the
    // widget should show one shaded block, not three specks.
    const slots = [
      slot('2026-01-05T14:00:00.000Z'),
      slot('2026-01-05T14:15:00.000Z'),
      slot('2026-01-05T14:30:00.000Z'),
    ];
    const windows = mergeSlotsIntoWindows(slots, 60, tz);
    expect(windows).toHaveLength(1);
    expect(windows[0]).toMatchObject({ weekday: 'monday', startTime: '14:00', endTime: '15:30' });
  });

  it('splits into separate windows when there is a gap (a booked lesson in between)', () => {
    const slots = [
      slot('2026-01-05T14:00:00.000Z'),
      // 15:30 is booked, so 15:00 isn't offered — 16:00 starts a new window.
      slot('2026-01-05T16:00:00.000Z'),
    ];
    const windows = mergeSlotsIntoWindows(slots, 60, tz);
    expect(windows).toHaveLength(2);
    expect(windows[0]).toMatchObject({ startTime: '14:00', endTime: '15:00' });
    expect(windows[1]).toMatchObject({ startTime: '16:00', endTime: '17:00' });
  });

  it('keeps different weekdays in separate windows even with matching times', () => {
    const slots = [slot('2026-01-05T14:00:00.000Z'), slot('2026-01-06T14:00:00.000Z')];
    const windows = mergeSlotsIntoWindows(slots, 60, tz);
    expect(windows.map(w => w.weekday)).toEqual(['monday', 'tuesday']);
  });
});
