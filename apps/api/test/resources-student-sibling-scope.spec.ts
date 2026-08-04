import { ResourcesService } from '../src/resources/resources.service';
import type { BaseRole } from '@music-life/types';

/**
 * Personal (student/family-scoped) resources are isolated per student via
 * callerStudentIds. A guardian oversees the whole family, but a logged-in
 * STUDENT must resolve to their OWN record only — otherwise the personal-scope
 * filter in findAll admits a sibling's targeted resources, and (because
 * signResourceFile re-derives visibility through findAll) lets the student
 * download the sibling's file too. Same sibling-scope class as #178/#185.
 */

function makeService(opts: {
  self?: { id: string };
  guardianFamilyId?: string;
  familyKids?: { id: string }[];
}) {
  const db = {
    db: {
      query: {
        students: {
          findFirst: async () => opts.self, // student → own record
          findMany: async () => opts.familyKids ?? [], // guardian → family kids
        },
        guardians: {
          findFirst: async () => (opts.guardianFamilyId ? { familyId: opts.guardianFamilyId } : undefined),
        },
      },
    },
  };
  return new ResourcesService(db as never, {} as never);
}

const call = (svc: ResourcesService, role: BaseRole) =>
  (svc as never as {
    callerStudentIds: (o: string, r: BaseRole, u: string) => Promise<string[]>;
  }).callerStudentIds('org-1', role, 'user-1');

describe('ResourcesService.callerStudentIds — student vs guardian scope', () => {
  it('a student resolves to their OWN record only, never a sibling', async () => {
    const svc = makeService({
      self: { id: 's-me' },
      // Even though the family has two kids, a student must not get the sibling.
      familyKids: [{ id: 's-me' }, { id: 's-sibling' }],
    });
    const ids = await call(svc, 'student');
    expect(ids).toEqual(['s-me']);
    expect(ids).not.toContain('s-sibling');
  });

  it('a guardian covers every child in the family', async () => {
    const svc = makeService({
      guardianFamilyId: 'fam-1',
      familyKids: [{ id: 's-me' }, { id: 's-sibling' }],
    });
    const ids = await call(svc, 'guardian');
    expect(ids.sort()).toEqual(['s-me', 's-sibling']);
  });

  it('a student with no linked record sees no personal resources', async () => {
    const svc = makeService({ self: undefined });
    const ids = await call(svc, 'student');
    expect(ids).toEqual([]);
  });

  it('a staff caller resolves to no personal set (they read via scope)', async () => {
    const svc = makeService({});
    const ids = await call(svc, 'teacher');
    expect(ids).toEqual([]);
  });
});
