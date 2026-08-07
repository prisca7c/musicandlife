import { BroadcastService } from '../src/broadcasts/broadcast.service';

// A "message all families" broadcast resolved recipients only through guardian
// *memberships* (users with a login). But a family created by staff or bulk
// import keeps its contact address on the family record with no guardian login,
// so those families were silently skipped — the office saw a success count while
// an entire class of families received nothing. The audience must also include
// the family contact address, exactly as the filtered (subgroup) path does.

function makeService(opts: {
  memberships: { user: { email: string | null } | null }[];
  families?: { id?: string; email: string | null }[];
  guardians?: { familyId: string }[];
  students?: { studentUserId: string | null }[];
  users?: { email: string | null }[];
}) {
  const familiesFindMany = jest.fn().mockResolvedValue(opts.families ?? []);
  const guardiansFindMany = jest.fn().mockResolvedValue(opts.guardians ?? []);
  const studentsFindMany = jest.fn().mockResolvedValue(opts.students ?? []);
  const usersFindMany = jest.fn().mockResolvedValue(opts.users ?? []);
  const db = {
    db: {
      query: {
        memberships: { findMany: jest.fn().mockResolvedValue(opts.memberships) },
        families: { findMany: familiesFindMany },
        guardians: { findMany: guardiansFindMany },
        students: { findMany: studentsFindMany },
        users: { findMany: usersFindMany },
      },
    },
  };
  const svc = new BroadcastService(db as never, { send: jest.fn() } as never);
  const call = (audience: string) =>
    (svc as unknown as { audienceEmails: (o: string, a: string) => Promise<string[]> })
      .audienceEmails('org-1', audience);
  return { call, familiesFindMany, guardiansFindMany, studentsFindMany, usersFindMany };
}

describe('BroadcastService.audienceEmails — family contact addresses', () => {
  it('includes a family with a contact email but no guardian login', async () => {
    const { call } = makeService({
      memberships: [{ user: { email: 'GuardianA@x.com' } }],
      families: [{ email: 'onlycontact@x.com' }, { email: 'GuardianA@x.com' }],
    });
    const emails = await call('families');
    expect(emails).toContain('onlycontact@x.com'); // would have been missed before
    expect(emails).toContain('guardiana@x.com');
  });

  it('dedupes when the family contact equals the guardian login (case-insensitive)', async () => {
    const { call } = makeService({
      memberships: [{ user: { email: 'Parent@X.com' } }],
      families: [{ email: 'parent@x.com' }],
    });
    const emails = await call('families');
    expect(emails).toEqual(['parent@x.com']);
  });

  it('everyone also folds in family contacts', async () => {
    const { call, familiesFindMany } = makeService({
      memberships: [{ user: { email: 'teach@x.com' } }],
      families: [{ email: 'fam@x.com' }],
    });
    const emails = await call('everyone');
    expect(emails).toEqual(expect.arrayContaining(['teach@x.com', 'fam@x.com']));
    expect(familiesFindMany).toHaveBeenCalledTimes(1);
  });

  it('does not touch the families table for a teachers-only send', async () => {
    const { call, familiesFindMany } = makeService({
      memberships: [{ user: { email: 'teach@x.com' } }],
    });
    const emails = await call('teachers');
    expect(emails).toEqual(['teach@x.com']);
    expect(familiesFindMany).not.toHaveBeenCalled();
  });

  // Student-portal parity (an adult student can manage their own account with
  // no guardian at all) reopened this: a family with neither a guardian login
  // nor a families.email is only reachable through the student's own login.
  it('reaches a family with no guardian and no families.email via its student login', async () => {
    const { call } = makeService({
      memberships: [], // no guardian logins in the org
      families: [{ id: 'fam-1', email: null }],
      guardians: [], // fam-1 has no guardian row at all
      students: [{ studentUserId: 'user-student-1' }],
      users: [{ email: 'adult.student@x.com' }],
    });
    const emails = await call('families');
    expect(emails).toEqual(['adult.student@x.com']); // would have been [] before
  });

  it('does not use the student-login fallback for a family that already has a guardian', async () => {
    const { call, studentsFindMany } = makeService({
      memberships: [{ user: { email: 'guardian@x.com' } }],
      families: [{ id: 'fam-1', email: null }],
      guardians: [{ familyId: 'fam-1' }],
    });
    const emails = await call('families');
    expect(emails).toEqual(['guardian@x.com']);
    expect(studentsFindMany).not.toHaveBeenCalled();
  });
});
