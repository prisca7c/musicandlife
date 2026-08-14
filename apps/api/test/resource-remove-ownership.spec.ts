import { ResourcesService } from '../src/resources/resources.service';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { BaseRole } from '@music-life/types';

// remove() only checked org scope, so any teacher could delete a colleague's (or
// a studio-wide) resource by id — while every READ path scopes a teacher to
// their own + their own students' resources. Deletion must be owner-only, with
// admin able to administer the shared library.

function makeService(resource: { id: string; ownerId: string } | undefined) {
  const deleteWhere = jest.fn().mockResolvedValue(undefined);
  const del = jest.fn(() => ({ where: deleteWhere }));
  const db = {
    db: {
      query: { resources: { findFirst: jest.fn().mockResolvedValue(resource) } },
      delete: del,
    },
  };
  const svc = new ResourcesService(db as never, {} as never);
  return { svc, del, deleteWhere };
}

const OWNER = 'user-owner';
const OTHER = 'user-other';

describe('ResourcesService.remove — ownership enforcement', () => {
  it('lets the owner delete their own resource', async () => {
    const { svc, del } = makeService({ id: 'r1', ownerId: OWNER });
    await expect(svc.remove('org1', 'teacher' as BaseRole, OWNER, 'r1')).resolves.toEqual({ id: 'r1' });
    expect(del).toHaveBeenCalledTimes(1);
  });

  it('forbids a teacher deleting a resource they do not own', async () => {
    const { svc, del } = makeService({ id: 'r1', ownerId: OWNER });
    await expect(svc.remove('org1', 'teacher' as BaseRole, OTHER, 'r1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(del).not.toHaveBeenCalled(); // nothing deleted
  });

  it('lets admin delete any resource', async () => {
    const { svc, del } = makeService({ id: 'r1', ownerId: OWNER });
    await expect(svc.remove('org1', 'admin' as BaseRole, OTHER, 'r1')).resolves.toEqual({ id: 'r1' });
    expect(del).toHaveBeenCalledTimes(1);
  });

  it('404s a missing resource without a delete', async () => {
    const { svc, del } = makeService(undefined);
    await expect(svc.remove('org1', 'admin' as BaseRole, OTHER, 'nope')).rejects.toBeInstanceOf(NotFoundException);
    expect(del).not.toHaveBeenCalled();
  });
});
