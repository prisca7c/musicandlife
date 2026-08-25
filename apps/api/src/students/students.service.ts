import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { eq, and, ne, gte, ilike, or, inArray, sql, type SQL } from 'drizzle-orm';
import { students, teacherAssignments, enrollments, families, staffMembers, lessons, users, memberships, passwordResetTokens, lessonCredits } from '@music-life/db';
import { randomBytes, createHash } from 'crypto';
import { DbService } from '../db/db.service';
import { EmailPort } from '../email/ports/email.port';
import { brandedEmail } from '../email/branding';
import type { CreateStudentDto } from './dto/create-student.dto';
import type { UpdateStudentDto } from './dto/update-student.dto';
import type { BaseRole } from '@music-life/types';
import type { PageParams, Paginated } from '../common/pagination';

@Injectable()
export class StudentsService {
  private readonly logger = new Logger(StudentsService.name);

  constructor(
    private readonly db: DbService,
    private readonly email: EmailPort,
  ) {}

  private async resolveStaffId(orgId: string, userId: string): Promise<string | null> {
    const staff = await this.db.db.query.staffMembers.findFirst({
      where: and(eq(staffMembers.userId, userId), eq(staffMembers.organizationId, orgId)),
      columns: { id: true },
    });
    return staff?.id ?? null;
  }

  // "Assigned" is the union of the explicit teacherAssignments table (admin-managed,
  // primary/secondary) and enrollments.teacherId — in practice every student-teacher
  // link today comes from an enrollment, since nothing in the app currently writes to
  // teacherAssignments outside the dedicated staff assign/unassign endpoints.
  //
  // This is the canonical definition of "this teacher's students" — other call sites
  // (e.g. the dashboard KPI tile) must reuse it rather than re-deriving their own
  // scoped student-id list, or the two will silently drift apart.
  async getAssignedStudentIds(orgId: string, staffId: string): Promise<string[]> {
    const [assignments, enrolled] = await Promise.all([
      this.db.db.query.teacherAssignments.findMany({
        where: and(eq(teacherAssignments.organizationId, orgId), eq(teacherAssignments.staffId, staffId)),
        columns: { studentId: true },
      }),
      this.db.db.query.enrollments.findMany({
        where: and(eq(enrollments.organizationId, orgId), eq(enrollments.teacherId, staffId)),
        columns: { studentId: true },
      }),
    ]);
    return [...new Set([...assignments.map((a) => a.studentId), ...enrolled.map((e) => e.studentId)])];
  }

  async findAll(
    orgId: string,
    userId: string,
    role: BaseRole,
    opts: { search?: string; status?: string; page?: PageParams | null } = {},
  ) {
    const { search, status, page = null } = opts;
    // firstName/lastName ORed separately never matches a "First Last" query
    // (e.g. "John Sm" against 10+ students all first-named "John" plus one
    // "John Smith") — neither column alone contains the two-word substring.
    // Also match the concatenated full name so a space-separated query works.
    const searchClause: SQL | undefined = search
      ? or(
          ilike(students.firstName, `%${search}%`),
          ilike(students.lastName, `%${search}%`),
          ilike(sql`${students.firstName} || ' ' || ${students.lastName}`, `%${search}%`),
        )
      : undefined;
    const statusClause: SQL | undefined = status
      ? eq(students.status, status as 'waiting' | 'trial' | 'active' | 'paused' | 'withdrawn')
      : undefined;

    // Build the WHERE once so the count and the page share identical filtering.
    let whereClause: SQL | undefined;
    if (role === 'teacher') {
      const staffId = await this.resolveStaffId(orgId, userId);
      const ids = staffId ? await this.getAssignedStudentIds(orgId, staffId) : [];
      if (ids.length === 0) {
        return page ? { data: [], total: 0, limit: page.limit, offset: page.offset } : [];
      }
      whereClause = and(eq(students.organizationId, orgId), inArray(students.id, ids), searchClause, statusClause);
    } else {
      whereClause = and(eq(students.organizationId, orgId), searchClause, statusClause);
    }

    // Instruments + teachers shown in the list come from the student's
    // non-withdrawn enrollments (deduped client-side). `status` lets us drop
    // withdrawn ones.
    const withRelations = {
      family: { columns: { id: true, name: true, contactName: true, email: true, phone: true, address: true } },
      enrollments: {
        columns: { instrument: true, status: true },
        with: { teacher: { columns: { id: true, firstName: true, lastName: true } } },
      },
    } as const;

    // Back-compat: no pagination params → return the full array as before.
    if (!page) {
      const all = await this.db.db.query.students.findMany({
        where: whereClause,
        with: withRelations,
        orderBy: (s, { asc }) => [asc(s.firstName), asc(s.lastName)],
      });
      return this.withNextLessonAndCredits(all);
    }

    const [rows, countRows] = await Promise.all([
      this.db.db.query.students.findMany({
        where: whereClause,
        with: withRelations,
        orderBy: (s, { asc }) => [asc(s.firstName), asc(s.lastName)],
        limit: page.limit,
        offset: page.offset,
      }),
      this.db.db.select({ c: sql<number>`count(*)::int` }).from(students).where(whereClause),
    ]);
    const data = await this.withNextLessonAndCredits(rows);
    const result: Paginated<(typeof data)[number]> = {
      data,
      total: countRows[0]?.c ?? 0,
      limit: page.limit,
      offset: page.offset,
    };
    return result;
  }

  // Batches the two extra list-page columns (next lesson, available credit
  // count) across every student on the current page in two queries total,
  // rather than one round-trip per row.
  private async withNextLessonAndCredits<T extends { id: string }>(rows: T[]) {
    if (rows.length === 0) {
      return rows as (T & { nextLessonAt: string | null; creditsAvailable: number; creditsUsed: number })[];
    }
    const ids = rows.map((r) => r.id);
    const now = new Date();

    const [nextLessons, credits] = await Promise.all([
      this.db.db
        .select({ studentId: lessons.studentId, startsAt: sql<string>`min(${lessons.startsAt})` })
        .from(lessons)
        .where(and(inArray(lessons.studentId, ids), eq(lessons.status, 'scheduled'), gte(lessons.startsAt, now)))
        .groupBy(lessons.studentId),
      // One grouped query for both available and used counts, rather than two
      // round-trips — a student's credit history is never large enough to make
      // the extra GROUP BY dimension worth splitting.
      this.db.db
        .select({ studentId: lessonCredits.studentId, status: lessonCredits.status, n: sql<number>`count(*)::int` })
        .from(lessonCredits)
        .where(inArray(lessonCredits.studentId, ids))
        .groupBy(lessonCredits.studentId, lessonCredits.status),
    ]);
    const nextById = new Map(nextLessons.map((l) => [l.studentId, l.startsAt]));
    const availableById = new Map<string, number>();
    const usedById = new Map<string, number>();
    for (const c of credits) {
      if (c.status === 'available') availableById.set(c.studentId, c.n);
      else if (c.status === 'used') usedById.set(c.studentId, c.n);
    }

    return rows.map((r) => ({
      ...r,
      nextLessonAt: nextById.get(r.id) ?? null,
      creditsAvailable: availableById.get(r.id) ?? 0,
      creditsUsed: usedById.get(r.id) ?? 0,
    }));
  }

  async findOne(orgId: string, id: string, teacherScope?: { userId: string }) {
    const student = await this.db.db.query.students.findFirst({
      where: and(eq(students.id, id), eq(students.organizationId, orgId)),
      with: {
        family: true,
        enrollments: {
          with: { teacher: { columns: { id: true, firstName: true, lastName: true } } },
        },
      },
    });
    if (!student) throw new NotFoundException('Student not found');

    if (teacherScope) {
      const staffId = await this.resolveStaffId(orgId, teacherScope.userId);
      const assignedIds = staffId ? await this.getAssignedStudentIds(orgId, staffId) : [];
      if (!assignedIds.includes(id)) throw new NotFoundException('Student not found');
    }

    return student;
  }

  async create(orgId: string, dto: CreateStudentDto) {
    // Verify family belongs to this org
    const family = await this.db.db.query.families.findFirst({
      where: and(eq(families.id, dto.familyId), eq(families.organizationId, orgId)),
    });
    if (!family) throw new NotFoundException('Family not found');

    // The "Add student" form's email field is labelled "creates portal login",
    // but this used to just write it into students.email as a contact address
    // and stop there — no user, no membership, no studentUserId. The student
    // could never actually log in, and (since messaging's recipient list reads
    // memberships) they were invisible to "New message" too. Mirror the
    // guardian invite flow: a fresh email gets a real login; an email that
    // already belongs to a user in this org is just linked, not re-invited.
    let studentUserId: string | undefined;
    if (dto.email) {
      const normalizedEmail = dto.email.toLowerCase();
      const existing = await this.db.db.query.users.findFirst({ where: eq(users.email, normalizedEmail) });
      if (existing) {
        studentUserId = existing.id;
        const existingMembership = await this.db.db.query.memberships.findFirst({
          where: and(eq(memberships.userId, existing.id), eq(memberships.organizationId, orgId)),
        });
        if (!existingMembership) {
          await this.db.db.insert(memberships).values({ userId: existing.id, organizationId: orgId, baseRole: 'student' });
        }
      } else {
        const [newUser] = await this.db.db.insert(users).values({
          email: normalizedEmail, passwordHash: 'INVITE_PENDING', emailVerifiedAt: new Date(),
        }).returning();
        studentUserId = newUser!.id;
        await this.db.db.insert(memberships).values({ userId: newUser!.id, organizationId: orgId, baseRole: 'student' });
        this.sendInviteEmail(newUser!.id, normalizedEmail, dto.firstName).catch((err) =>
          this.logger.warn(`Invite email failed for ${normalizedEmail}: ${err}`),
        );
      }
    }

    const [student] = await this.db.db
      .insert(students)
      .values({ ...dto, organizationId: orgId, studentUserId })
      .returning();
    return student!;
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
        previewText: "You've been added as a student. Set your password to get started.",
        heading: 'Welcome to Music & Life!',
        bodyHtml: `<p style="margin:0 0 12px">Hi ${safeName},</p><p style="margin:0">You&rsquo;ve been added as a student at Music &amp; Life. Set your password to access your portal.</p>`,
        cta: { label: 'Set your password', url: link },
        footnote: 'This link expires in 7 days.',
      }),
    });
    this.logger.log(`Invite sent to ${emailAddr}`);
  }

  async update(orgId: string, id: string, dto: UpdateStudentDto) {
    const existing = await this.findOne(orgId, id);

    // PATCH is receptionist-level (DELETE's full teardown is admin-only), and a
    // plain field-merge here let 'withdrawn' through status like any other
    // value — silently skipping the whole teardown transaction below (enrolment
    // end, schedule-rule clear, future-lesson cancellation, calendar-token
    // rotation). That reopened the exact bug #171/#179 closed, through a second,
    // unguarded door. Any transition into 'withdrawn' — regardless of which
    // endpoint it comes through — must run the same transaction.
    if (dto.status === 'withdrawn' && existing.status !== 'withdrawn') {
      return this.withdraw(orgId, id, dto);
    }

    const [updated] = await this.db.db
      .update(students)
      .set({ ...dto, updatedAt: new Date() })
      .where(and(eq(students.id, id), eq(students.organizationId, orgId)))
      .returning();
    return updated!;
  }

  async remove(orgId: string, id: string) {
    await this.findOne(orgId, id);
    return this.withdraw(orgId, id, {});
  }

  private async withdraw(orgId: string, id: string, dto: UpdateStudentDto) {
    // Withdrawing a student must also end their enrolments and clear their diary.
    // Flipping only students.status left every enrolment 'active' with its weekly
    // scheduleRule intact — and the nightly recurrence worker scans on
    // enrolment.status alone (materializeAllRecurring), never the student's — so
    // it kept generating lessons for a child who had left, which autoCompleteOverdue
    // then marked present and CHARGED the family. Already-scheduled future lessons
    // billed the same way. Stop the series and cancel every future scheduled lesson
    // at no charge (mirrors enrollments.stopRecurring). Past/completed lessons are
    // untouched — they happened and are billed as normal. All in one transaction so
    // a withdrawn student can never be left with a live schedule.
    return this.db.db.transaction(async (tx) => {
      const now = new Date();
      const [updated] = await tx
        .update(students)
        .set({ ...dto, status: 'withdrawn', updatedAt: now })
        .where(and(eq(students.id, id), eq(students.organizationId, orgId)))
        .returning();

      await tx
        .update(enrollments)
        .set({ status: 'withdrawn', scheduleRule: null, updatedAt: now })
        .where(and(
          eq(enrollments.organizationId, orgId),
          eq(enrollments.studentId, id),
          ne(enrollments.status, 'withdrawn'),
        ));

      const cancelled = await tx
        .update(lessons)
        .set({ status: 'cancelled_no_pay', cancelledAt: now, updatedAt: now })
        .where(and(
          eq(lessons.organizationId, orgId),
          eq(lessons.studentId, id),
          eq(lessons.status, 'scheduled'),
          gte(lessons.startsAt, now),
        ))
        .returning({ id: lessons.id });

      // families has no status of its own — the ICS calendar feed token
      // (families.calendarToken) is never invalidated on withdrawal, so a
      // family's old feed URL, if it had ever leaked (shared with a co-parent,
      // synced to another calendar app), kept serving lesson history/times
      // indefinitely with no way to revoke it short of the family noticing and
      // clicking "regenerate" themselves. When this was the family's LAST
      // remaining non-withdrawn student, rotate the token now — closing the
      // access this family's students no longer have any reason to keep open.
      // A family with siblings still enrolled is untouched: their feed should
      // keep working.
      const remaining = await tx.query.students.findFirst({
        where: and(
          eq(students.familyId, updated!.familyId),
          eq(students.organizationId, orgId),
          ne(students.status, 'withdrawn'),
        ),
        columns: { id: true },
      });
      if (!remaining) {
        await tx.update(families)
          .set({ calendarToken: null, updatedAt: now })
          .where(and(eq(families.id, updated!.familyId), eq(families.organizationId, orgId)));
      }

      return { ...updated!, cancelledLessons: cancelled.length };
    });
  }

  async getEnrollments(orgId: string, studentId: string, teacherScope?: { userId: string }) {
    await this.findOne(orgId, studentId, teacherScope);
    return this.db.db.query.enrollments.findMany({
      where: and(
        eq(enrollments.studentId, studentId),
        eq(enrollments.organizationId, orgId),
      ),
      with: {
        teacher: { columns: { id: true, firstName: true, lastName: true } },
        term: { columns: { id: true, name: true, status: true } },
      },
    });
  }
}
