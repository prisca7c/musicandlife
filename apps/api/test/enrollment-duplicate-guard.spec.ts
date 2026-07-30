import { ConflictException } from '@nestjs/common';
import { EnrollmentsService } from '../src/enrollments/enrollments.service';

/**
 * A student's instrument was free text, so "Piano" and "piano" (or " piano ")
 * were stored as two separate enrolments for the same instrument + teacher +
 * lesson type. That fragments reports and billing and renders as two identical,
 * indistinguishable bookable slots on the family calendar. create() now rejects
 * a case-/whitespace-variant duplicate of a non-withdrawn enrolment.
 */

const ORG = 'org-1';
const STU = 'stu-1';
const TEACHER = 'tea-1';

function makeService(existing: Array<Record<string, unknown>>) {
  const inserted: Record<string, unknown>[] = [];
  const db = {
    db: {
      query: {
        students: { findFirst: async () => ({ id: STU, organizationId: ORG }) },
        staffMembers: { findFirst: async () => ({ id: TEACHER }) },
        terms: { findFirst: async () => ({ id: 'term-1' }) },
        enrollments: { findMany: async () => existing },
      },
      insert: () => ({
        values: (v: Record<string, unknown>) => ({
          returning: async () => {
            inserted.push(v);
            return [{ id: 'new-enr', ...v }];
          },
        }),
      }),
    },
  };
  return { service: new EnrollmentsService(db as never), inserted };
}

const dto = (over: Record<string, unknown> = {}) => ({
  instrument: 'Piano', lessonType: 'private' as const, teacherId: TEACHER, ...over,
});

describe('EnrollmentsService.create — duplicate-instrument guard', () => {
  it('rejects a case-variant duplicate (piano vs Piano) for same teacher + type', async () => {
    const { service } = makeService([
      { instrument: 'piano', lessonType: 'private', teacherId: TEACHER, status: 'active' },
    ]);
    await expect(service.create(ORG, STU, dto({ instrument: 'Piano' }) as never))
      .rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects a whitespace-variant duplicate (" piano ")', async () => {
    const { service } = makeService([
      { instrument: 'Piano', lessonType: 'private', teacherId: TEACHER, status: 'active' },
    ]);
    await expect(service.create(ORG, STU, dto({ instrument: '  piano  ' }) as never))
      .rejects.toBeInstanceOf(ConflictException);
  });

  it('allows the same instrument with a DIFFERENT teacher', async () => {
    const { service, inserted } = makeService([
      { instrument: 'Piano', lessonType: 'private', teacherId: 'tea-OTHER', status: 'active' },
    ]);
    const res = await service.create(ORG, STU, dto({ teacherId: TEACHER }) as never);
    expect(res.id).toBe('new-enr');
    expect(inserted).toHaveLength(1);
  });

  it('allows the same instrument with a different lessonType (private vs group)', async () => {
    const { service } = makeService([
      { instrument: 'Piano', lessonType: 'group', teacherId: TEACHER, status: 'active' },
    ]);
    await expect(service.create(ORG, STU, dto({ lessonType: 'private' }) as never))
      .resolves.toMatchObject({ id: 'new-enr' });
  });

  it('does NOT block re-enrolling when the prior enrolment is withdrawn', async () => {
    const { service } = makeService([
      { instrument: 'Piano', lessonType: 'private', teacherId: TEACHER, status: 'withdrawn' },
    ]);
    await expect(service.create(ORG, STU, dto() as never))
      .resolves.toMatchObject({ id: 'new-enr' });
  });

  it('stores the instrument trimmed', async () => {
    const { service, inserted } = makeService([]);
    await service.create(ORG, STU, dto({ instrument: '  Violin ' }) as never);
    expect(inserted[0]!.instrument).toBe('Violin');
  });
});
