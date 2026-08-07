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

function makeService(
  existing: Array<Record<string, unknown>>,
  target?: Record<string, unknown>,
) {
  const inserted: Record<string, unknown>[] = [];
  const setValues: Record<string, unknown>[] = [];
  const db = {
    db: {
      query: {
        students: { findFirst: async () => ({ id: STU, organizationId: ORG }) },
        staffMembers: { findFirst: async () => ({ id: TEACHER, status: 'active' }) },
        terms: { findFirst: async () => ({ id: 'term-1' }) },
        enrollments: {
          findMany: async () => existing,
          findFirst: async () => target,
        },
      },
      insert: () => ({
        values: (v: Record<string, unknown>) => ({
          returning: async () => {
            inserted.push(v);
            return [{ id: 'new-enr', ...v }];
          },
        }),
      }),
      update: () => ({
        set: (v: Record<string, unknown>) => ({
          where: () => ({
            returning: async () => {
              setValues.push(v);
              return [{ id: (target?.id as string) ?? 'upd-enr', ...target, ...v }];
            },
          }),
        }),
      }),
    },
  };
  return { service: new EnrollmentsService(db as never), inserted, setValues };
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

describe('EnrollmentsService.update — duplicate-instrument guard', () => {
  const TARGET = 'enr-target';
  // The row being edited, plus a sibling it could collide with on rename.
  const target = { id: TARGET, studentId: STU, instrument: 'Violin', lessonType: 'private', teacherId: TEACHER, status: 'active' };
  const sibling = { id: 'enr-sibling', instrument: 'Piano', lessonType: 'private', teacherId: TEACHER, status: 'active' };

  it('rejects renaming an instrument into a case-variant of a sibling', async () => {
    const { service } = makeService([target, sibling], target);
    await expect(service.update(ORG, TARGET, { instrument: 'piano' } as never))
      .rejects.toBeInstanceOf(ConflictException);
  });

  it('does not treat the edited row as its own duplicate (no-op rename)', async () => {
    const { service, setValues } = makeService([target, sibling], target);
    await expect(service.update(ORG, TARGET, { instrument: ' Violin ' } as never))
      .resolves.toMatchObject({ id: TARGET });
    expect(setValues[0]!.instrument).toBe('Violin');
  });

  it('allows a rename that collides only with a WITHDRAWN sibling', async () => {
    const withdrawn = { ...sibling, status: 'withdrawn' };
    const { service } = makeService([target, withdrawn], target);
    await expect(service.update(ORG, TARGET, { instrument: 'Piano' } as never))
      .resolves.toMatchObject({ id: TARGET });
  });

  it('allows editing other fields when the resulting row is withdrawn, even into a name clash', async () => {
    const { service } = makeService([target, sibling], target);
    await expect(service.update(ORG, TARGET, { instrument: 'Piano', status: 'withdrawn' } as never))
      .resolves.toMatchObject({ id: TARGET });
  });

  it('rejects switching teacher so it collides with a sibling under that teacher', async () => {
    const otherTeacher = { ...sibling, instrument: 'Violin', teacherId: 'tea-2' };
    const { service } = makeService([target, otherTeacher], target);
    await expect(service.update(ORG, TARGET, { teacherId: 'tea-2' } as never))
      .rejects.toBeInstanceOf(ConflictException);
  });
});
