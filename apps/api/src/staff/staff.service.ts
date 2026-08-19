import { Injectable, NotFoundException, ConflictException, BadRequestException, Logger } from '@nestjs/common';
import { eq, and, gte } from 'drizzle-orm';
import {
  staffMembers, staffPrivileges, teacherAssignments,
  users, memberships, passwordResetTokens, availability, blockedTime, students, lessons,
} from '@music-life/db';
import { DEFAULT_TEACHER_PRIVILEGES } from '@music-life/types';
import { randomBytes, createHash } from 'crypto';
import { DbService } from '../db/db.service';
import { EmailPort } from '../email/ports/email.port';
import { brandedEmail } from '../email/branding';
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
        assignments: { columns: { id: true } },
      },
      orderBy: (s, { asc }) => [asc(s.firstName), asc(s.lastName)],
    });
  }

  /**
   * A minimal active-staff list (id + name only) any teacher may read — enough to
   * colour and filter the whole-studio calendar without exposing pay, contact
   * details, or privileges the way findAll does.
   */
  async roster(orgId: string) {
    return this.db.db.query.staffMembers.findMany({
      where: and(eq(staffMembers.organizationId, orgId), eq(staffMembers.status, 'active')),
      columns: { id: true, firstName: true, lastName: true },
      orderBy: (s, { asc }) => [asc(s.firstName), asc(s.lastName)],
    });
  }

  /**
   * The colleague directory: any teacher may see every other active teacher's
   * name and contact info (phone + login email), but nothing else — no notes,
   * pay rate, payroll balance, or tags. Deliberately mirrors roster()'s minimal
   * `columns` projection rather than findAll()'s full record.
   */
  async directory(orgId: string) {
    return this.db.db.query.staffMembers.findMany({
      where: and(eq(staffMembers.organizationId, orgId), eq(staffMembers.status, 'active')),
      columns: { id: true, firstName: true, lastName: true, title: true, phone: true, instruments: true },
      with: { user: { columns: { email: true } } },
      orderBy: (s, { asc }) => [asc(s.firstName), asc(s.lastName)],
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
    const existing = await this.findOne(orgId, id);
    const { email, ...staffData } = dto as UpdateStaffDto & { email?: string };

    // Email lives on the linked `users` row (it's the login identifier), not on
    // staffMembers — update it there, separately from the rest of the contact
    // fields.
    if (email && existing.user) {
      const normalized = email.trim().toLowerCase();
      if (normalized !== existing.user.email) {
        const clash = await this.db.db.query.users.findFirst({ where: eq(users.email, normalized) });
        if (clash && clash.id !== existing.user.id) {
          throw new ConflictException('Another account already uses that email.');
        }
        await this.db.db.update(users).set({ email: normalized }).where(eq(users.id, existing.user.id));
      }
    } else if (email && !existing.user) {
      // A staff row with no linked login account previously had no way to gain
      // an email — the field was permanently locked to "—" in the UI. Mirror
      // create()'s auto-account logic: wire up (or create) a user account and
      // link it, the same as if the email had been set at creation time.
      const normalized = email.trim().toLowerCase();
      const clash = await this.db.db.query.users.findFirst({ where: eq(users.email, normalized) });
      let userId: string;
      if (clash) {
        const existingMembership = await this.db.db.query.memberships.findFirst({
          where: and(eq(memberships.userId, clash.id), eq(memberships.organizationId, orgId)),
        });
        if (!existingMembership) {
          await this.db.db.insert(memberships).values({ userId: clash.id, organizationId: orgId, baseRole: 'teacher' });
        }
        userId = clash.id;
      } else {
        const [newUser] = await this.db.db
          .insert(users)
          .values({ email: normalized, passwordHash: 'INVITE_PENDING', emailVerifiedAt: new Date() })
          .returning();
        await this.db.db.insert(memberships).values({ userId: newUser!.id, organizationId: orgId, baseRole: 'teacher' });
        userId = newUser!.id;
        this.sendInviteEmail(userId, newUser!.email, existing.firstName).catch((err) =>
          this.logger.warn(`Invite email failed for ${newUser!.email}: ${err}`),
        );
      }
      await this.db.db.update(staffMembers).set({ userId }).where(eq(staffMembers.id, id));
    }

    // Deactivating a teacher must also clear their diary — same failure mode #172
    // already fixed for the nightly recurrence worker (it now skips inactive
    // teachers going forward), but a teacher's already-scheduled future lessons
    // were never cancelled, so they stayed bookable/attendable/billable under a
    // teacher who'd left. Cancel every future scheduled lesson at no charge in
    // the same transaction as the status flip, mirroring students.remove()'s
    // withdrawal teardown. Past/completed lessons are untouched.
    if (staffData.status === 'inactive' && existing.status !== 'inactive') {
      return this.db.db.transaction(async (tx) => {
        const now = new Date();
        const [updated] = await tx
          .update(staffMembers)
          .set({ ...staffData, updatedAt: now })
          .where(and(eq(staffMembers.id, id), eq(staffMembers.organizationId, orgId)))
          .returning();

        const cancelled = await tx
          .update(lessons)
          .set({ status: 'cancelled_no_pay', cancelledAt: now, updatedAt: now })
          .where(and(
            eq(lessons.organizationId, orgId),
            eq(lessons.teacherId, id),
            eq(lessons.status, 'scheduled'),
            gte(lessons.startsAt, now),
          ))
          .returning({ id: lessons.id });

        return { ...updated!, cancelledLessons: cancelled.length };
      });
    }

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
    const staff = await this.findOne(orgId, staffId);
    // findOne() is deliberately status-agnostic (admins need to view inactive
    // staff too), so it doesn't guard this write path on its own. Assigning a
    // student to an inactive teacher — or a withdrawn student to any teacher —
    // is the same class of gap enrollments.create already closed for
    // enrolments (assertTeacherAndTermInOrg): the resulting link resurfaces in
    // teacher-scoped student views (getAssignedStudentIds) with no lesson/
    // billing guard rail anywhere else expecting it to exist.
    if (staff.status !== 'active') {
      throw new BadRequestException('This teacher is not active. Choose an active teacher, or reactivate them first.');
    }
    // Guard the caller-supplied studentId the same way: an id from another studio
    // (or a bogus one) would otherwise 500 on the FK violation or, if valid,
    // cross-link another org's student to this teacher.
    const student = await this.db.db.query.students.findFirst({
      where: and(eq(students.id, studentId), eq(students.organizationId, orgId)),
      columns: { id: true, status: true },
    });
    if (!student) throw new NotFoundException('Student not found');
    if (student.status === 'withdrawn') {
      throw new BadRequestException('This student has been withdrawn and can’t be assigned a teacher.');
    }
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
    return { deleted: true };
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
    return (await this.addAvailabilityDays(orgId, staffId, [weekday], startTime, endTime))[0]!;
  }

  /**
   * Add the same window to several days at once.
   *
   * A teacher who works 4–8pm Monday to Friday had to open the dialog, choose a
   * day and re-enter the same two times, five times over. Days already covering
   * that exact window are skipped, so re-submitting is harmless.
   */
  async addAvailabilityDays(orgId: string, staffId: string, weekdays: string[], startTime: string, endTime: string) {
    if (endTime <= startTime) {
      throw new ConflictException('End time must be after start time');
    }
    const days = [...new Set(weekdays)];
    if (days.length === 0) throw new ConflictException('Choose at least one day');

    const existing = await this.db.db.query.availability.findMany({
      where: and(eq(availability.staffId, staffId), eq(availability.organizationId, orgId)),
      columns: { weekday: true, startTime: true, endTime: true },
    });
    const already = new Set(existing.map(w => `${w.weekday}|${w.startTime}|${w.endTime}`));
    const toAdd = days.filter(d => !already.has(`${d}|${startTime}|${endTime}`));
    if (toAdd.length === 0) return [];

    return this.db.db.insert(availability).values(
      toAdd.map(d => ({
        organizationId: orgId, staffId,
        weekday: d as typeof availability.$inferInsert['weekday'],
        startTime, endTime,
      })),
    ).returning();
  }

  // ─── Time off ─────────────────────────────────────────────────────────────
  // The blocked_time table has always been honoured by the slot generator and
  // the booking conflict check (scheduling.service.ts) — there was simply no way
  // to create a row. A teacher going on holiday had to delete their weekly
  // windows and remember to put them back. Time off is a dated exception that
  // leaves the weekly pattern alone.
  async getTimeOff(orgId: string, staffId: string) {
    return this.db.db.query.blockedTime.findMany({
      where: and(eq(blockedTime.staffId, staffId), eq(blockedTime.organizationId, orgId)),
      orderBy: (b, { asc }) => [asc(b.startsAt)],
    });
  }

  async addTimeOff(orgId: string, staffId: string, startsAt: string, endsAt: string, reason?: string) {
    const from = new Date(startsAt);
    const to = new Date(endsAt);
    if (isNaN(from.getTime()) || isNaN(to.getTime())) {
      throw new ConflictException('Invalid dates');
    }
    if (to <= from) throw new ConflictException('The end must be after the start');

    const [row] = await this.db.db.insert(blockedTime).values({
      organizationId: orgId, staffId, startsAt: from, endsAt: to, reason: reason ?? null,
    }).returning();
    return row!;
  }

  async removeTimeOff(orgId: string, staffId: string, id: string) {
    const [removed] = await this.db.db.delete(blockedTime)
      .where(and(
        eq(blockedTime.id, id),
        eq(blockedTime.staffId, staffId),
        eq(blockedTime.organizationId, orgId),
      ))
      .returning();
    if (!removed) throw new NotFoundException('Time off not found');
    return { id };
  }

  async getMyTimeOff(orgId: string, userId: string) {
    return this.getTimeOff(orgId, await this.resolveOwnStaffId(orgId, userId));
  }

  async addMyTimeOff(orgId: string, userId: string, startsAt: string, endsAt: string, reason?: string) {
    return this.addTimeOff(orgId, await this.resolveOwnStaffId(orgId, userId), startsAt, endsAt, reason);
  }

  async removeMyTimeOff(orgId: string, userId: string, id: string) {
    return this.removeTimeOff(orgId, await this.resolveOwnStaffId(orgId, userId), id);
  }

  async addMyAvailabilityDays(orgId: string, userId: string, weekdays: string[], startTime: string, endTime: string) {
    return this.addAvailabilityDays(orgId, await this.resolveOwnStaffId(orgId, userId), weekdays, startTime, endTime);
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
    const safeName = firstName.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]!));
    await this.email.send({
      to: emailAddr,
      subject: "You've been added to Music & Life OS",
      // Was a bare, unstyled <p> string — every other outbound email in the
      // app goes through the shared branded shell (logo, colours, centred
      // card); this one didn't, so it rendered as plain left-aligned black
      // text with no branding at all.
      html: brandedEmail({
        previewText: "You've been added as a teacher. Set your password to get started.",
        heading: 'Welcome to Music & Life!',
        bodyHtml: `<p style="margin:0 0 12px">Hi ${safeName},</p><p style="margin:0">You&rsquo;ve been added as a teacher at Music &amp; Life. Set your password to access your portal.</p>`,
        cta: { label: 'Set your password', url: link },
        footnote: 'This link expires in 7 days.',
      }),
    });
    this.logger.log(`Invite sent to ${emailAddr}`);
  }
}
