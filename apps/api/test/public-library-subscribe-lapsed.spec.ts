import { PublicLibraryService } from '../src/public-library/public-library.service';

// subscribe() de-dupes a returning subscriber, but "active" must mean access the
// person can actually use. A lapsed row keeps status='active' with a past
// paidUntil (subscriberByToken rejects it), so keying off status alone told a
// lapsed subscriber "active" while leaving them with no access AND no pending
// record for staff to renew. A lapsed re-subscribe must move them back to pending.

const ORG = { id: 'org-1', name: 'Music & Life' };

function makeService(existing: Record<string, unknown> | undefined) {
  const setWhere = jest.fn().mockResolvedValue(undefined);
  const set = jest.fn(() => ({ where: setWhere }));
  const update = jest.fn(() => ({ set }));
  const insertValues = jest.fn().mockResolvedValue(undefined);
  const db = {
    db: {
      query: {
        organizations: { findFirst: jest.fn().mockResolvedValue(ORG) },
        resourceSubscribers: { findFirst: jest.fn().mockResolvedValue(existing) },
      },
      update,
      insert: jest.fn(() => ({ values: insertValues })),
    },
  };
  const svc = new PublicLibraryService(db as never, {} as never, {} as never, {} as never);
  return { svc, update, set, insertValues };
}

const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0]!;
const nextYear = new Date(Date.now() + 365 * 86400000).toISOString().split('T')[0]!;

describe('PublicLibraryService.subscribe — lapsed subscriber renewal', () => {
  it('moves a lapsed (active-status, past paidUntil) subscriber back to pending', async () => {
    const { svc, update, set } = makeService({ id: 's1', status: 'active', paidUntil: yesterday, name: 'A' });
    const res = await svc.subscribe({ email: 'a@x.com' } as never);
    expect(res).toEqual({ status: 'pending', email: 'a@x.com' });
    expect(update).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ status: 'pending' }));
  });

  it('leaves a genuinely active subscriber (future paidUntil) untouched', async () => {
    const { svc, update } = makeService({ id: 's2', status: 'active', paidUntil: nextYear, name: 'B' });
    const res = await svc.subscribe({ email: 'b@x.com' } as never);
    expect(res).toEqual({ status: 'active', email: 'b@x.com' });
    expect(update).not.toHaveBeenCalled();
  });

  it('still resets a plain pending/cancelled subscriber to pending', async () => {
    const { svc, update, set } = makeService({ id: 's3', status: 'canceled', paidUntil: null, name: 'C' });
    const res = await svc.subscribe({ email: 'c@x.com' } as never);
    expect(res).toEqual({ status: 'pending', email: 'c@x.com' });
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ status: 'pending' }));
  });

  it('inserts a brand-new subscriber as pending', async () => {
    const { svc, insertValues, update } = makeService(undefined);
    const res = await svc.subscribe({ email: 'new@x.com', name: 'N' } as never);
    expect(res).toEqual({ status: 'pending', email: 'new@x.com' });
    expect(insertValues).toHaveBeenCalledTimes(1);
    expect(update).not.toHaveBeenCalled();
  });
});
