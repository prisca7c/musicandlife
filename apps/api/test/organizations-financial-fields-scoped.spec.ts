import { OrganizationsService } from '../src/organizations/organizations.service';

/**
 * GET /organizations/me is @Roles('teacher') because automated-hint.tsx
 * (rendered on teacher-visible pages) needs the `automation` flags — but that
 * floor also let any teacher-level JWT read the studio's bank account name/
 * sort code/number, data no teacher-facing UI page ever shows and that
 * billing pages are admin-only. findById must strip those fields for anyone
 * below admin.
 */
const SETTINGS = {
  bankAccountName: 'Music & Life Ltd', bankSortCode: '12-34-56', bankAccountNumber: '12345678',
  invoiceNotes: 'Please pay within 14 days', address: '1 High Street', timezone: 'Europe/London',
};

function makeService() {
  const db = {
    db: {
      query: {
        organizations: {
          findFirst: async () => ({ id: 'org-1', name: 'Music & Life', settings: SETTINGS }),
        },
      },
    },
  };
  return new OrganizationsService(db as never);
}

describe('OrganizationsService.findById — financial fields scoped by role', () => {
  it('hides bank/invoice fields from a teacher', async () => {
    const svc = makeService();
    const org = await svc.findById('org-1', 'teacher');
    expect((org as Record<string, unknown>).bankAccountName).toBeUndefined();
    expect((org as Record<string, unknown>).bankSortCode).toBeUndefined();
    expect((org as Record<string, unknown>).bankAccountNumber).toBeUndefined();
    expect((org as Record<string, unknown>).invoiceNotes).toBeUndefined();
    // Non-financial fields still come through.
    expect((org as Record<string, unknown>).address).toBe('1 High Street');
    expect((org as Record<string, unknown>).timezone).toBe('Europe/London');
  });

  it('shows bank/invoice fields to an admin', async () => {
    const svc = makeService();
    const org = await svc.findById('org-1', 'admin');
    expect((org as Record<string, unknown>).bankAccountNumber).toBe('12345678');
    expect((org as Record<string, unknown>).bankAccountName).toBe('Music & Life Ltd');
    expect((org as Record<string, unknown>).bankSortCode).toBe('12-34-56');
  });

  it('shows everything when no role is passed (internal/server-side callers)', async () => {
    const svc = makeService();
    const org = await svc.findById('org-1');
    expect((org as Record<string, unknown>).bankAccountName).toBe('Music & Life Ltd');
  });
});
