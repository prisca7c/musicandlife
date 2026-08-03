import { FamilyPortalController } from '../src/family-portal/family-portal.controller';
import type { RequestUser } from '@music-life/types';

/**
 * A logged-in STUDENT must be scoped to their own record, not the whole family.
 * The dashboard already draws this line; the lesson history, notes, note-media
 * download and the book/cancel actions did not — so a child could read a
 * sibling's lessons and the teacher's notes about them, and book or cancel a
 * sibling's lessons. `callerStudentIds` is the shared gate: a guardian sees the
 * whole family, a student only themselves.
 */

const FAMILY = { students: [{ id: 's-me' }, { id: 's-sibling' }] };

function makeController(selfRow: { id: string } | undefined) {
  const db = {
    db: {
      query: {
        students: {
          findFirst: async () => selfRow,
        },
      },
    },
  };
  // Only `db` is exercised by callerStudentIds; the rest are unused here.
  const ctrl = new FamilyPortalController(
    db as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never,
  );
  return ctrl;
}

const call = (ctrl: FamilyPortalController, user: RequestUser, family: typeof FAMILY) =>
  (ctrl as never as {
    callerStudentIds: (u: RequestUser, f: typeof FAMILY) => Promise<string[]>;
  }).callerStudentIds(user, family);

const user = (role: string): RequestUser =>
  ({ userId: 'u-1', orgId: 'org-1', role } as unknown as RequestUser);

describe('FamilyPortalController.callerStudentIds — student vs guardian scope', () => {
  it('a guardian sees every child in the family', async () => {
    const ctrl = makeController(undefined);
    const ids = await call(ctrl, user('guardian'), FAMILY);
    expect(ids.sort()).toEqual(['s-me', 's-sibling']);
  });

  it('a student sees only their own record, not a sibling', async () => {
    const ctrl = makeController({ id: 's-me' });
    const ids = await call(ctrl, user('student'), FAMILY);
    expect(ids).toEqual(['s-me']);
    expect(ids).not.toContain('s-sibling');
  });

  it('a student with no linked record sees nothing', async () => {
    const ctrl = makeController(undefined);
    const ids = await call(ctrl, user('student'), FAMILY);
    expect(ids).toEqual([]);
  });
});
