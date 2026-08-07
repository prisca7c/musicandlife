import { BadRequestException, NotFoundException } from '@nestjs/common';
import { StaffService } from '../src/staff/staff.service';

/**
 * assignStudent linked a student to a teacher (teacherAssignments) with no
 * check that the teacher was active or the student wasn't withdrawn — the
 * same class of gap enrollments.create already closed for enrolments
 * (assertTeacherAndTermInOrg). The resulting link resurfaces in teacher-
 * scoped student views with nothing else expecting it to exist.
 */
const ORG = 'org-1';
const STAFF = 'tea-1';
const STU = 'stu-1';

function makeService(opts: { staffStatus?: string; studentStatus?: string } = {}) {
  const inserted: Record<string, unknown>[] = [];
  const db = {
    db: {
      query: {
        staffMembers: {
          findFirst: async () => ({
            id: STAFF, status: opts.staffStatus ?? 'active',
            user: { id: 'u1', email: 'a@x.com' }, privileges: null, assignments: [],
          }),
        },
        students: {
          findFirst: async () => ({ id: STU, status: opts.studentStatus ?? 'active' }),
        },
      },
      insert: () => ({
        values: (v: Record<string, unknown>) => ({
          onConflictDoUpdate: async () => { inserted.push(v); return undefined; },
        }),
      }),
    },
  };
  const email = {};
  return { service: new StaffService(db as never, email as never), inserted };
}

describe('StaffService.assignStudent — status guards', () => {
  it('refuses to assign a student to an inactive teacher', async () => {
    const { service } = makeService({ staffStatus: 'inactive' });
    await expect(service.assignStudent(ORG, STAFF, STU)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses to assign a withdrawn student', async () => {
    const { service } = makeService({ studentStatus: 'withdrawn' });
    await expect(service.assignStudent(ORG, STAFF, STU)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('allows an active teacher and an active student', async () => {
    const { service, inserted } = makeService();
    await expect(service.assignStudent(ORG, STAFF, STU)).resolves.toMatchObject({ staffId: STAFF, studentId: STU });
    expect(inserted).toHaveLength(1);
  });
});
