import { BadRequestException } from '@nestjs/common';
import { EnrollmentsService } from '../src/enrollments/enrollments.service';

/**
 * Two gaps in enrollment create/update:
 *  1. assertTeacherAndTermInOrg checked a teacher exists in-org but never that
 *     they're active — the one write path in this class of bug (booking #193,
 *     recurring materialization #172) that was still missing the check.
 *  2. Creating a fresh (non-withdrawn) enrollment for a student whose own
 *     status was still 'withdrawn' never brought students.status back in
 *     step, so the student stayed invisible in "active students" views while
 *     actually billable again.
 */

const ORG = 'org-1';
const STU = 'stu-1';
const TEACHER = 'tea-1';

function makeService(opts: { studentStatus?: string; teacherStatus?: string } = {}) {
  const inserted: Record<string, unknown>[] = [];
  const studentUpdates: Record<string, unknown>[] = [];
  const db = {
    db: {
      query: {
        students: { findFirst: async () => ({ id: STU, organizationId: ORG, status: opts.studentStatus ?? 'active' }) },
        staffMembers: { findFirst: async () => ({ id: TEACHER, status: opts.teacherStatus ?? 'active' }) },
        terms: { findFirst: async () => ({ id: 'term-1' }) },
        enrollments: { findMany: async () => [], findFirst: async () => undefined },
      },
      insert: (table: unknown) => ({
        values: (v: Record<string, unknown>) => ({
          returning: async () => {
            inserted.push(v);
            return [{ id: 'new-enr', ...v }];
          },
        }),
      }),
      update: (_table: unknown) => ({
        set: (v: Record<string, unknown>) => ({
          where: async () => {
            studentUpdates.push(v);
            return undefined;
          },
        }),
      }),
    },
  };
  return { service: new EnrollmentsService(db as never), inserted, studentUpdates };
}

const dto = (over: Record<string, unknown> = {}) => ({
  instrument: 'Piano', lessonType: 'private' as const, teacherId: TEACHER, ...over,
});

describe('EnrollmentsService.create — inactive-teacher guard', () => {
  it('refuses to enroll a student under an inactive teacher', async () => {
    const { service } = makeService({ teacherStatus: 'inactive' });
    await expect(service.create(ORG, STU, dto() as never)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('allows an active teacher', async () => {
    const { service } = makeService({ teacherStatus: 'active' });
    await expect(service.create(ORG, STU, dto() as never)).resolves.toMatchObject({ id: 'new-enr' });
  });
});

describe('EnrollmentsService.create — withdrawn-student reactivation', () => {
  it('reactivates a withdrawn student when a new active enrollment is created', async () => {
    const { service, studentUpdates } = makeService({ studentStatus: 'withdrawn' });
    await service.create(ORG, STU, dto() as never);
    expect(studentUpdates).toHaveLength(1);
    expect(studentUpdates[0]!.status).toBe('active');
  });

  it('does not touch an already-active student', async () => {
    const { service, studentUpdates } = makeService({ studentStatus: 'active' });
    await service.create(ORG, STU, dto() as never);
    expect(studentUpdates).toHaveLength(0);
  });
});
