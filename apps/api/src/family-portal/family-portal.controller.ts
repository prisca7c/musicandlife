import {
  Controller, Get, Post, Param, Body, Query,
  UseGuards, NotFoundException, BadRequestException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { DbService } from '../db/db.service';
import { EmailPort } from '../email/ports/email.port';
import { eq, and, gte, lte, ne, inArray } from 'drizzle-orm';
import {
  lessons, lessonCredits, notes, families, memberships, guardians,
  students, availability, blockedTime, enrollments, staffMembers,
  teacherAssignments, attendance,
} from '@music-life/db';
import { AttendanceService } from '../attendance/attendance.service';
import { BillingService } from '../billing/billing.service';
import { invoices } from '@music-life/db';
import type { RequestUser } from '@music-life/types';
import { IsBoolean, IsDateString, IsInt, IsOptional, IsUUID, Min, IsIn } from 'class-validator';
import { Type } from 'class-transformer';

const WEEKDAY_MAP: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
  thursday: 4, friday: 5, saturday: 6,
};

class BookLessonDto {
  @IsUUID() teacherId!: string;
  @IsUUID() studentId!: string;
  @IsUUID() enrollmentId!: string;
  @IsDateString() startsAt!: string;
  @IsInt() @Min(15) duration!: number;
  @IsOptional() @IsBoolean() @Type(() => Boolean) isTrialLesson?: boolean;
  @IsOptional() @IsUUID() roomId?: string;
}

class CancelLessonDto {
  @IsIn(['absent_makeup', 'absent_no_pay']) choice!: 'absent_makeup' | 'absent_no_pay';
}

@Controller('family')
@UseGuards(JwtAuthGuard, RolesGuard)
export class FamilyPortalController {
  constructor(
    private readonly db: DbService,
    private readonly email: EmailPort,
    private readonly attendance: AttendanceService,
    private readonly billing: BillingService,
  ) {}

  // ─── Resolve the guardian's family ───────────────────────────────────────
  private async requireFamily(userId: string, orgId: string) {
    const guardian = await this.db.db.query.guardians.findFirst({
      where: and(eq(guardians.userId, userId), eq(guardians.organizationId, orgId)),
    });
    if (!guardian) throw new NotFoundException('No family found for this user');

    const family = await this.db.db.query.families.findFirst({
      where: eq(families.id, guardian.familyId),
      with: { students: { columns: { id: true } } },
    });
    if (!family) throw new NotFoundException('Family not found');
    return family;
  }

  // ─── Lesson history ───────────────────────────────────────────────────────
  @Get('lessons')
  @Roles('guardian')
  async getLessonHistory(
    @CurrentUser() user: RequestUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const family = await this.requireFamily(user.userId, user.orgId);
    const studentIds = family.students.map(s => s.id);
    if (studentIds.length === 0) return [];

    const rows = await this.db.db.query.lessons.findMany({
      where: and(
        eq(lessons.organizationId, user.orgId),
        from ? gte(lessons.startsAt, new Date(from)) : undefined,
        to ? lte(lessons.startsAt, new Date(`${to}T23:59:59`)) : undefined,
      ),
      with: {
        student: { columns: { id: true, firstName: true, lastName: true } },
        teacher: { columns: { id: true, firstName: true, lastName: true } },
        attendance: { columns: { status: true } },
        enrollment: { columns: { instrument: true, lessonType: true } },
      },
      orderBy: (l, { desc }) => [desc(l.startsAt)],
    });

    return rows.filter(l => studentIds.includes(l.studentId));
  }

  // ─── Dashboard ────────────────────────────────────────────────────────────
  @Get('dashboard')
  @Roles('guardian')
  async dashboard(@CurrentUser() user: RequestUser) {
    const guardian = await this.db.db.query.guardians.findFirst({
      where: and(eq(guardians.userId, user.userId), eq(guardians.organizationId, user.orgId)),
    });
    if (!guardian) return { nextLesson: null, balance: 0, outstandingInvoice: null, students: [], lastNote: null };

    const family = await this.db.db.query.families.findFirst({
      where: eq(families.id, guardian.familyId),
      with: { students: { columns: { id: true, firstName: true, lastName: true, status: true } } },
    });
    if (!family) return { nextLesson: null, balance: 0, outstandingInvoice: null, students: [], lastNote: null };

    const studentIds = family.students.map(s => s.id);
    const now = new Date();

    // Per-student lesson credit balances
    const studentsWithCredits = await Promise.all(
      family.students.map(async s => {
        const { total, prepaid, makeup } = await this.attendance.getLessonCreditBalance(user.orgId, s.id);
        return { ...s, lessons: { total, prepaid, makeup } };
      }),
    );

    // Next lesson across all students
    let nextLesson = null;
    if (studentIds.length > 0) {
      const upcoming = await this.db.db.query.lessons.findMany({
        where: and(eq(lessons.organizationId, user.orgId), eq(lessons.status, 'scheduled'), gte(lessons.startsAt, now)),
        with: {
          student: { columns: { id: true, firstName: true, lastName: true } },
          teacher: { columns: { id: true, firstName: true, lastName: true } },
        },
        orderBy: (l, { asc }) => [asc(l.startsAt)],
        limit: 10,
      });
      const familyLesson = upcoming.find(l => studentIds.includes(l.studentId));
      if (familyLesson) {
        nextLesson = {
          id: familyLesson.id,
          startsAt: familyLesson.startsAt,
          duration: familyLesson.duration,
          isTrialLesson: familyLesson.isTrialLesson,
          teacher: familyLesson.teacher,
          student: familyLesson.student,
        };
      }
    }

    // Outstanding invoice
    const outstandingInvoice = await this.db.db.query.invoices.findFirst({
      where: and(
        eq(invoices.familyId, family.id),
        eq(invoices.organizationId, user.orgId),
        eq(invoices.status, 'sent'),
      ),
      orderBy: (i, { asc }) => [asc(i.dueDate)],
    });

    // Most recent family-visible note
    let lastNote = null;
    if (studentIds.length > 0) {
      const recentNote = await this.db.db.query.notes.findFirst({
        where: and(eq(notes.organizationId, user.orgId), eq(notes.visibility, 'family')),
        with: { student: { columns: { id: true, firstName: true, lastName: true } } },
        orderBy: (n, { desc }) => [desc(n.createdAt)],
      });
      if (recentNote && studentIds.includes(recentNote.studentId)) lastNote = recentNote;
    }

    return {
      nextLesson,
      balance: family.balanceCached,
      outstandingInvoice: outstandingInvoice
        ? { id: outstandingInvoice.id, number: outstandingInvoice.number, total: outstandingInvoice.total, dueDate: outstandingInvoice.dueDate }
        : null,
      students: studentsWithCredits,
      lastNote,
    };
  }

  // ─── Self-service payment ───────────────────────────────────────────────────
  // A parent marks their own invoice as paid (e.g. after making the bank
  // transfer shown on the invoice). We record a self-reported bank-transfer
  // payment for the full invoice total, which moves the family balance and marks
  // the invoice paid. Idempotent per invoice, so a double-tap pays exactly once.
  // The payment note flags it as self-reported so staff can reconcile it against
  // the actual bank statement.
  @Post('invoices/:id/mark-paid')
  @Roles('guardian')
  async markInvoicePaid(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    const family = await this.requireFamily(user.userId, user.orgId);

    const inv = await this.db.db.query.invoices.findFirst({
      where: and(eq(invoices.id, id), eq(invoices.organizationId, user.orgId)),
    });
    if (!inv || inv.familyId !== family.id) throw new NotFoundException('Invoice not found');
    if (inv.status === 'void') throw new BadRequestException('This invoice has been cancelled.');
    if (inv.status === 'paid') return { status: 'paid', alreadyPaid: true };
    if (inv.total <= 0) throw new BadRequestException('This invoice has nothing to pay.');

    const payment = await this.billing.recordPayment(user.orgId, {
      familyId: family.id,
      invoiceId: inv.id,
      method: 'bank_transfer',
      amount: inv.total,
      notes: 'Self-reported as paid by the family via the parent portal.',
      // Stable per-invoice key → repeat taps return the same payment, never double-charge.
      idempotencyKey: `self-pay-${inv.id}`,
    });

    return { status: 'paid', paymentId: payment.id };
  }

  // ─── Available booking slots ───────────────────────────────────────────────
  // Returns open time slots for a teacher in a given week, filtered by duration.
  @Get('availability')
  @Roles('guardian')
  async getAvailability(
    @CurrentUser() user: RequestUser,
    @Query('teacherId') teacherId: string,
    @Query('weekStart') weekStart: string, // ISO date string, e.g. "2026-06-09"
    @Query('duration') durationStr = '60',
  ) {
    const duration = parseInt(durationStr, 10);
    if (!teacherId || !weekStart) throw new BadRequestException('teacherId and weekStart are required');

    const start = new Date(weekStart);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start.getTime() + 7 * 86400000);
    const now = new Date();

    const [windows, existingLessons, blocked] = await Promise.all([
      this.db.db.query.availability.findMany({
        where: and(eq(availability.staffId, teacherId), eq(availability.organizationId, user.orgId)),
      }),
      this.db.db.query.lessons.findMany({
        where: and(
          eq(lessons.organizationId, user.orgId),
          eq(lessons.teacherId, teacherId),
          eq(lessons.status, 'scheduled'),
          gte(lessons.startsAt, start),
          lte(lessons.startsAt, end),
        ),
      }),
      this.db.db.query.blockedTime.findMany({
        where: and(
          eq(blockedTime.staffId, teacherId),
          gte(blockedTime.startsAt, start),
          lte(blockedTime.endsAt, end),
        ),
      }),
    ]);

    const slots: { startsAt: string; endsAt: string }[] = [];

    for (const win of windows) {
      const dayIdx = WEEKDAY_MAP[win.weekday];
      if (dayIdx === undefined) continue;

      // Find the actual calendar date for this weekday in the requested week
      const weekStartDay = start.getDay(); // 0 = Sunday
      const dayOffset = (dayIdx - weekStartDay + 7) % 7;
      const slotDate = new Date(start.getTime() + dayOffset * 86400000);

      const [sh, sm] = win.startTime.split(':').map(Number);
      const [eh, em] = win.endTime.split(':').map(Number);

      let cursor = new Date(slotDate);
      cursor.setHours(sh!, sm!, 0, 0);
      const windowEnd = new Date(slotDate);
      windowEnd.setHours(eh!, em!, 0, 0);

      while (cursor.getTime() + duration * 60000 <= windowEnd.getTime()) {
        const slotEnd = new Date(cursor.getTime() + duration * 60000);

        const inPast = cursor <= now;
        const lessonConflict = existingLessons.some(l => {
          const lEnd = new Date(l.startsAt.getTime() + l.duration * 60000);
          return l.startsAt < slotEnd && lEnd > cursor;
        });
        const blockedConflict = blocked.some(b => b.startsAt < slotEnd && b.endsAt > cursor);

        if (!inPast && !lessonConflict && !blockedConflict) {
          slots.push({ startsAt: cursor.toISOString(), endsAt: slotEnd.toISOString() });
        }

        cursor = new Date(cursor.getTime() + duration * 60000);
      }
    }

    return slots.sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
  }

  // ─── Book a lesson ────────────────────────────────────────────────────────
  @Post('lessons')
  @Roles('guardian')
  async bookLesson(@CurrentUser() user: RequestUser, @Body() dto: BookLessonDto) {
    const family = await this.requireFamily(user.userId, user.orgId);

    // Verify student belongs to this family
    if (!family.students.some(s => s.id === dto.studentId)) {
      throw new BadRequestException('Student does not belong to your family');
    }

    // Verify enrollment belongs to this student
    const enrollment = await this.db.db.query.enrollments.findFirst({
      where: and(eq(enrollments.id, dto.enrollmentId), eq(enrollments.studentId, dto.studentId)),
    });
    if (!enrollment) throw new NotFoundException('Enrollment not found');

    // Re-check availability (prevent race condition)
    const slotStart = new Date(dto.startsAt);
    const slotEnd = new Date(slotStart.getTime() + dto.duration * 60000);

    const conflict = await this.db.db.query.lessons.findFirst({
      where: and(
        eq(lessons.organizationId, user.orgId),
        eq(lessons.teacherId, dto.teacherId),
        eq(lessons.status, 'scheduled'),
        lte(lessons.startsAt, slotEnd),
        gte(lessons.startsAt, new Date(slotStart.getTime() - dto.duration * 60000)),
      ),
    });
    if (conflict) {
      const conflictEnd = new Date(conflict.startsAt.getTime() + conflict.duration * 60000);
      if (conflict.startsAt < slotEnd && conflictEnd > slotStart) {
        throw new BadRequestException('This slot is no longer available');
      }
    }

    const teacher = await this.db.db.query.staffMembers.findFirst({
      where: and(eq(staffMembers.id, dto.teacherId), eq(staffMembers.organizationId, user.orgId)),
      with: { user: { columns: { email: true } } },
    });
    if (!teacher) throw new NotFoundException('Teacher not found');

    const student = await this.db.db.query.students.findFirst({
      where: eq(students.id, dto.studentId),
      with: { family: { columns: { email: true, name: true } } },
    });

    const [lesson] = await this.db.db.insert(lessons).values({
      organizationId: user.orgId,
      studentId: dto.studentId,
      teacherId: dto.teacherId,
      enrollmentId: dto.enrollmentId,
      termId: enrollment.termId ?? undefined,
      startsAt: slotStart,
      duration: dto.duration,
      isTrialLesson: dto.isTrialLesson ?? false,
      roomId: dto.roomId ?? undefined,
      status: 'scheduled',
    }).returning();

    // Send confirmation emails (non-blocking)
    this.sendBookingConfirmations(user.orgId, lesson!, teacher, student!, enrollment.instrument, !!dto.isTrialLesson)
      .catch(err => console.warn('Booking email failed:', err));

    return lesson!;
  }

  // ─── Cancel a lesson (family portal) ─────────────────────────────────────
  // Choice: absent_makeup (≥24h, get a credit) or absent_no_pay (≥24h, no credit no charge).
  // <24h: auto absent_no_makeup (teacher paid, no credit).
  @Post('lessons/:id/cancel')
  @Roles('guardian')
  async cancelLesson(
    @CurrentUser() user: RequestUser,
    @Param('id') lessonId: string,
    @Body() dto: CancelLessonDto,
  ) {
    const family = await this.requireFamily(user.userId, user.orgId);
    const studentIds = family.students.map(s => s.id);

    const lesson = await this.db.db.query.lessons.findFirst({
      where: and(eq(lessons.id, lessonId), eq(lessons.organizationId, user.orgId)),
    });
    if (!lesson) throw new NotFoundException('Lesson not found');
    if (!studentIds.includes(lesson.studentId)) throw new BadRequestException('Not your lesson');
    if (lesson.status !== 'scheduled') throw new BadRequestException('Lesson is not scheduled');

    const hoursUntil = (lesson.startsAt.getTime() - Date.now()) / 3600000;

    // <24h: student forfeits credit, teacher gets paid
    const status = hoursUntil < 24 ? 'absent_no_makeup' : dto.choice;

    await this.attendance.markAttendance(user.orgId, lessonId, { status }, user.userId);

    return { id: lessonId, status, hoursUntil: Math.round(hoursUntil) };
  }

  // ─── List teachers with availability (for booking picker) ─────────────────
  @Get('teachers')
  @Roles('guardian')
  async getTeachers(@CurrentUser() user: RequestUser) {
    const teachers = await this.db.db.query.staffMembers.findMany({
      where: and(eq(staffMembers.organizationId, user.orgId), eq(staffMembers.status, 'active')),
      columns: { id: true, firstName: true, lastName: true, instruments: true, defaultDuration: true },
    });
    return teachers;
  }

  // ─── This family's own teachers' weekly availability windows ───────────────
  // Powers the "when your teacher is free" visual on the family dashboard. Only
  // returns windows for teachers the family's students are actually linked to
  // (via enrollment or assignment), so families don't see the whole roster.
  @Get('teacher-availability')
  @Roles('guardian')
  async teacherAvailability(@CurrentUser() user: RequestUser) {
    const guardian = await this.db.db.query.guardians.findFirst({
      where: and(eq(guardians.userId, user.userId), eq(guardians.organizationId, user.orgId)),
    });
    if (!guardian) return [];
    const family = await this.db.db.query.families.findFirst({
      where: eq(families.id, guardian.familyId),
      with: { students: { columns: { id: true } } },
    });
    const studentIds = family?.students.map(s => s.id) ?? [];
    if (studentIds.length === 0) return [];

    const [enr, assigns] = await Promise.all([
      this.db.db.query.enrollments.findMany({
        where: and(eq(enrollments.organizationId, user.orgId), inArray(enrollments.studentId, studentIds)),
        columns: { teacherId: true },
      }),
      this.db.db.query.teacherAssignments.findMany({
        where: and(eq(teacherAssignments.organizationId, user.orgId), inArray(teacherAssignments.studentId, studentIds)),
        columns: { staffId: true },
      }),
    ]);
    const teacherIds = [...new Set([
      ...enr.map(e => e.teacherId).filter((id): id is string => !!id),
      ...assigns.map(a => a.staffId),
    ])];
    if (teacherIds.length === 0) return [];

    const [wins, teachers] = await Promise.all([
      this.db.db.query.availability.findMany({
        where: and(eq(availability.organizationId, user.orgId), inArray(availability.staffId, teacherIds)),
        orderBy: (a, { asc }) => [asc(a.weekday), asc(a.startTime)],
      }),
      this.db.db.query.staffMembers.findMany({
        where: and(eq(staffMembers.organizationId, user.orgId), inArray(staffMembers.id, teacherIds)),
        columns: { id: true, firstName: true, lastName: true },
      }),
    ]);
    const nameById = Object.fromEntries(teachers.map(t => [t.id, `${t.firstName} ${t.lastName}`]));
    return wins.map(w => ({
      id: w.id, staffId: w.staffId, weekday: w.weekday, startTime: w.startTime, endTime: w.endTime,
      teacherName: nameById[w.staffId] ?? 'Teacher',
    }));
  }

  // ─── Confirmation emails ──────────────────────────────────────────────────
  private async sendBookingConfirmations(
    orgId: string,
    lesson: { id: string; startsAt: Date; duration: number },
    teacher: { firstName: string; lastName: string; user?: { email: string } | null },
    student: { firstName: string; lastName: string; family?: { email: string | null; name: string } | null },
    instrument: string,
    isTrial: boolean,
  ) {
    const dateStr = lesson.startsAt.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const timeStr = lesson.startsAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    const teacherName = `${teacher.firstName} ${teacher.lastName}`;
    const studentName = `${student.firstName} ${student.lastName}`;
    const trialNote = isTrial ? '<p><strong>This is a trial lesson.</strong></p>' : '';

    const html = `
      <h2 style="color:#2A5A3D">Lesson Confirmed</h2>
      ${trialNote}
      <p>A ${isTrial ? 'trial ' : ''}lesson has been booked:</p>
      <table>
        <tr><td><strong>Student:</strong></td><td>${studentName}</td></tr>
        <tr><td><strong>Teacher:</strong></td><td>${teacherName}</td></tr>
        <tr><td><strong>Instrument:</strong></td><td style="text-transform:capitalize">${instrument}</td></tr>
        <tr><td><strong>Date:</strong></td><td>${dateStr}</td></tr>
        <tr><td><strong>Time:</strong></td><td>${timeStr}</td></tr>
        <tr><td><strong>Duration:</strong></td><td>${lesson.duration} minutes</td></tr>
      </table>
      <p style="color:#888;font-size:12px;margin-top:24px">Music &amp; Life</p>
    `;

    const subject = `Lesson confirmed — ${studentName} with ${teacherName} on ${dateStr}`;
    const recipients: string[] = [];

    if (student.family?.email) recipients.push(student.family.email);
    if (teacher.user?.email) recipients.push(teacher.user.email);

    // Also notify org admins
    const admins = await this.db.db.query.memberships.findMany({
      where: and(eq(memberships.organizationId, orgId), eq(memberships.baseRole, 'admin')),
      with: { user: { columns: { email: true } } },
    });
    for (const a of admins) {
      if (a.user?.email && !recipients.includes(a.user.email)) recipients.push(a.user.email);
    }

    if (recipients.length > 0) {
      await this.email.send({ to: recipients, subject, html });
    }
  }
}
