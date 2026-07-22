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
  students, availability, enrollments, staffMembers,
  teacherAssignments, attendance, paymentClaims,
} from '@music-life/db';
import { AttendanceService } from '../attendance/attendance.service';
import { BillingService } from '../billing/billing.service';
import { ReconciliationService } from '../billing/reconciliation.service';
import { SchedulingService } from '../scheduling/scheduling.service';
import { FilesService } from '../files/files.service';
import { invoices } from '@music-life/db';
import type { RequestUser } from '@music-life/types';

// Shape of the entries stored in notes.attachments (see NotesController).
interface NoteAttachment { fileId: string; name: string; mime: string; size?: number }
import { IsBoolean, IsDateString, IsInt, IsOptional, IsUUID, Min, Max, IsIn } from 'class-validator';
import { Type } from 'class-transformer';

class BookLessonDto {
  @IsUUID() teacherId!: string;
  @IsUUID() studentId!: string;
  @IsUUID() enrollmentId!: string;
  @IsDateString() startsAt!: string;
  @IsInt() @Min(15) @Max(240) duration!: number;
  @IsOptional() @IsBoolean() @Type(() => Boolean) isTrialLesson?: boolean;
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
    private readonly recon: ReconciliationService,
    private readonly scheduling: SchedulingService,
    private readonly files: FilesService,
  ) {}

  // ─── Resolve the caller's family ─────────────────────────────────────────
  // Works for BOTH a guardian (parent) and a student — a logged-in student is
  // linked to their family via students.userId, so the whole family portal is
  // reachable by either. Returns the familyId or null.
  private async resolveFamilyId(userId: string, orgId: string): Promise<string | null> {
    const guardian = await this.db.db.query.guardians.findFirst({
      where: and(eq(guardians.userId, userId), eq(guardians.organizationId, orgId)),
      columns: { familyId: true },
    });
    if (guardian) return guardian.familyId;

    const student = await this.db.db.query.students.findFirst({
      where: and(eq(students.studentUserId, userId), eq(students.organizationId, orgId)),
      columns: { familyId: true },
    });
    return student?.familyId ?? null;
  }

  private async requireFamily(userId: string, orgId: string) {
    const familyId = await this.resolveFamilyId(userId, orgId);
    if (!familyId) throw new NotFoundException('No family found for this user');

    const family = await this.db.db.query.families.findFirst({
      where: eq(families.id, familyId),
      with: { students: { columns: { id: true } } },
    });
    if (!family) throw new NotFoundException('Family not found');
    return family;
  }

  // ─── Lesson history ───────────────────────────────────────────────────────
  @Get('lessons')
  @Roles('student')
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
  @Roles('student')
  async dashboard(@CurrentUser() user: RequestUser) {
    const familyId = await this.resolveFamilyId(user.userId, user.orgId);
    if (!familyId) return { nextLesson: null, balance: 0, outstandingInvoice: null, students: [], lastNote: null };

    const family = await this.db.db.query.families.findFirst({
      where: eq(families.id, familyId),
      with: {
        students: {
          columns: { id: true, firstName: true, lastName: true, status: true },
          // The booking page turns these into the "Instrument / Class" picker,
          // so every student must ship its enrollments (was missing → the picker
          // was always empty → "no enrollments available").
          with: {
            enrollments: {
              columns: {
                id: true, instrument: true, rate: true,
                teacherId: true, lessonType: true, status: true,
                // The student's contracted lesson length. The booking page used
                // the TEACHER's default instead, so a 30-minute pupil was booked
                // (and charged) for a 60-minute slot whenever their teacher's
                // default was 60.
                defaultDuration: true,
              },
            },
          },
        },
      },
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
  /**
   * "I've sent the transfer."
   *
   * This does NOT mark the invoice paid. The studio is paid by bank transfer,
   * so nothing here can see whether the money actually moved — this used to
   * record a real payment on the family's word alone, which meant a parent
   * who never sent anything could clear their own invoice. It now raises a
   * claim that settles only once a matching line shows up on the imported bank
   * statement (or a staff member confirms it by hand).
   */
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
    // Only issued (sent) invoices are payable. Drafts are staff-only, not yet
    // finalised, and are hidden from the family's list — so they must never be
    // transitioned to paid from the parent portal.
    if (inv.status !== 'sent') throw new NotFoundException('Invoice not found');
    if (inv.total <= 0) throw new BadRequestException('This invoice has nothing to pay.');

    const claim = await this.recon.createClaim(user.orgId, family.id, inv.id, inv.total);

    // If the money had already landed and been imported, createClaim settles it
    // immediately — tell the parent the truth either way.
    return {
      status: claim.status === 'confirmed' ? 'paid' : 'awaiting_confirmation',
      claimId: claim.id,
      reference: claim.reference,
      amount: claim.amount,
    };
  }

  /**
   * The details a family needs in order to pay: their own reference (the thing
   * that makes an incoming transfer identifiable) plus any claim still waiting
   * to be confirmed.
   */
  @Get('payment-details')
  @Roles('guardian')
  async getPaymentDetails(@CurrentUser() user: RequestUser) {
    const family = await this.requireFamily(user.userId, user.orgId);
    const reference = await this.recon.ensureReference(user.orgId, family.id);
    const pending = await this.db.db.query.paymentClaims.findMany({
      where: and(
        eq(paymentClaims.organizationId, user.orgId),
        eq(paymentClaims.familyId, family.id),
        eq(paymentClaims.status, 'pending'),
      ),
      columns: { id: true, amount: true, invoiceId: true, createdAt: true },
    });
    return { reference, pendingClaims: pending };
  }

  // ─── This family's invoices (read-only) ─────────────────────────────────────
  // Parents RECEIVE invoices — they never create them — so this list is view-only
  // and scoped to the caller's own family (staff use the admin /invoices route).
  @Get('invoices')
  @Roles('guardian')
  async getFamilyInvoices(@CurrentUser() user: RequestUser) {
    const family = await this.requireFamily(user.userId, user.orgId);
    const rows = await this.db.db.query.invoices.findMany({
      // Parents see issued invoices (sent/paid/void) — not staff-only drafts.
      where: and(
        eq(invoices.organizationId, user.orgId),
        eq(invoices.familyId, family.id),
        ne(invoices.status, 'draft'),
      ),
      columns: {
        id: true, number: true, status: true, total: true,
        issuedOn: true, dueDate: true, mode: true,
      },
      orderBy: (i, { desc }) => [desc(i.createdAt)],
    });
    return rows.map(r => ({ ...r, family: null }));
  }

  // ─── Lesson notes & media (teacher → family) ────────────────────────────────
  // Family-visible notes the student's teacher has written, newest first, each
  // with any media the teacher attached. Internal ('internal') notes are never
  // returned here.
  @Get('notes')
  @Roles('student')
  async getNotes(@CurrentUser() user: RequestUser) {
    const family = await this.requireFamily(user.userId, user.orgId);
    const studentIds = family.students.map(s => s.id);
    if (studentIds.length === 0) return [];

    const rows = await this.db.db.query.notes.findMany({
      where: and(
        eq(notes.organizationId, user.orgId),
        eq(notes.visibility, 'family'),
        inArray(notes.studentId, studentIds),
      ),
      with: {
        student: { columns: { id: true, firstName: true, lastName: true } },
        author: { columns: { id: true, email: true } },
      },
      orderBy: (n, { desc }) => [desc(n.createdAt)],
      limit: 100,
    });

    return rows.map(n => ({
      id: n.id,
      body: n.body,
      lessonId: n.lessonId,
      createdAt: n.createdAt,
      student: n.student,
      attachments: ((n.attachments as NoteAttachment[] | null) ?? []).map(a => ({
        fileId: a.fileId, name: a.name, mime: a.mime, size: a.size,
      })),
    }));
  }

  // Sign a short-lived download URL for a single attachment. Access is gated on
  // the note: it must be family-visible AND belong to one of the caller's own
  // students, and the fileId must actually be listed on that note. Only then do
  // we sign — never trusting the fileId alone (that would be an IDOR).
  @Get('notes/:noteId/attachments/:fileId/sign-download')
  @Roles('student')
  async signNoteAttachment(
    @CurrentUser() user: RequestUser,
    @Param('noteId') noteId: string,
    @Param('fileId') fileId: string,
  ) {
    const family = await this.requireFamily(user.userId, user.orgId);
    const studentIds = family.students.map(s => s.id);

    const note = await this.db.db.query.notes.findFirst({
      where: and(eq(notes.id, noteId), eq(notes.organizationId, user.orgId)),
    });
    // 404 (not 403) so a guardian can't probe which notes/files exist in the org.
    if (!note || note.visibility !== 'family' || !studentIds.includes(note.studentId)) {
      throw new NotFoundException('Note not found');
    }
    const attached = ((note.attachments as NoteAttachment[] | null) ?? []).some(a => a.fileId === fileId);
    if (!attached) throw new NotFoundException('Attachment not found');

    return this.files.signDownloadForOrg(fileId, user.orgId);
  }

  // ─── Available booking slots ───────────────────────────────────────────────
  // Returns open time slots for a teacher in a given week, filtered by duration.
  @Get('availability')
  @Roles('student')
  async getAvailability(
    @CurrentUser() user: RequestUser,
    @Query('teacherId') teacherId: string,
    @Query('weekStart') weekStart: string, // ISO date string, e.g. "2026-06-09"
    @Query('duration') durationStr = '60',
  ) {
    const duration = parseInt(durationStr, 10);
    if (!teacherId || !weekStart) throw new BadRequestException('teacherId and weekStart are required');

    // Delegate to the shared scheduling engine so parent booking uses the exact
    // same slot logic as the staff calendar: 15-minute increments, interpreted in
    // the STUDIO timezone (not the server's), and filtered against the teacher's
    // lessons + blocked time. futureOnly drops slots already in the past.
    return this.scheduling.getAvailableSlotsWeek(user.orgId, teacherId, weekStart, duration, { futureOnly: true });
  }

  // ─── Book a lesson ────────────────────────────────────────────────────────
  @Post('lessons')
  @Roles('student')
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

    const slotStart = new Date(dto.startsAt);
    if (isNaN(slotStart.getTime())) throw new BadRequestException('Invalid start time');
    // A parent/student must not be able to self-book a lesson in the past.
    if (slotStart.getTime() <= Date.now()) {
      throw new BadRequestException('Lessons must be booked for a future time.');
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

    // Delegate the actual write to the scheduling service so self-service booking
    // runs under the SAME advisory lock + conflict checks as staff booking — this
    // prevents double-booking a teacher (including concurrent races) and
    // reuses the hardened overlap window. The instant is passed as a Z-suffixed
    // ISO string, which round-trips through the service's zoned parse unchanged.
    const lesson = await this.scheduling.createLesson(user.orgId, {
      studentId: dto.studentId,
      teacherId: dto.teacherId,
      enrollmentId: dto.enrollmentId,
      termId: enrollment.termId ?? undefined,
      startsAt: slotStart.toISOString(),
      duration: dto.duration,
      isTrialLesson: dto.isTrialLesson ?? false,
    });

    // Send confirmation emails (non-blocking)
    this.sendBookingConfirmations(user.orgId, lesson, teacher, student!, enrollment.instrument, !!dto.isTrialLesson)
      .catch(err => console.warn('Booking email failed:', err));

    return lesson;
  }

  // ─── Cancel a lesson (family portal) ─────────────────────────────────────
  // Choice: absent_makeup (≥24h, get a credit) or absent_no_pay (≥24h, no credit no charge).
  // <24h: auto absent_no_makeup (teacher paid, no credit).
  @Post('lessons/:id/cancel')
  @Roles('student')
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
  @Roles('student')
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
  @Roles('student')
  async teacherAvailability(@CurrentUser() user: RequestUser) {
    const familyId = await this.resolveFamilyId(user.userId, user.orgId);
    if (!familyId) return [];
    const family = await this.db.db.query.families.findFirst({
      where: eq(families.id, familyId),
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
