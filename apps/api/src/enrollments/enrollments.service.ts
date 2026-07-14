import { Injectable, NotFoundException } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { enrollments, students, staffMembers } from '@music-life/db';
import { DbService } from '../db/db.service';
import type { CreateEnrollmentDto } from './dto/create-enrollment.dto';
import type { UpdateEnrollmentDto } from './dto/update-enrollment.dto';

@Injectable()
export class EnrollmentsService {
  constructor(private readonly db: DbService) {}

  async create(orgId: string, studentId: string, dto: CreateEnrollmentDto) {
    const student = await this.db.db.query.students.findFirst({
      where: and(eq(students.id, studentId), eq(students.organizationId, orgId)),
    });
    if (!student) throw new NotFoundException('Student not found');

    if (dto.teacherId) {
      const teacher = await this.db.db.query.staffMembers.findFirst({
        where: and(eq(staffMembers.id, dto.teacherId), eq(staffMembers.organizationId, orgId)),
      });
      if (!teacher) throw new NotFoundException('Teacher not found');
    }

    const { duration, ...rest } = dto;
    const [enrollment] = await this.db.db
      .insert(enrollments)
      .values({
        ...rest,
        ...(duration != null ? { defaultDuration: duration } : {}),
        studentId,
        organizationId: orgId,
      })
      .returning();
    return enrollment!;
  }

  async update(orgId: string, id: string, dto: UpdateEnrollmentDto) {
    const existing = await this.db.db.query.enrollments.findFirst({
      where: and(eq(enrollments.id, id), eq(enrollments.organizationId, orgId)),
    });
    if (!existing) throw new NotFoundException('Enrollment not found');

    const [updated] = await this.db.db
      .update(enrollments)
      .set({ ...dto, updatedAt: new Date() })
      .where(and(eq(enrollments.id, id), eq(enrollments.organizationId, orgId)))
      .returning();
    return updated!;
  }
}
