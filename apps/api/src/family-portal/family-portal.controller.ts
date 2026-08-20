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
import { eq, and, gt, gte, lte, ne, inArray } from 'drizzle-orm';
import {
  lessons, lessonCredits, notes, families, memberships, guardians, organizations,
  students, enrollments, staffMembers,
  teacherAssignments, attendance, paymentClaims, terms,
} from '@music-life/db';
import { AttendanceService } from '../attendance/attendance.service';
import { BillingService } from '../billing/billing.service';
import { ReconciliationService } from '../billing/reconciliation.service';
import { SchedulingService } from '../scheduling/scheduling.service';
import { FilesService } from '../files/files.service';
import { invoices } from '@music-life/db';
import { getOrgTimezone, formatInZone } from '../common/timezone';
import { brandedEmail, detailsBlock } from '../email/branding';
import type { RequestUser } from '@music-life/types';

// Shape of the entries stored in notes.attachments (see NotesController).
interface NoteAttachment { fileId: string; name: string; mime: string; size?: number }

const DAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

// Monday of the current studio-local week, as a "YYYY-MM-DD" string — the same
// shape `getAvailableSlotsWeek` expects as `weekStart`. Mirrors the frontend's
// `weekMonday()` (family/book/page.tsx), but anchored to studio "today" rather
// than the caller's browser date.
export function currentStudioWeekMonday(timeZone: string): string {
  const todayStr = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  const [y, mo, d] = todayStr.split('-').map(Number);
  // Noon-UTC anchor keeps the calendar date DST-proof while we step by days.
  const anchor = new Date(Date.UTC(y!, mo! - 1, d!, 12));
  const daysSinceMonday = (anchor.getUTCDay() + 6) % 7;
  anchor.setUTCDate(anchor.getUTCDate() - daysSinceMonday);
  return `${anchor.getUTCFullYear()}-${String(anchor.getUTCMonth() + 1).padStart(2, '0')}-${String(anchor.getUTCDate()).padStart(2, '0')}`;
}

// Turns a flat list of bookable lesson-start slots into compact per-weekday
// windows for the availability grid, merging consecutive starts (15-minute
// apart, `getAvailableSlots`'s step) into one shaded block instead of a choppy
// dot per slot — e.g. starts at 14:00, 14:15, 14:30 with a 60-min duration
// become one window 14:00–15:30, matching what a family can actually book.
export function mergeSlotsIntoWindows(
  slots: { startsAt: string }[], duration: number, timeZone: string,
): { weekday: string; startTime: string; endTime: string }[] {
  const STEP_MIN = 15;
  const points = slots.map(s => {
    const instant = new Date(s.startsAt);
    const weekday = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'long' }).format(instant).toLowerCase();
    const hm = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false }).format(instant);
    const [h, m] = hm.split(':').map(Number);
    return { weekday, minutes: h! * 60 + m! };
  }).sort((a, b) => DAY_KEYS.indexOf(a.weekday) - DAY_KEYS.indexOf(b.weekday) || a.minutes - b.minutes);

  const out: { weekday: string; startTime: string; endTime: string }[] = [];
  const fmt = (mins: number) => `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
  let run: { weekday: string; start: number; last: number } | null = null;
  for (const p of points) {
    if (run && run.weekday === p.weekday && p.minutes - run.last <= STEP_MIN) {
      run.last = p.minutes;
    } else {
      if (run) out.push({ weekday: run.weekday, startTime: fmt(run.start), endTime: fmt(run.last + duration) });
      run = { weekday: p.weekday, start: p.minutes, last: p.minutes };
    }
  }
  if (run) out.push({ weekday: run.weekday, startTime: fmt(run.start), endTime: fmt(run.last + duration) });
  return out;
}
import { IsBoolean, IsDateString, IsInt, IsOptional, IsUUID, Min, Max, IsIn } from 'class-validator';
import { Type } from 'class-transformer';

class BookLessonDto {
  @IsUUID() teacherId!: string;
  @IsUUID() studentId!: string;
  @IsUUID() enrollmentId!: string;
  // 1st choice + up to two ranked fallbacks — a teacher or admin confirms one
  // of these (Requests page) before anything is actually booked.
  @IsDateString() startsAt!: string;
  @IsOptional() @IsDateString() startsAt2?: string;
  @IsOptional() @IsDateString() startsAt3?: string;
  @IsInt() @Min(15) @Max(240) duration!: number;
  // Accepted for backward compatibility but IGNORED: trial pricing is decided
  // server-side from the enrolment's status at confirmation time (see
  // decideLessonRequest), never the client.
  @IsOptional() @IsBoolean() @Type(() => Boolean) isTrialLesson?: boolean;
  // Set up a weekly recurring series from this slot (autobooks going forward)
  // rather than a one-off lesson.
  @IsOptional() @IsBoolean() @Type(() => Boolean) recurring?: boolean;
  // Optional last date (studio-local YYYY-MM-DD) for a recurring series — no
  // occurrences are generated after it. Omitted = open-ended (rolling window).
  @IsOptional() @IsDateString() recurringEndDate?: string;
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

  // ─── Who the caller may see/act on ──────────────────────────────────────────
  /**
   * The student ids the CALLER is allowed to see or act on. A GUARDIAN gets
   * every child in the family; a STUDENT gets only their own record.
   *
   * The dashboard already draws this line ("a student sees only their own row"),
   * but the lesson history, the family-visible notes, the note-attachment
   * download, and the book/cancel actions all keyed off the WHOLE family — so a
   * child logging in could read a sibling's lesson history and the teacher's
   * notes about them (and download the media attached to those notes), and even
   * book or cancel a sibling's lessons. Scoping every one of those through here
   * keeps a student inside their own record while leaving guardians unchanged.
   */
  private async callerStudentIds(
    user: RequestUser,
    family: { students: { id: string }[] },
  ): Promise<string[]> {
    if (user.role !== 'student') return family.students.map(s => s.id);
    const self = await this.db.db.query.students.findFirst({
      where: and(eq(students.studentUserId, user.userId), eq(students.organizationId, user.orgId)),
      columns: { id: true },
    });
    return self ? [self.id] : [];
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
    const studentIds = await this.callerStudentIds(user, family);
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
  // Serves both portals. A GUARDIAN gets the whole family: every child, the
  // account balance and any invoice due. A STUDENT gets only themselves and no
  // money at all — a child logging in was being shown the family balance and an
  // "I've sent the transfer" button for their parents' invoice. What a student
  // needs is today's lesson and what their teacher last wrote, nothing else.
  @Get('dashboard')
  @Roles('student')
  async dashboard(@CurrentUser() user: RequestUser) {
    const viewerIsStudent = user.role === 'student';
    const empty = {
      nextLesson: null, balance: 0, outstandingInvoice: null, students: [], lastNote: null,
      viewer: viewerIsStudent ? 'student' : 'guardian',
    };
    const familyId = await this.resolveFamilyId(user.userId, user.orgId);
    if (!familyId) return empty;

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
    if (!family) return empty;

    // A student sees only their own row; a guardian sees every child.
    const self = viewerIsStudent
      ? await this.db.db.query.students.findFirst({
          where: and(eq(students.studentUserId, user.userId), eq(students.organizationId, user.orgId)),
          columns: { id: true },
        })
      : null;
    const visibleStudents = viewerIsStudent
      ? family.students.filter(s => s.id === self?.id)
      : family.students;

    const studentIds = visibleStudents.map(s => s.id);
    const now = new Date();

    // Per-student lesson credit balances
    const studentsWithCredits = await Promise.all(
      visibleStudents.map(async s => {
        const { total, prepaid, makeup, used } = await this.attendance.getLessonCreditBalance(user.orgId, s.id);
        return { ...s, lessons: { total, prepaid, makeup, used } };
      }),
    );

    // Next lesson across all students
    let nextLesson = null;
    if (studentIds.length > 0) {
      // Filtered by student in SQL. It used to pull the next 10 scheduled
      // lessons in the WHOLE STUDIO and then look for one of this family's in
      // that page — so any family whose next lesson wasn't among the studio's
      // ten soonest was told "No upcoming lessons" while it sat in the diary.
      const familyLesson = await this.db.db.query.lessons.findFirst({
        where: and(
          eq(lessons.organizationId, user.orgId),
          eq(lessons.status, 'scheduled'),
          gte(lessons.startsAt, now),
          inArray(lessons.studentId, studentIds),
        ),
        with: {
          student: { columns: { id: true, firstName: true, lastName: true } },
          teacher: { columns: { id: true, firstName: true, lastName: true } },
          enrollment: { columns: { instrument: true, lessonType: true } },
        },
        orderBy: (l, { asc }) => [asc(l.startsAt)],
      });
      if (familyLesson) {
        nextLesson = {
          id: familyLesson.id,
          startsAt: familyLesson.startsAt,
          duration: familyLesson.duration,
          isTrialLesson: familyLesson.isTrialLesson,
          teacher: familyLesson.teacher,
          student: familyLesson.student,
          instrument: familyLesson.enrollment?.instrument ?? null,
          meetingLink: familyLesson.meetingLink ?? null,
        };
      }
    }

    // Outstanding invoice. This used to be hidden from every student login on
    // the assumption a "student" account is always a minor whose parent pays —
    // but a student account is also how an adult pupil with no guardian on
    // file manages their own account, and they need to see and pay their own
    // bill same as a guardian would. So: same query for both viewer types.
    //
    // `total > 0` because an issued invoice can be zero or negative: a credit
    // note, or one raised before any line items were added. INV-0008 (−£4.00)
    // was being shown to the family as "Invoice due" with an "I've sent the
    // transfer" button that dead-ended on "This invoice has nothing to pay."
    // There is nothing for a family to do about a credit, so it isn't a bill.
    const outstandingInvoice = await this.db.db.query.invoices.findFirst({
      where: and(
        eq(invoices.familyId, family.id),
        eq(invoices.organizationId, user.orgId),
        eq(invoices.status, 'sent'),
        gt(invoices.total, 0),
      ),
      orderBy: (i, { asc }) => [asc(i.dueDate)],
    });

    // Most recent family-visible note. Same bug as nextLesson: it took the most
    // recent family-visible note in the ORG and returned it only if it happened
    // to belong to this family — so a family's own note was hidden whenever any
    // other family had a newer one, which on a busy week is always.
    let lastNote = null;
    if (studentIds.length > 0) {
      lastNote = await this.db.db.query.notes.findFirst({
        where: and(
          eq(notes.organizationId, user.orgId),
          eq(notes.visibility, 'family'),
          inArray(notes.studentId, studentIds),
        ),
        with: { student: { columns: { id: true, firstName: true, lastName: true } } },
        orderBy: (n, { desc }) => [desc(n.createdAt)],
      }) ?? null;
    }

    return {
      nextLesson,
      viewer: viewerIsStudent ? 'student' : 'guardian',
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
   *
   * @Roles('student'): a logged-in student may pay their own family's invoice
   * too, not just a guardian — some students are adults with no guardian
   * account at all. requireFamily()/family.id below already scope this to the
   * caller's own family exactly as it does for a guardian.
   */
  @Post('invoices/:id/mark-paid')
  @Roles('student')
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
  @Roles('student')
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

    // Where to actually send the money. The portal told families to "send £X by
    // bank transfer, quoting this reference" and never said which account — the
    // details existed (Settings → Invoice defaults) and reached the invoice PDF
    // and the public pay page, but not the in-app flow. A reference with no
    // account is half an instruction.
    //
    // These are the studio's own RECEIVING details, which exist to be given to
    // payers, so a family reading them is the point.
    const org = await this.db.db.query.organizations.findFirst({
      where: eq(organizations.id, user.orgId),
      columns: { settings: true },
    });
    const cfg = (org?.settings ?? {}) as Record<string, unknown>;
    const bank = {
      accountName: (cfg.bankAccountName as string) || null,
      sortCode: (cfg.bankSortCode as string) || null,
      accountNumber: (cfg.bankAccountNumber as string) || null,
    };

    return {
      reference,
      pendingClaims: pending,
      bank,
      // Lets the portal say "ask the studio for the account details" instead of
      // showing an instruction the family cannot act on.
      bankConfigured: !!(bank.sortCode && bank.accountNumber),
    };
  }

  // ─── Resource-library subscription ──────────────────────────────────────────
  // A logged-in student may see the terms and buy access too, same as a
  // guardian — an adult student may have no guardian account to do it for
  // them. requireFamily() scopes this to the caller's own family either way.
  @Get('resource-subscription')
  @Roles('student')
  async getResourceSubscription(@CurrentUser() user: RequestUser) {
    const family = await this.requireFamily(user.userId, user.orgId);
    const terms = await this.billing.getResourceSubscriptionTerms(user.orgId);
    const today = new Date().toISOString().split('T')[0]!;
    const paidUntil = family.resourceAccessPaidUntil;
    return {
      active: !!paidUntil && paidUntil >= today,
      paidUntil: paidUntil ?? null,
      price: terms.price,
      months: terms.months,
    };
  }

  @Post('resource-subscription/subscribe')
  @Roles('student')
  async subscribeResources(@CurrentUser() user: RequestUser) {
    const family = await this.requireFamily(user.userId, user.orgId);
    const result = await this.billing.chargeResourceSubscription(user.orgId, family.id);
    return { ok: true, ...result };
  }

  // ─── This family's invoices (read-only) ─────────────────────────────────────
  // Families (guardian or a logged-in student) RECEIVE invoices — they never
  // create them — so this list is view-only and scoped to the caller's own
  // family (staff use the admin /invoices route).
  @Get('invoices')
  @Roles('student')
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
    const studentIds = await this.callerStudentIds(user, family);
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
    const studentIds = await this.callerStudentIds(user, family);

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
  // The currently-active term, for the "repeat weekly until end of term"
  // option on self-booking — mirrors what the admin calendar's own "Termly"
  // repeat option reads, just exposed at student/guardian role instead of
  // teacher+.
  @Get('active-term')
  @Roles('student')
  async getActiveTerm(@CurrentUser() user: RequestUser) {
    const term = await this.db.db.query.terms.findFirst({
      where: and(eq(terms.organizationId, user.orgId), eq(terms.status, 'active')),
      columns: { id: true, name: true, endsOn: true },
    });
    return term ?? null;
  }

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

    // Only expose a teacher's week to a family that actually has them: the slots
    // returned reveal, by omission, when that teacher is already booked or blocked,
    // so an unscoped teacherId let any signed-in guardian/student read any in-org
    // teacher's free/busy schedule. This mirrors the family-scoping already applied
    // to `teachers` and `teacher-availability` (and the enrolment/teacher guard in
    // bookLesson) so the three booking surfaces can never disagree about who "your
    // teacher" is.
    const family = await this.requireFamily(user.userId, user.orgId);
    // Scope to the CALLER's students, not the whole family: a guardian covers
    // every child, but a logged-in student only their own teachers — so a student
    // can't read a sibling's teacher's free/busy schedule (same student/guardian
    // split as #178, applied to the last booking surfaces #178 didn't cover).
    const teacherIds = await this.familyTeacherIds(user.orgId, await this.callerStudentIds(user, family));
    if (!teacherIds.includes(teacherId)) {
      throw new NotFoundException('Teacher not found');
    }

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

    // Verify the student is one the caller may book for: a guardian may book for
    // any child in the family; a logged-in student only for themselves — not a
    // sibling (whose lesson would be charged to the family and land on a teacher's
    // timetable without the parent ever asking).
    const bookableStudentIds = await this.callerStudentIds(user, family);
    if (!bookableStudentIds.includes(dto.studentId)) {
      throw new BadRequestException('Student does not belong to your family');
    }

    // Verify enrollment belongs to this student
    const enrollment = await this.db.db.query.enrollments.findFirst({
      where: and(eq(enrollments.id, dto.enrollmentId), eq(enrollments.studentId, dto.studentId)),
    });
    if (!enrollment) throw new NotFoundException('Enrollment not found');

    // The teacher and the enrollment were picked independently in the portal and
    // never checked against each other. A parent could select their child's
    // piano enrollment and book it with the cello teacher: the lesson landed on
    // the wrong teacher's timetable, payroll paid that teacher, and the family
    // was billed the piano enrollment's rate. The enrollment decides who teaches
    // it; only an enrollment with no teacher assigned is open to a choice.
    if (enrollment.teacherId && enrollment.teacherId !== dto.teacherId) {
      throw new BadRequestException(
        'That teacher does not teach this instrument for this student. Please choose the instrument first — the teacher is set by the enrolment.',
      );
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

    // Nothing is booked yet — this only records the request. A teacher or
    // admin must confirm one of the ranked times (Requests page) before
    // anything creates a real lesson or appears on any calendar; trial
    // pricing and the enrolment's term are decided fresh from the enrolment's
    // own state at THAT point, not carried on the request (see
    // decideLessonRequest) — the same "never trust the client" reasoning
    // that used to guard the isTrialLesson flag here.
    const { request } = await this.scheduling.createFamilyBooking(
      user.orgId,
      {
        studentId: dto.studentId,
        teacherId: dto.teacherId,
        enrollmentId: dto.enrollmentId,
        startsAt: dto.startsAt,
        startsAt2: dto.startsAt2,
        startsAt3: dto.startsAt3,
        duration: dto.duration,
        recurring: dto.recurring ?? false,
        recurringEndDate: dto.recurringEndDate,
      },
      user.userId,
    );

    // Let the teacher know a request is waiting on them — front-desk-created
    // requests rely on the Requests page/badge alone, but a family has no
    // reason to know to check there, so this is the one place that does need
    // its own notification.
    this.notifyRequestPending(user.orgId, request, teacher, student!, enrollment.instrument)
      .catch(err => console.warn('Booking request notify failed:', err));

    return request;
  }

  // ─── Cancel a lesson (family portal) ─────────────────────────────────────
  // Choice: absent_makeup (≥24h, no charge, wants to rebook the slot) or absent_no_pay (≥24h, no charge, no rebook).
  // <24h: auto absent_no_makeup (teacher paid, no credit).
  @Post('lessons/:id/cancel')
  @Roles('student')
  async cancelLesson(
    @CurrentUser() user: RequestUser,
    @Param('id') lessonId: string,
    @Body() dto: CancelLessonDto,
  ) {
    const family = await this.requireFamily(user.userId, user.orgId);
    const studentIds = await this.callerStudentIds(user, family);

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

  // The staff ids a family's students are actually linked to, via enrollment or
  // explicit assignment. Shared by the booking picker and the availability
  // visual so the two can never disagree about who "your teacher" is.
  private async familyTeacherIds(orgId: string, studentIds: string[]): Promise<string[]> {
    if (studentIds.length === 0) return [];
    const [enr, assigns] = await Promise.all([
      this.db.db.query.enrollments.findMany({
        where: and(eq(enrollments.organizationId, orgId), inArray(enrollments.studentId, studentIds)),
        columns: { teacherId: true },
      }),
      this.db.db.query.teacherAssignments.findMany({
        where: and(eq(teacherAssignments.organizationId, orgId), inArray(teacherAssignments.studentId, studentIds)),
        columns: { staffId: true },
      }),
    ]);
    return [...new Set([
      ...enr.map(e => e.teacherId).filter((id): id is string => !!id),
      ...assigns.map(a => a.staffId),
    ])];
  }

  // ─── List teachers with availability (for booking picker) ─────────────────
  // Scoped to THIS family's teachers. It used to return the entire active
  // roster, so a parent's booking picker offered every teacher in the studio —
  // which is why the dropdown showed staff with open slots who had nothing to
  // do with the family, while their own teacher looked unavailable. Booking
  // against one of those strangers also produced a lesson whose teacher didn't
  // match the enrollment being billed (see the guard in bookLesson below).
  @Get('teachers')
  @Roles('student')
  async getTeachers(@CurrentUser() user: RequestUser) {
    const familyId = await this.resolveFamilyId(user.userId, user.orgId);
    if (!familyId) return [];
    const family = await this.db.db.query.families.findFirst({
      where: eq(families.id, familyId),
      with: { students: { columns: { id: true } } },
    });
    // A guardian sees every child's teachers; a logged-in student only their own,
    // never a sibling's (matches the booking-surface scoping and #178).
    const studentIds = family ? await this.callerStudentIds(user, family) : [];
    const teacherIds = await this.familyTeacherIds(user.orgId, studentIds);
    if (teacherIds.length === 0) return [];

    return this.db.db.query.staffMembers.findMany({
      where: and(
        eq(staffMembers.organizationId, user.orgId),
        eq(staffMembers.status, 'active'),
        inArray(staffMembers.id, teacherIds),
      ),
      // Contact info here is scoped to only THIS family's assigned teacher(s) —
      // never the whole roster — via the teacherIds filter above.
      columns: { id: true, firstName: true, lastName: true, phone: true, instruments: true, defaultDuration: true },
      with: { user: { columns: { email: true } } },
    });
  }

  // ─── This family's own teachers' weekly availability windows ───────────────
  // Powers the "when your teacher is free" visual on the family dashboard. Only
  // returns windows for teachers the family's students are actually linked to
  // (via enrollment or assignment), so families don't see the whole roster.
  //
  // This used to read the teacher's raw weekly windows straight from the
  // `availability` table — their DECLARED recurring hours, with no lessons or
  // blocked time subtracted. The Book page (`/family/availability`) filters
  // against actual bookings via the shared scheduling engine, so the two
  // disagreed on screen: this widget shaded an hour as free that Book then
  // showed as taken. Now it queries the same `getAvailableSlotsWeek` engine,
  // for the current studio week, so both surfaces always agree.
  @Get('teacher-availability')
  @Roles('student')
  async teacherAvailability(@CurrentUser() user: RequestUser) {
    const familyId = await this.resolveFamilyId(user.userId, user.orgId);
    if (!familyId) return [];
    const family = await this.db.db.query.families.findFirst({
      where: eq(families.id, familyId),
      with: { students: { columns: { id: true } } },
    });
    // Student caller → own teachers only; guardian → the whole family's (#178).
    const studentIds = family ? await this.callerStudentIds(user, family) : [];
    const teacherIds = await this.familyTeacherIds(user.orgId, studentIds);
    if (teacherIds.length === 0) return [];

    const teachers = await this.db.db.query.staffMembers.findMany({
      where: and(eq(staffMembers.organizationId, user.orgId), inArray(staffMembers.id, teacherIds)),
      columns: { id: true, firstName: true, lastName: true },
    });
    const nameById = Object.fromEntries(teachers.map(t => [t.id, `${t.firstName} ${t.lastName}`]));

    const tz = await getOrgTimezone(this.db.db, user.orgId);
    const weekStart = currentStudioWeekMonday(tz);

    const out: { id: string; staffId: string; weekday: string; startTime: string; endTime: string; teacherName: string }[] = [];
    await Promise.all(teacherIds.map(async id => {
      const slots = await this.scheduling.getAvailableSlotsWeek(user.orgId, id, weekStart, 60, { futureOnly: true });
      for (const w of mergeSlotsIntoWindows(slots, 60, tz)) {
        out.push({ id: `${id}-${w.weekday}-${w.startTime}`, staffId: id, ...w, teacherName: nameById[id] ?? 'Teacher' });
      }
    }));
    return out.sort((a, b) => a.weekday === b.weekday ? a.startTime.localeCompare(b.startTime) : a.weekday.localeCompare(b.weekday));
  }

  // ─── Booking request email ────────────────────────────────────────────────
  // Nothing is booked yet at this point — a teacher or admin still has to
  // confirm one of the ranked times before anything lands on a calendar
  // (createFamilyBooking). Front-desk-created requests rely on the Requests
  // page/badge alone to surface to a teacher; a family has no reason to know
  // to check there, so this is the one booking-request path that emails
  // proactively.
  private async notifyRequestPending(
    orgId: string,
    request: { proposedStartsAt: Date; proposedStartsAt2: Date | null; proposedStartsAt3: Date | null; duration: number },
    teacher: { firstName: string; lastName: string; user?: { email: string } | null },
    student: { firstName: string; lastName: string; family?: { email: string | null; name: string } | null },
    instrument: string,
  ) {
    const tz = await getOrgTimezone(this.db.db, orgId);
    const fmt = (d: Date) => formatInZone(d, tz, { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
    const teacherName = `${teacher.firstName} ${teacher.lastName}`;
    const studentName = `${student.firstName} ${student.lastName}`;

    // The student name (and instrument) are family/guardian-supplied and this
    // body is sent as raw HTML to the teacher AND every org admin, so escape
    // them to prevent stored HTML injection into a staff inbox. fmt(...) output
    // has no user content in it.
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    const choices = [request.proposedStartsAt, request.proposedStartsAt2, request.proposedStartsAt3]
      .filter((d): d is Date => !!d)
      .map((d, i) => ({ label: i === 0 ? '1st choice' : i === 1 ? '2nd choice' : '3rd choice', value: fmt(d) }));

    const bodyHtml = `<p style="margin:0 0 4px">Hi there,</p>` +
      `<p style="margin:0 0 14px">A family has requested a lesson — nothing is booked yet, please review and confirm a time.</p>` +
      detailsBlock([
        { label: 'Student', value: esc(studentName) },
        { label: 'Teacher', value: esc(teacherName) },
        { label: 'Instrument', value: `<span style="text-transform:capitalize">${esc(instrument)}</span>` },
        { label: 'Duration', value: `${request.duration} min` },
        ...choices,
      ]);

    const html = brandedEmail({
      previewText: `${studentName} requested a lesson with ${teacherName}`,
      heading: 'New lesson request',
      bodyHtml,
      footnote: 'Review and confirm this request from the Requests page in the studio portal.',
    });

    const subject = `New lesson request: ${studentName} with ${teacherName}`;
    const recipients: string[] = [];
    if (teacher.user?.email) recipients.push(teacher.user.email);

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
