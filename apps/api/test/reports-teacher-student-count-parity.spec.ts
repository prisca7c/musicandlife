import { ReportsService } from '../src/reports/reports.service';

// The teacher dashboard's "My students" tile used to re-derive its own scoped
// student-id list from enrollments.teacherId only, excluding withdrawn rows.
// /app/students defines "this teacher's students" as the union of the
// teacherAssignments table and enrollments.teacherId, with no withdrawn
// filter. A student linked only via teacherAssignments (no matching
// enrollments.teacherId row) was invisible to the dashboard tile but visible
// on the students list. The fix makes the dashboard reuse
// StudentsService.getAssignedStudentIds so the two always agree.

function chain(result: unknown[]) {
  const builder: Record<string, unknown> = {};
  for (const m of ['from', 'where', 'groupBy', 'orderBy', 'innerJoin']) {
    builder[m] = () => builder;
  }
  (builder as { then: unknown }).then = (resolve: (v: unknown[]) => unknown) => resolve(result);
  return builder;
}

describe('ReportsService.getDashboardKpis — teacher student count parity', () => {
  it('counts a student linked only via teacherAssignments (matching /app/students), not just enrollments.teacherId', async () => {
    // Two students assigned to this teacher per the canonical definition:
    // one via an active enrollment, one via teacherAssignments only.
    const assignedIds = ['stu-enrolled', 'stu-assignment-only'];
    const studentsService = { getAssignedStudentIds: jest.fn().mockResolvedValue(assignedIds) };

    const db = {
      db: {
        select: (cols: Record<string, unknown>) => {
          if ('status' in cols && cols.status !== undefined) {
            // students-by-status query — both are active.
            return chain([{ status: 'active', count: 2 }]);
          }
          return chain([]);
        },
        query: {
          terms: { findMany: jest.fn().mockResolvedValue([]) },
        },
      },
    };

    const service = new ReportsService(db as never, studentsService as never);
    const kpis = await service.getDashboardKpis('org-1', 'teacher-staff-id');

    expect(studentsService.getAssignedStudentIds).toHaveBeenCalledWith('org-1', 'teacher-staff-id');
    expect(kpis.students.active).toBe(2);
    expect(kpis.students.total).toBe(2);
  });
});
