import { BroadcastService } from '../src/broadcasts/broadcast.service';

// A "message all families" broadcast resolved recipients only through guardian
// *memberships* (users with a login). But a family created by staff or bulk
// import keeps its contact address on the family record with no guardian login,
// so those families were silently skipped — the office saw a success count while
// an entire class of families received nothing. The audience must also include
// the family contact address, exactly as the filtered (subgroup) path does.

function makeService(opts: {
  memberships: { user: { email: string | null } | null }[];
  families?: { email: string | null }[];
}) {
  const familiesFindMany = jest.fn().mockResolvedValue(opts.families ?? []);
  const db = {
    db: {
      query: {
        memberships: { findMany: jest.fn().mockResolvedValue(opts.memberships) },
        families: { findMany: familiesFindMany },
      },
    },
  };
  const svc = new BroadcastService(db as never, { send: jest.fn() } as never);
  const call = (audience: string) =>
    (svc as unknown as { audienceEmails: (o: string, a: string) => Promise<string[]> })
      .audienceEmails('org-1', audience);
  return { call, familiesFindMany };
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
});
