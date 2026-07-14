import { Injectable, NotFoundException, ConflictException, Logger } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import {
  staffMembers, staffPrivileges, teacherAssignments,
  users, memberships, passwordResetTokens, availability,
} from '@music-life/db';
import { DEFAULT_TEACHER_PRIVILEGES } from '@music-life/types';
import { randomBytes, createHash } from 'crypto';
import { DbService } from '../db/db.service';
import { EmailPort } from '../email/ports/email.port';
import type { CreateStaffDto } from './dto/create-staff.dto';
import type { UpdateStaffDto } from './dto/update-staff.dto';

@Injectable()
export class StaffService {
  private readonly logger = new Logger(StaffService.name);

  constructor(
    private readonly db: DbService,
    private readonly email: EmailPort,
  ) {}

  async findAll(orgId: string) {
    return this.db.db.query.staffMembers.findMany({
      where: and(eq(staffMembers.organizationId, orgId), eq(staffMembers.status, 'active')),
      with: {
        user: { columns: { id: true, email: true } },
        privileges: { columns: { privileges: true } },
      },
      orderBy: (s, { asc }) => [asc(s.lastName), asc(s.firstName)],
    });
  }

  /** A teacher's own staff record — used so the calendar can auto-assign them without exposing the full roster. */
  async findByUserId(orgId: string, userId: string) {
    return this.db.db.query.staffMembers.findFirst({
      where: and(eq(staffMembers.userId, userId), eq(staffMembers.organizationId, orgId)),
      columns: { id: true, firstName: true, lastName: true },
    });
  }

  async findOne(orgId: string, id: string) {
    const member = await this.db.db.query.staffMembers.findFirst({
      where: and(eq(staffMembers.id, id), eq(staffMembers.organizationId, orgId)),
      with: {
        user: { columns: { id: true, email: true } },
        privileges: true,
        assignments: {
          with: {
            student: { columns: { id: true, firstName: true, lastName: true, status: true } },
          },
        },
      },
    });
    if (!member) throw new NotFoundException('Staff member not found');
    return member;
  }

  async create(orgId: string, dto: CreateStaffDto) {
    let userId: string | undefined;

    // Auto-create user account if email provided
    if (dto.email) {
      const existing = await this.db.db.query.users.findFirst({
        where: eq(users.email, dto.email.toLowerCase()),
      });

      if (existing) {
        // Wire existing user to this org as teacher if not already
        const existingMembership = await this.db.db.query.memberships.findFirst({
          where: and(eq(memberships.userId, existing.id), eq(memberships.organizationId, orgId)),
        });
        if (!existingMembership) {
          await this.db.db.insert(memberships).values({
            userId: existing.id,
            organizationId: orgId,
            baseRole: 'teacher',
          });
        }
        userId = existing.id;
      } else {
        // Create new user (no password — they'll set it via invite)
        const [newUser] = await this.db.db
          .insert(users)
          .values({
            email: dto.email.toLowerCase(),
            passwordHash: 'INVITE_PENDING',
            emailVerifiedAt: new Date(), // pre-verified for invited staff
          })
          .returning();

        await this.db.db.insert(memberships).values({
          userId: newUser!.id,
          organizationId: orgId,
          baseRole: 'teacher',
        });

        userId = newUser!.id;
        // Non-blocking — staff creation succeeds even if invite email fails
        this.sendInviteEmail(newUser!.id, newUser!.email, dto.firstName).catch((err) =>
          this.logger.warn(`Invite email failed for ${newUser!.email}: ${err}`),
        );
      }
    }

    // Auto-add the teacher to the Sender mailing list (best-effort, non-blocking).
    if (dto.email) {
      this.email
        .addContact({ email: dto.email, name: `${dto.firstName} ${dto.lastName}`.trim(), audience: 'teachers' })
        .catch((err) => this.logger.warn(`Add-contact failed for ${dto.email}: ${err}`));
    }

    const { email: _email, ...staffData } = dto;
    const [member] = await this.db.db
      .insert(staffMembers)
      .values({ ...staffData, organizationId: orgId, userId })
      .returning();

    // Seed default privileges
    await this.db.db.insert(staffPrivileges).values({
      organizationId: orgId,
      staffId: member!.id,
      privileges: DEFAULT_TEACHER_PRIVILEGES,
    });

    return member!;
  }

  async update(orgId: string, id: string, dto: UpdateStaffDto) {
    await this.findOne(orgId, id);
    const { email: _email, ...staffData } = dto as UpdateStaffDto & { email?: string };
    const [updated] = await this.db.db
      .update(staffMembers)
      .set({ ...staffData, updatedAt: new Date() })
      .where(and(eq(staffMembers.id, id), eq(staffMembers.organizationId, orgId)))
      .returning();
    return updated!;
  }

  async updatePrivileges(orgId: string, staffId: string, privileges: Record<string, boolean>) {
    await this.findOne(orgId, staffId);
    const existing = await this.db.db.query.staffPrivileges.findFirst({
      where: eq(staffPrivileges.staffId, staffId),
    });

    if (existing) {
      await this.db.db
        .update(staffPrivileges)
        .set({ privileges, updatedAt: new Date() })
        .where(eq(staffPrivileges.staffId, staffId));
    } else {
      await this.db.db.insert(staffPrivileges).values({
        organizationId: orgId,
        staffId,
        privileges,
      });
    }
    return { staffId, privileges };
  }

  async assignStudent(orgId: string, staffId: string, studentId: string, role: 'primary' | 'secondary' = 'primary') {
    await this.findOne(orgId, staffId);
    await this.db.db
      .insert(teacherAssignments)
      .values({ organizationId: orgId, staffId, studentId, role })
      .onConflictDoUpdate({
        target: [teacherAssignments.staffId, teacherAssignments.studentId],
        set: { role },
      });
    return { staffId, studentId, role };
  }

  async removeAssignment(orgId: string, staffId: string, studentId: string) {
    await this.db.db
      .delete(teacherAssignments)
      .where(
        and(
          eq(teacherAssignments.staffId, staffId),
          eq(teacherAssignments.studentId, studentId),
          eq(teacherAssignments.organizationId, orgId),
        ),
      );
  }

  // ─── Availability windows ─────────────────────────────────────────────────
  /** Resolve the caller's own staff record id, so a teacher can only ever edit their own availability. */
  private async resolveOwnStaffId(orgId: string, userId: string): Promise<string> {
    const member = await this.db.db.query.staffMembers.findFirst({
      where: and(eq(staffMembers.userId, userId), eq(staffMembers.organizationId, orgId)),
      columns: { id: true },
    });
    if (!member) throw new NotFoundException('No staff profile is linked to this account');
    return member.id;
  }

  async getMyAvailability(orgId: string, userId: string) {
    return this.getAvailability(orgId, await this.resolveOwnStaffId(orgId, userId));
  }

  /** Every teacher's windows across the org — powers the admin calendar availability overlay. */
  async getAllAvailability(orgId: string) {
    return this.db.db.query.availability.findMany({
      where: eq(availability.organizationId, orgId),
      orderBy: (a, { asc }) => [asc(a.weekday), asc(a.startTime)],
    });
  }

  async addMyAvailability(orgId: string, userId: string, weekday: string, startTime: string, endTime: string) {
    return this.addAvailability(orgId, await this.resolveOwnStaffId(orgId, userId), weekday, startTime, endTime);
  }

  async removeMyAvailability(orgId: string, userId: string, windowId: string) {
    return this.removeAvailability(orgId, await this.resolveOwnStaffId(orgId, userId), windowId);
  }

  async getAvailability(orgId: string, staffId: string) {
    return this.db.db.query.availability.findMany({
      where: and(eq(availability.staffId, staffId), eq(availability.organizationId, orgId)),
      orderBy: (a, { asc }) => [asc(a.weekday), asc(a.startTime)],
    });
  }

  async addAvailability(orgId: string, staffId: string, weekday: string, startTime: string, endTime: string) {
    if (endTime <= startTime) {
      throw new ConflictException('End time must be after start time');
    }
    const [row] = await this.db.db.insert(availability).values({
      organizationId: orgId, staffId, weekday: weekday as typeof availability.$inferInsert['weekday'], startTime, endTime,
    }).returning();
    return row!;
  }

  async removeAvailability(orgId: string, staffId: string, windowId: string) {
    await this.db.db.delete(availability)
      .where(and(eq(availability.id, windowId), eq(availability.staffId, staffId), eq(availability.organizationId, orgId)));
    return { deleted: true };
  }

  private async sendInviteEmail(userId: string, emailAddr: string, firstName: string) {
    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    await this.db.db.insert(passwordResetTokens).values({ userId, tokenHash, expiresAt });

    const link = `${process.env.WEB_URL}/reset-password?token=${rawToken}`;
    await this.email.send({
      to: emailAddr,
      subject: "You've been added to Music & Life OS",
      html: `<p>Hi ${firstName},</p><p>You've been added as a teacher at Music &amp; Life. Set your password to access your portal:</p><p><a href="${link}">Set password</a></p><p>This link expires in 7 days.</p>`,
    });
    this.logger.log(`Invite sent to ${emailAddr}`);
  }
}
