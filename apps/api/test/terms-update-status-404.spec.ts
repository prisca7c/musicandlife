import { NotFoundException } from '@nestjs/common';
import { TermsController } from '../src/terms/terms.controller';

/**
 * updateStatus's where clause is org-scoped, so a term id from another org
 * (or a bogus one) matches nothing — but the controller used to return
 * `updated!` unconditionally, turning that into a 200 with an empty/undefined
 * body instead of a 404, unlike every sibling write endpoint in this codebase.
 */
function makeController(updatedRows: unknown[]) {
  const db = { db: { update: () => ({ set: () => ({ where: () => ({ returning: async () => updatedRows }) }) }) } };
  return new TermsController(db as never);
}

const USER = { userId: 'u1', orgId: 'org-1', role: 'admin' } as never;

describe('TermsController.updateStatus — 404 on no match', () => {
  it('throws NotFoundException when nothing matched (cross-org or bogus id)', async () => {
    const ctrl = makeController([]);
    await expect(ctrl.updateStatus(USER, 'term-x', { status: 'closed' } as never)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns the updated row when the term exists in this org', async () => {
    const ctrl = makeController([{ id: 'term-1', status: 'closed' }]);
    await expect(ctrl.updateStatus(USER, 'term-1', { status: 'closed' } as never)).resolves.toMatchObject({ id: 'term-1' });
  });
});
