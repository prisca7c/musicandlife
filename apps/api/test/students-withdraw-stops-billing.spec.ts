import { StudentsService } from '../src/students/students.service';

// Withdrawing a student used to flip only students.status. Their enrolments
// stayed 'active' with a weekly scheduleRule, and the recurrence worker scans on
// enrolment.status alone — so it kept generating lessons for a child who had
// left, which autoCompleteOverdue then marked present and CHARGED the family.
// remove() must now also withdraw the enrolments (clearing scheduleRule) and
// cancel every future scheduled lesson at no charge, in one transaction.

type Captured = { table: string; set: Record<string, unknown> };

function makeService() {
  const captured: Captured[] = [];
  const found = { id: 'stu-1', organizationId: 'org-1' };

  // A tx.update(...).set(...).where(...)[.returning()] chain that records the
  // table it targeted and the values it set.
  const makeTx = () => {
    const update = (table: unknown) => {
      const name = (table as { __name?: string }).__name ?? 'unknown';
      const rows = name === 'lessons' ? [{ id: 'l1' }, { id: 'l2' }] : [found];
      return {
        set: (set: Record<string, unknown>) => {
          captured.push({ table: name, set });
          // .where() is awaited directly (enrolments) OR chained to .returning()
          // (students, lessons). Return a thenable that also carries .returning().
          const whereResult = Object.assign(Promise.resolve(rows), {
            returning: () => Promise.resolve(rows),
          });
          return { where: () => whereResult };
        },
      };
    };
    return { update };
  };

  const db = {
    db: {
      query: {
        students: { findFirst: jest.fn().mockResolvedValue(found) },
      },
      transaction: (fn: (tx: unknown) => Promise<unknown>) => fn(makeTx()),
    },
  };
  return { svc: new StudentsService(db as never), captured };
}

// Stamp table identity onto the drizzle table objects the service imports.
jest.mock('@music-life/db', () => {
  const actual = jest.requireActual('@music-life/db');
  return {
    ...actual,
    students: Object.assign(actual.students, { __name: 'students' }),
    enrollments: Object.assign(actual.enrollments, { __name: 'enrollments' }),
    lessons: Object.assign(actual.lessons, { __name: 'lessons' }),
  };
});

describe('StudentsService.remove — withdrawal stops billing', () => {
  it('withdraws the student, ends enrolments (clearing scheduleRule), and cancels future lessons', async () => {
    const { svc, captured } = makeService();
    const res = await svc.remove('org-1', 'stu-1');

    const student = captured.find(c => c.table === 'students');
    const enrol = captured.find(c => c.table === 'enrollments');
    const lesson = captured.find(c => c.table === 'lessons');

    expect(student?.set).toMatchObject({ status: 'withdrawn' });
    // Enrolments withdrawn AND scheduleRule nulled so the recurrence worker stops.
    expect(enrol?.set).toMatchObject({ status: 'withdrawn', scheduleRule: null });
    // Future scheduled lessons cancelled at no charge.
    expect(lesson?.set).toMatchObject({ status: 'cancelled_no_pay' });
    expect((res as { cancelledLessons: number }).cancelledLessons).toBe(2);
  });
});
