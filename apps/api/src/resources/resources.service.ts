import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { eq, and, or, ilike, sql, inArray } from 'drizzle-orm';
import { resources, guardians, students, families, staffMembers, teacherAssignments, enrollments, files } from '@music-life/db';
import { DbService } from '../db/db.service';
import { FilesService } from '../files/files.service';
import type { CreateResourceDto } from './dto/create-resource.dto';
import type { BaseRole } from '@music-life/types';

// What each role is allowed to SEE.
const ROLE_SCOPES: Record<BaseRole, string[]> = {
  system_admin: ['studio', 'teacher', 'family', 'student'],
  admin: ['studio', 'teacher', 'family', 'student'],
  manager: ['studio', 'teacher', 'family', 'student'],
  receptionist: ['studio', 'family', 'student'],
  technician: ['studio'],
  teacher: ['studio', 'teacher'],
  guardian: ['studio', 'family'],
  student: ['studio', 'student'],
};

// What each role is allowed to PUBLISH. Deliberately narrower than what they
// can read: a teacher must NOT be able to broadcast to every parent/student in
// the school (scopes studio/family/student all reach families). Teachers share
// with their own families through per-student lesson notes instead; the shared
// "teacher" pool here is staff-only. Only management/reception curate the
// studio-wide and family/student libraries.
const PUBLISH_SCOPES: Record<BaseRole, string[]> = {
  system_admin: ['studio', 'teacher', 'family', 'student'],
  admin: ['studio', 'teacher', 'family', 'student'],
  manager: ['studio', 'teacher', 'family', 'student'],
  receptionist: ['studio', 'family', 'student'],
  technician: ['studio'],
  teacher: ['teacher'],
  guardian: [],
  student: [],
};

export interface ResourceFilters {
  search?: string;
  instrument?: string;
  teacherId?: string;
  studentId?: string;
}

@Injectable()
export class ResourcesService {
  constructor(
    private readonly db: DbService,
    private readonly files: FilesService,
  ) {}

  // Resource access is a paid subscription, separate from lesson billing —
  // gates GET for guardian/student roles only; staff always bypass.
  // The student ids that belong to the caller's own family (empty for staff or an
  // unlinked account). Used to isolate personal-scoped resources per family.
  private async callerStudentIds(orgId: string, role: BaseRole, userId: string): Promise<string[]> {
    let familyId: string | null = null;
    if (role === 'guardian') {
      const guardian = await this.db.db.query.guardians.findFirst({
        where: and(eq(guardians.userId, userId), eq(guardians.organizationId, orgId)),
        columns: { familyId: true },
      });
      familyId = guardian?.familyId ?? null;
    } else if (role === 'student') {
      const student = await this.db.db.query.students.findFirst({
        where: and(eq(students.studentUserId, userId), eq(students.organizationId, orgId)),
        columns: { familyId: true },
      });
      familyId = student?.familyId ?? null;
    }
    if (!familyId) return [];
    const kids = await this.db.db.query.students.findMany({
      where: and(eq(students.familyId, familyId), eq(students.organizationId, orgId)),
      columns: { id: true },
    });
    return kids.map(k => k.id);
  }

  /**
   * The students a teacher actually teaches — the union of explicit assignments
   * and enrollment.teacherId, matching how the students list scopes them.
   */
  private async teacherStudentIds(orgId: string, userId: string): Promise<{ staffId: string | null; studentIds: string[] }> {
    const staff = await this.db.db.query.staffMembers.findFirst({
      where: and(eq(staffMembers.userId, userId), eq(staffMembers.organizationId, orgId)),
      columns: { id: true },
    });
    if (!staff) return { staffId: null, studentIds: [] };

    const [assignments, enrolled] = await Promise.all([
      this.db.db.query.teacherAssignments.findMany({
        where: and(eq(teacherAssignments.organizationId, orgId), eq(teacherAssignments.staffId, staff.id)),
        columns: { studentId: true },
      }),
      this.db.db.query.enrollments.findMany({
        where: and(eq(enrollments.organizationId, orgId), eq(enrollments.teacherId, staff.id)),
        columns: { studentId: true },
      }),
    ]);
    return {
      staffId: staff.id,
      studentIds: [...new Set([...assignments.map(a => a.studentId), ...enrolled.map(e => e.studentId)])],
    };
  }

  private async hasResourceAccess(orgId: string, role: BaseRole, userId: string): Promise<boolean> {
    if (role !== 'guardian' && role !== 'student') return true;

    let familyId: string | null = null;
    if (role === 'guardian') {
      const guardian = await this.db.db.query.guardians.findFirst({
        where: and(eq(guardians.userId, userId), eq(guardians.organizationId, orgId)),
        columns: { familyId: true },
      });
      familyId = guardian?.familyId ?? null;
    } else {
      const student = await this.db.db.query.students.findFirst({
        where: and(eq(students.studentUserId, userId), eq(students.organizationId, orgId)),
        columns: { familyId: true },
      });
      familyId = student?.familyId ?? null;
    }
    if (!familyId) return false;

    const family = await this.db.db.query.families.findFirst({
      where: eq(families.id, familyId),
      columns: { resourceAccessPaidUntil: true },
    });
    if (!family?.resourceAccessPaidUntil) return false;

    const today = new Date().toISOString().split('T')[0]!;
    return family.resourceAccessPaidUntil >= today;
  }

  async findAll(orgId: string, role: BaseRole, userId: string, filters: ResourceFilters = {}) {
    if (!(await this.hasResourceAccess(orgId, role, userId))) {
      throw new ForbiddenException('Resource access requires an active subscription');
    }

    const allowedScopes = (ROLE_SCOPES[role] ?? ['studio']) as ('studio'|'teacher'|'family'|'student')[];
    const scopeMatch = sql`${resources.scope} = ANY(ARRAY[${sql.join(allowedScopes.map(s => sql`${s}`), sql`, `)}])`;

    // A teacher's allowed scopes are studio + teacher, which meant they could
    // see FEWER resources than their own pupils: material shared with a family
    // was invisible to the teacher who has to talk to that family about it, and
    // a teacher couldn't even see an item they had published themselves. Widen
    // the teacher view to also include anything they own and anything targeted
    // at one of their own students — but nothing belonging to other teachers'
    // students, which is what the scope list is there to prevent.
    const visible = [scopeMatch];
    if (role === 'teacher') {
      const { staffId, studentIds } = await this.teacherStudentIds(orgId, userId);
      visible.push(eq(resources.ownerId, userId));
      // Items attributed to this teacher — the case that prompted this: two
      // family-scope links tagged to a teacher were visible to their student
      // but not to the teacher named on them.
      if (staffId) visible.push(eq(resources.teacherId, staffId));
      if (studentIds.length) visible.push(inArray(resources.studentId, studentIds));
    }

    const conditions = [
      eq(resources.organizationId, orgId),
      visible.length === 1 ? visible[0]! : or(...visible)!,
    ];
    if (filters.search) {
      conditions.push(
        or(ilike(resources.title, `%${filters.search}%`), ilike(resources.description, `%${filters.search}%`))!,
      );
    }
    if (filters.instrument) conditions.push(eq(resources.instrument, filters.instrument));
    if (filters.teacherId) conditions.push(eq(resources.teacherId, filters.teacherId));
    if (filters.studentId) conditions.push(eq(resources.studentId, filters.studentId));

    // Personal (student/family) resources are per-subject: a family/student caller
    // may only see ones that are untargeted (a general library item, studentId
    // NULL) or targeted at one of their OWN students. Without this, any student or
    // guardian could read another student's assigned material by passing (or simply
    // omitting) the studentId filter — the scope filter alone doesn't isolate them.
    if (role === 'student' || role === 'guardian') {
      const myStudentIds = await this.callerStudentIds(orgId, role, userId);
      const personalOk = myStudentIds.length
        ? or(sql`${resources.studentId} IS NULL`, inArray(resources.studentId, myStudentIds))!
        : sql`${resources.studentId} IS NULL`;
      conditions.push(or(sql`${resources.scope} NOT IN ('student', 'family')`, personalOk)!);
    }

    return this.db.db.query.resources.findMany({
      where: and(...conditions),
      with: {
        file: { columns: { id: true, mime: true, originalName: true } },
        teacher: { columns: { id: true, firstName: true, lastName: true } },
        student: { columns: { id: true, firstName: true, lastName: true } },
      },
      orderBy: (r, { desc }) => [desc(r.createdAt)],
    });
  }

  async create(orgId: string, ownerId: string, role: BaseRole, dto: CreateResourceDto) {
    // Enforce publish rights: a teacher can't broadcast to all families/students.
    const allowed = PUBLISH_SCOPES[role] ?? [];
    if (!allowed.includes(dto.scope)) {
      throw new ForbiddenException(
        role === 'teacher'
          ? 'Teachers can share resources with the teaching team only. To send materials to a family, add them to a lesson note for that student.'
          : 'You are not allowed to publish resources to that audience.',
      );
    }

    // Teachers can only tag resources as their own — never impersonate another teacher.
    let teacherId = dto.teacherId;
    if (role === 'teacher') {
      const staff = await this.db.db.query.staffMembers.findFirst({
        where: and(eq(staffMembers.userId, ownerId), eq(staffMembers.organizationId, orgId)),
        columns: { id: true },
      });
      teacherId = staff?.id;
    }

    // fileId/teacherId/studentId are caller-supplied FKs (all constrained in the
    // DB): a bogus id 500s on the constraint and a foreign-org id would tag the
    // resource against another studio's row. Validate each against this org.
    // Default the delivery mode from the file's type when the caller didn't pick
    // one: a video is view-only (streamed, no download), anything else (sheet
    // music PDFs, audio, images) is downloadable.
    let delivery = dto.delivery;
    if (dto.fileId) {
      const file = await this.db.db.query.files.findFirst({
        where: and(eq(files.id, dto.fileId), eq(files.organizationId, orgId)),
        columns: { id: true, mime: true },
      });
      if (!file) throw new NotFoundException('File not found');
      if (!delivery) delivery = file.mime.startsWith('video/') ? 'view_only' : 'download';
    }
    if (teacherId) {
      const teacher = await this.db.db.query.staffMembers.findFirst({
        where: and(eq(staffMembers.id, teacherId), eq(staffMembers.organizationId, orgId)),
        columns: { id: true },
      });
      if (!teacher) throw new NotFoundException('Teacher not found');
    }
    if (dto.studentId) {
      const student = await this.db.db.query.students.findFirst({
        where: and(eq(students.id, dto.studentId), eq(students.organizationId, orgId)),
        columns: { id: true },
      });
      if (!student) throw new NotFoundException('Student not found');
    }

    const [resource] = await this.db.db.insert(resources)
      .values({ ...dto, delivery, teacherId, organizationId: orgId, ownerId })
      .returning();
    return resource!;
  }

  /**
   * Sign a time-limited URL for a file resource's underlying file, enforcing the
   * SAME visibility + subscription rules as the library listing (we look the
   * resource up through findAll rather than trusting the id), then apply the
   * resource's delivery mode: a downloadable resource is served as an attachment,
   * a view-only one inline so there's no download link to pass around.
   */
  async signResourceFile(orgId: string, role: BaseRole, userId: string, id: string) {
    const visible = await this.findAll(orgId, role, userId, {});
    const resource = visible.find(r => r.id === id);
    // 404 (not 403) so a caller can't probe which resources exist in the org.
    if (!resource) throw new NotFoundException('Resource not found');
    if (resource.type !== 'file' || !resource.fileId) {
      throw new BadRequestException('This resource has no file to open.');
    }
    const disposition = resource.delivery === 'view_only' ? 'inline' : 'attachment';
    const signed = await this.files.signDownloadForOrg(resource.fileId, orgId, { disposition });
    return {
      url: signed.downloadUrl,
      delivery: resource.delivery,
      mime: signed.mime,
      name: signed.originalName,
      expiresAt: signed.expiresAt,
    };
  }

  async remove(orgId: string, id: string) {
    const [removed] = await this.db.db.delete(resources)
      .where(and(eq(resources.id, id), eq(resources.organizationId, orgId)))
      .returning();
    if (!removed) throw new NotFoundException('Resource not found');
    return { id };
  }
}
