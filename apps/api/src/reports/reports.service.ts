import { Injectable, NotFoundException } from '@nestjs/common';
import { eq, and, gte, lte, count, sum, inArray, sql } from 'drizzle-orm';
import {
  students, staffMembers, families, lessons, attendance,
  invoices, ledgerEntries, enrollments, terms, lessonCredits,
  payrollRuns, payrollItems, organizations,
} from '@music-life/db';
import { DbService } from '../db/db.service';
import { effectiveLessonAmount } from '../billing/billing.service';
import { periodEndInclusive } from '../payroll/payroll.service';
import { getOrgTimezone, formatInZone } from '../common/timezone';

@Injectable()
export class ReportsService {
  constructor(private readonly db: DbService) {}

  /** Pass scopeTeacherId for the teacher portal: limits every metric to that teacher's own students/lessons and hides studio-wide financials. */
  async getDashboardKpis(orgId: string, scopeTeacherId?: string) {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
    // Week: Mon–Sun
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    weekStart.setHours(0, 0, 0, 0);
    const weekEnd = new Date(weekStart.getTime() + 7 * 86400000);

    // For teacher scoping: resolve the set of students this teacher actually teaches via enrollments.
    let scopedStudentIds: string[] | null = null;
    if (scopeTeacherId) {
      const rows = await this.db.db.select({ studentId: enrollments.studentId })
        .from(enrollments)
        .where(and(eq(enrollments.organizationId, orgId), eq(enrollments.teacherId, scopeTeacherId)));
      scopedStudentIds = [...new Set(rows.map(r => r.studentId))];
    }

    const lessonScope = scopeTeacherId
      ? and(eq(lessons.organizationId, orgId), eq(lessons.teacherId, scopeTeacherId))
      : eq(lessons.organizationId, orgId);
    const enrollmentScope = scopeTeacherId
      ? and(eq(enrollments.organizationId, orgId), eq(enrollments.status, 'active'), eq(enrollments.teacherId, scopeTeacherId))
      : and(eq(enrollments.organizationId, orgId), eq(enrollments.status, 'active'));

    const [
      studentCounts,
      familyCount,
      staffCount,
      lessonStats,
      weeklyLessonStats,
      revenueStats,
      outstandingInvoices,
      termsList,
      enrollmentByInstrument,
    ] = await Promise.all([
      // Students by status (scoped to the teacher's own students if applicable)
      scopeTeacherId
        ? (scopedStudentIds!.length > 0
          ? this.db.db.select({ status: students.status, count: count() })
              .from(students)
              .where(and(eq(students.organizationId, orgId), inArray(students.id, scopedStudentIds!)))
              .groupBy(students.status)
          : Promise.resolve([]))
        : this.db.db.select({ status: students.status, count: count() })
            .from(students)
            .where(eq(students.organizationId, orgId))
            .groupBy(students.status),

      // Family count — studio-wide only, not meaningful/shown for a single teacher
      scopeTeacherId
        ? Promise.resolve([{ count: 0 }])
        : this.db.db.select({ count: count() })
            .from(families)
            .where(eq(families.organizationId, orgId)),

      // Active staff — studio-wide only, not shown for a single teacher
      scopeTeacherId
        ? Promise.resolve([{ count: 0 }])
        : this.db.db.select({ count: count() })
            .from(staffMembers)
            .where(and(eq(staffMembers.organizationId, orgId), eq(staffMembers.status, 'active'))),

      // Lessons this month
      this.db.db.select({ status: lessons.status, count: count() })
        .from(lessons)
        .where(and(lessonScope, gte(lessons.startsAt, monthStart), lte(lessons.startsAt, monthEnd)))
        .groupBy(lessons.status),

      // Lessons this week
      this.db.db.select({ status: lessons.status, count: count() })
        .from(lessons)
        .where(and(lessonScope, gte(lessons.startsAt, weekStart), lte(lessons.startsAt, weekEnd)))
        .groupBy(lessons.status),

      // Revenue this month — studio-wide financials, hidden for teachers
      scopeTeacherId
        ? Promise.resolve([{ total: 0 }])
        : this.db.db.select({ total: sum(ledgerEntries.amount) })
            .from(ledgerEntries)
            .where(and(
              eq(ledgerEntries.organizationId, orgId),
              eq(ledgerEntries.type, 'payment'),
              gte(ledgerEntries.occurredAt, monthStart),
              lte(ledgerEntries.occurredAt, monthEnd),
            )),

      // Outstanding invoices — studio-wide financials, hidden for teachers
      scopeTeacherId
        ? Promise.resolve([{ total: 0, count: 0 }])
        : this.db.db.select({ total: sum(invoices.total), count: count() })
            .from(invoices)
            .where(and(eq(invoices.organizationId, orgId), eq(invoices.status, 'sent'))),

      // Active terms
      this.db.db.query.terms.findMany({
        where: and(eq(terms.organizationId, orgId), eq(terms.status, 'active')),
      }),

      // Enrollment breakdown by instrument (active enrollments only, scoped to teacher if applicable)
      this.db.db.select({
        instrument: enrollments.instrument,
        lessonType: enrollments.lessonType,
        count: count(),
      })
        .from(enrollments)
        .where(enrollmentScope)
        .groupBy(enrollments.instrument, enrollments.lessonType)
        .orderBy(enrollments.instrument),
    ]);

    const activeStudents = studentCounts.find(s => s.status === 'active')?.count ?? 0;
    const trialStudents = studentCounts.find(s => s.status === 'trial')?.count ?? 0;
    const totalStudents = studentCounts.reduce((s, r) => s + r.count, 0);

    const completedLessons = lessonStats.find(l => l.status === 'completed')?.count ?? 0;
    const scheduledLessons = lessonStats.find(l => l.status === 'scheduled')?.count ?? 0;

    const weekScheduled = weeklyLessonStats.find(l => l.status === 'scheduled')?.count ?? 0;
    const weekCompleted = weeklyLessonStats.find(l => l.status === 'completed')?.count ?? 0;

    // Roll up instrument breakdown — merge private/group counts per instrument.
    // `instrument` is free text, so normalise the key (trim + lowercase) or the
    // same instrument entered with different casing/whitespace ("Piano" vs
    // "piano") shows up as two separate rows. The label is emitted lowercased and
    // the dashboard capitalises it for display.
    const instrMap = new Map<string, { private: number; group: number }>();
    for (const row of enrollmentByInstrument) {
      const key = row.instrument.trim().toLowerCase();
      if (!key) continue;
      const existing = instrMap.get(key) ?? { private: 0, group: 0 };
      if (row.lessonType === 'private') existing.private += row.count;
      else existing.group += row.count;
      instrMap.set(key, existing);
    }
    const instrumentBreakdown = [...instrMap.entries()]
      .map(([instrument, counts]) => ({ instrument, ...counts, total: counts.private + counts.group }))
      .sort((a, b) => b.total - a.total);

    return {
      scoped: !!scopeTeacherId,
      students: { active: activeStudents, trial: trialStudents, total: totalStudents },
      families: familyCount[0]?.count ?? 0,
      staff: staffCount[0]?.count ?? 0,
      lessons: {
        completedThisMonth: completedLessons,
        scheduledThisMonth: scheduledLessons,
        totalThisMonth: completedLessons + scheduledLessons,
      },
      weeklyLessons: { scheduled: weekScheduled, completed: weekCompleted, total: weekScheduled + weekCompleted },
      revenue: {
        thisMonth: Number(revenueStats[0]?.total ?? 0),
      },
      invoices: {
        outstandingTotal: Number(outstandingInvoices[0]?.total ?? 0),
        outstandingCount: outstandingInvoices[0]?.count ?? 0,
      },
      activeTerm: termsList[0] ?? null,
      instrumentBreakdown,
    };
  }

  async getAttendanceReport(orgId: string, from: string, to: string) {
    const stats = await this.db.db.select({ status: lessons.status, count: count() })
      .from(lessons)
      .where(and(
        eq(lessons.organizationId, orgId),
        gte(lessons.startsAt, new Date(from)),
        lte(lessons.startsAt, periodEndInclusive(new Date(to))),
      ))
      .groupBy(lessons.status);

    return { from, to, byStatus: stats };
  }

  async getRevenueReport(orgId: string, from: string, to: string) {
    const org = await this.db.db.query.organizations.findFirst({ where: eq(organizations.id, orgId) });
    const accountingMode: 'cash' | 'accrual' =
      (org?.settings as Record<string, unknown> | null)?.accountingMode === 'accrual' ? 'accrual' : 'cash';

    const entries = await this.db.db.select({
      type: ledgerEntries.type,
      total: sum(ledgerEntries.amount),
    })
      .from(ledgerEntries)
      .where(and(
        eq(ledgerEntries.organizationId, orgId),
        gte(ledgerEntries.occurredAt, new Date(from)),
        lte(ledgerEntries.occurredAt, periodEndInclusive(new Date(to))),
      ))
      .groupBy(ledgerEntries.type);

    // Headline figure: cash mode = money actually received (payments); accrual =
    // revenue earned (charges). `charge` ledger entries are stored NEGATIVE (they
    // debit the family's balance — see billing.service / attendance.service), so
    // summing them straight gives a negative accrual "revenue", which then
    // rendered as e.g. "-£5,000" on the reports page. Negate the charge sum so
    // accrual revenue reads positive; payments are already positive for cash.
    const headlineType = accountingMode === 'cash' ? 'payment' : 'charge';
    const signedTotal = Number(entries.find(e => e.type === headlineType)?.total ?? 0);
    const total = accountingMode === 'accrual' ? -signedTotal : signedTotal;

    // "Earned from completed lessons" — the value of the lessons actually taught
    // (or late-cancelled) in the period, independent of how they were paid for
    // (ledger charge, prepaid credit, or invoice). This is the figure that lines
    // up with the "lessons completed" count on the same page: marking a lesson
    // present makes it show up here, even when it was covered by a prepaid credit
    // and therefore posted no ledger charge. Reconciles the "£2 revenue but many
    // lessons completed" confusion.
    const earnedLessons = await this.db.db.query.lessons.findMany({
      where: and(
        eq(lessons.organizationId, orgId),
        gte(lessons.startsAt, new Date(from)),
        lte(lessons.startsAt, periodEndInclusive(new Date(to))),
        inArray(lessons.status, ['completed', 'cancelled_no_makeup']),
      ),
      with: { enrollment: { columns: { rate: true, defaultDuration: true, lessonType: true, trialRate: true } } },
    });
    // Value each lesson exactly as the authoritative charge does
    // (effectiveLessonAmount): a trial bills its flat trialRate, a group class
    // its flat rate, a private lesson prorated. Raw proratedAmount here priced
    // trials at the FULL rate (ignoring trialRate — trials are usually free or
    // discounted) and prorated group classes by the minute, so this admin
    // "Earned from completed lessons" headline overstated revenue and disagreed
    // with what families were actually charged — the same divergence PR #163/#170
    // fixed on the invoice and the student-invoice PDF, missed here.
    const earnedFromLessons = earnedLessons.reduce(
      (s, l) => s + effectiveLessonAmount({
        isTrialLesson: l.isTrialLesson,
        lessonType: l.enrollment?.lessonType,
        rate: l.enrollment?.rate,
        trialRate: l.enrollment?.trialRate,
        defaultDuration: l.enrollment?.defaultDuration,
        duration: l.duration,
      }),
      0,
    );

    return {
      from, to, accountingMode, total, byType: entries,
      earnedFromLessons,
      completedLessons: earnedLessons.length,
    };
  }

  async getRetentionReport(orgId: string) {
    const rows = await this.db.db.select({
      month: sql<string>`to_char(date_trunc('month', ${enrollments.createdAt}), 'YYYY-MM')`,
      status: students.status,
      count: count(),
    })
      .from(enrollments)
      .innerJoin(students, eq(students.id, enrollments.studentId))
      .where(and(eq(enrollments.organizationId, orgId), inArray(students.status, ['active', 'withdrawn'])))
      .groupBy(sql`date_trunc('month', ${enrollments.createdAt})`, students.status)
      .orderBy(sql`date_trunc('month', ${enrollments.createdAt})`);

    const byMonth = new Map<string, { month: string; active: number; withdrawn: number }>();
    for (const r of rows) {
      const entry = byMonth.get(r.month) ?? { month: r.month, active: 0, withdrawn: 0 };
      if (r.status === 'active' || r.status === 'withdrawn') entry[r.status] = r.count;
      byMonth.set(r.month, entry);
    }
    return { byMonth: [...byMonth.values()] };
  }

  // ─── PDF data ─────────────────────────────────────────────────────────────

  // Student invoice data: projected invoice for a date range (scheduled + completed lessons)
  async getStudentInvoicePdfData(orgId: string, studentId: string, from: string, to: string) {
    const student = await this.db.db.query.students.findFirst({
      where: and(eq(students.id, studentId), eq(students.organizationId, orgId)),
      with: { family: { columns: { id: true, name: true, email: true, address: true } } },
    });
    if (!student) throw new NotFoundException('Student not found');

    const org = await this.db.db.query.organizations.findFirst({ where: eq(organizations.id, orgId) });
    const tz = await getOrgTimezone(this.db.db, orgId);

    const periodLessons = await this.db.db.query.lessons.findMany({
      where: and(
        eq(lessons.organizationId, orgId),
        eq(lessons.studentId, studentId),
        gte(lessons.startsAt, new Date(from)),
        lte(lessons.startsAt, periodEndInclusive(new Date(to))),
      ),
      with: {
        enrollment: { columns: { instrument: true, rate: true, defaultDuration: true, lessonType: true, trialRate: true } },
        attendance: { columns: { status: true } },
      },
      orderBy: (l, { asc }) => [asc(l.startsAt)],
    });

    const lineItems = periodLessons
      .filter(l => l.status !== 'cancelled_no_pay' && l.status !== 'cancelled_teacher')
      .map(l => ({
        id: l.id,
        date: formatInZone(l.startsAt, tz, {}),
        description: `${l.isTrialLesson ? 'Trial: ' : ''}${l.enrollment?.instrument ?? 'Lesson'} — ${l.duration} min${l.status === 'cancelled_no_makeup' ? ' (late cancellation)' : ''}`,
        // Price each line exactly as the authoritative invoice/attendance charge
        // does (billing's effectiveLessonAmount): a trial bills its flat trialRate,
        // a group class its flat rate, a private lesson prorated. Using raw
        // proratedAmount here priced trials at the full rate and prorated group
        // classes by the minute, so this family-facing PDF disagreed with the
        // actual balance and invoice (the same divergence PR #163 fixed there).
        amount: effectiveLessonAmount({
          isTrialLesson: l.isTrialLesson,
          lessonType: l.enrollment?.lessonType,
          rate: l.enrollment?.rate,
          trialRate: l.enrollment?.trialRate,
          defaultDuration: l.enrollment?.defaultDuration,
          duration: l.duration,
        }),
        status: l.status,
        attended: l.status === 'completed',
      }));

    const total = lineItems.reduce((s, i) => s + i.amount, 0);

    const creditBalance = await this.db.db.query.lessonCredits.findMany({
      where: and(
        eq(lessonCredits.organizationId, orgId),
        eq(lessonCredits.studentId, studentId),
        eq(lessonCredits.status, 'available'),
      ),
    });

    return {
      student: { id: student.id, name: `${student.firstName} ${student.lastName}`, family: student.family },
      org: { name: org?.name ?? 'Music & Life' },
      period: { from, to },
      lineItems,
      total,
      creditsRemaining: creditBalance.length,
    };
  }

  // Teacher payroll record: all payable lessons in a period
  async getTeacherPayrollPdfData(orgId: string, staffId: string, from: string, to: string) {
    const staff = await this.db.db.query.staffMembers.findFirst({
      where: and(eq(staffMembers.id, staffId), eq(staffMembers.organizationId, orgId)),
    });
    if (!staff) throw new NotFoundException('Staff member not found');

    const org = await this.db.db.query.organizations.findFirst({ where: eq(organizations.id, orgId) });
    const tz = await getOrgTimezone(this.db.db, orgId);

    const periodLessons = await this.db.db.query.lessons.findMany({
      where: and(
        eq(lessons.organizationId, orgId),
        eq(lessons.teacherId, staffId),
        gte(lessons.startsAt, new Date(from)),
        lte(lessons.startsAt, periodEndInclusive(new Date(to))),
      ),
      with: {
        student: { columns: { firstName: true, lastName: true } },
        enrollment: { columns: { instrument: true } },
        attendance: { columns: { status: true, actualStartedAt: true, actualEndedAt: true } },
      },
      orderBy: (l, { asc }) => [asc(l.startsAt)],
    });

    const payableStatuses = new Set(['completed', 'cancelled_no_makeup']);
    const rows = periodLessons
      .filter(l => payableStatuses.has(l.status))
      .map(l => {
        // Mirror the payroll RUN (computeRunItems) exactly: actual elapsed time
        // overrides the scheduled duration ONLY for a lesson that was actually
        // taught (completed). A late cancellation is always paid at the scheduled
        // duration — the lesson never happened, so any actualStartedAt/EndedAt
        // left on its attendance row (a mis-mark correction from 'present' to
        // 'absent_no_makeup' preserves the old times, see attendance.service) is
        // stale and must not move the pay. Without this status gate the payroll
        // record a manager downloads showed a different gross than the run
        // actually pays.
        let minutes = l.duration;
        if (l.status === 'completed' && l.attendance?.actualStartedAt && l.attendance?.actualEndedAt) {
          minutes = Math.round((l.attendance.actualEndedAt.getTime() - l.attendance.actualStartedAt.getTime()) / 60000);
        }
        const amount = Math.round((minutes / 60) * staff.hourlyRate);
        return {
          id: l.id,
          date: formatInZone(l.startsAt, tz, {}),
          studentName: l.student ? `${l.student.firstName} ${l.student.lastName}` : '—',
          instrument: l.enrollment?.instrument ?? '—',
          minutes,
          type: l.status === 'cancelled_no_makeup' ? 'Late cancellation' : 'Lesson',
          amount,
        };
      });

    const totalMinutes = rows.reduce((s, r) => s + r.minutes, 0);
    const gross = rows.reduce((s, r) => s + r.amount, 0);

    return {
      staff: { id: staff.id, name: `${staff.firstName} ${staff.lastName}`, hourlyRate: staff.hourlyRate },
      org: { name: org?.name ?? 'Music & Life' },
      period: { from, to },
      rows,
      totalMinutes,
      totalHours: Math.round((totalMinutes / 60) * 100) / 100,
      gross,
    };
  }

  // Student attendance history: full lesson-by-lesson record
  async getStudentAttendancePdfData(orgId: string, studentId: string, from: string, to: string) {
    const student = await this.db.db.query.students.findFirst({
      where: and(eq(students.id, studentId), eq(students.organizationId, orgId)),
      with: { family: { columns: { name: true } } },
    });
    if (!student) throw new NotFoundException('Student not found');

    const tz = await getOrgTimezone(this.db.db, orgId);

    const periodLessons = await this.db.db.query.lessons.findMany({
      where: and(
        eq(lessons.organizationId, orgId),
        eq(lessons.studentId, studentId),
        gte(lessons.startsAt, new Date(from)),
        lte(lessons.startsAt, periodEndInclusive(new Date(to))),
      ),
      with: {
        teacher: { columns: { firstName: true, lastName: true } },
        enrollment: { columns: { instrument: true } },
        attendance: { columns: { status: true, markedAt: true } },
      },
      orderBy: (l, { asc }) => [asc(l.startsAt)],
    });

    const ATTENDANCE_LABELS: Record<string, string> = {
      present: 'Present',
      absent_makeup: 'Absent — no charge (rebooking)',
      absent_no_makeup: 'Absent — late cancellation',
      absent_no_pay: 'Absent — no charge',
      cancelled_teacher: 'Cancelled (teacher)',
    };

    const rows = periodLessons.map(l => ({
      id: l.id,
      date: formatInZone(l.startsAt, tz, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }),
      time: formatInZone(l.startsAt, tz, { hour: '2-digit', minute: '2-digit' }),
      teacher: l.teacher ? `${l.teacher.firstName} ${l.teacher.lastName}` : '—',
      instrument: l.enrollment?.instrument ?? '—',
      duration: l.duration,
      isTrial: l.isTrialLesson,
      status: l.status,
      attendanceLabel: l.attendance ? (ATTENDANCE_LABELS[l.attendance.status] ?? l.attendance.status) : (l.status === 'scheduled' ? 'Scheduled' : '—'),
    }));

    const present = rows.filter(r => r.status === 'completed').length;
    const total = rows.filter(r => r.status !== 'scheduled').length;

    return {
      student: { id: student.id, name: `${student.firstName} ${student.lastName}`, family: student.family },
      period: { from, to },
      rows,
      summary: { present, total, attendanceRate: total > 0 ? Math.round((present / total) * 100) : null },
    };
  }

  async getEnrollmentReport(orgId: string) {
    const stats = await this.db.db.select({
      instrument: enrollments.instrument,
      lessonType: enrollments.lessonType,
      count: count(),
    })
      .from(enrollments)
      .where(and(eq(enrollments.organizationId, orgId), eq(enrollments.status, 'active')))
      .groupBy(enrollments.instrument, enrollments.lessonType)
      .orderBy(enrollments.instrument);

    // `instrument` is free text, so "Piano" and "piano" arrive as two rows and
    // fragment both the UI cards and the CSV. Merge case-insensitively per
    // (instrument, lessonType); emit the label lowercased (the page capitalises it).
    const merged = new Map<string, { instrument: string; lessonType: string; count: number }>();
    for (const row of stats) {
      const label = row.instrument.trim().toLowerCase();
      if (!label) continue;
      const key = `${label}|${row.lessonType}`;
      const existing = merged.get(key);
      if (existing) existing.count += row.count;
      else merged.set(key, { instrument: label, lessonType: row.lessonType, count: row.count });
    }
    const byInstrument = [...merged.values()].sort(
      (a, b) => a.instrument.localeCompare(b.instrument) || a.lessonType.localeCompare(b.lessonType),
    );

    return { byInstrument };
  }
}
