import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { eq, and, or, ilike, sql } from 'drizzle-orm';
import { resources, guardians, students, families, staffMembers } from '@music-life/db';
import { DbService } from '../db/db.service';
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
  constructor(private readonly db: DbService) {}

  // Resource access is a paid subscription, separate from lesson billing —
  // gates GET for guardian/student roles only; staff always bypass.
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
    const conditions = [
      eq(resources.organizationId, orgId),
      sql`${resources.scope} = ANY(ARRAY[${sql.join(allowedScopes.map(s => sql`${s}`), sql`, `)}])`,
    ];
    if (filters.search) {
      conditions.push(
        or(ilike(resources.title, `%${filters.search}%`), ilike(resources.description, `%${filters.search}%`))!,
      );
    }
    if (filters.instrument) conditions.push(eq(resources.instrument, filters.instrument));
    if (filters.teacherId) conditions.push(eq(resources.teacherId, filters.teacherId));
    if (filters.studentId) conditions.push(eq(resources.studentId, filters.studentId));

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

    const [resource] = await this.db.db.insert(resources)
      .values({ ...dto, teacherId, organizationId: orgId, ownerId })
      .returning();
    return resource!;
  }

  async remove(orgId: string, id: string) {
    const [removed] = await this.db.db.delete(resources)
      .where(and(eq(resources.id, id), eq(resources.organizationId, orgId)))
      .returning();
    if (!removed) throw new NotFoundException('Resource not found');
    return { id };
  }
}
