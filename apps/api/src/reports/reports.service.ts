import { Injectable, NotFoundException } from '@nestjs/common';
import { eq, and, gte, lte, count, sum } from 'drizzle-orm';
import {
  students, staffMembers, families, lessons, attendance,
  invoices, ledgerEntries, enrollments, terms, lessonCredits,
  payrollRuns, payrollItems, organizations,
} from '@music-life/db';
import { DbService } from '../db/db.service';

@Injectable()
export class ReportsService {
  constructor(private readonly db: DbService) {}

  async getDashboardKpis(orgId: string) {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
    // Week: Mon–Sun
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    weekStart.setHours(0, 0, 0, 0);
    const weekEnd = new Date(weekStart.getTime() + 7 * 86400000);

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
      // Students by status
      this.db.db.select({ status: students.status, count: count() })
        .from(students)
        .where(eq(students.organizationId, orgId))
        .groupBy(students.status),

      // Family count
      this.db.db.select({ count: count() })
        .from(families)
        .where(eq(families.organizationId, orgId)),

      // Active staff
      this.db.db.select({ count: count() })
        .from(staffMembers)
        .where(and(eq(staffMembers.organizationId, orgId), eq(staffMembers.status, 'active'))),

      // Lessons this month
      this.db.db.select({ status: lessons.status, count: count() })
        .from(lessons)
        .where(and(
          eq(lessons.organizationId, orgId),
          gte(lessons.startsAt, monthStart),
          lte(lessons.startsAt, monthEnd),
        ))
        .groupBy(lessons.status),

      // Lessons this week
      this.db.db.select({ status: lessons.status, count: count() })
        .from(lessons)
        .where(and(
          eq(lessons.organizationId, orgId),
          gte(lessons.startsAt, weekStart),
          lte(lessons.startsAt, weekEnd),
        ))
        .groupBy(lessons.status),

      // Revenue this month (payments)
      this.db.db.select({ total: sum(ledgerEntries.amount) })
        .from(ledgerEntries)
        .where(and(
          eq(ledgerEntries.organizationId, orgId),
          eq(ledgerEntries.type, 'payment'),
          gte(ledgerEntries.occurredAt, monthStart),
        )),

      // Outstanding invoices
      this.db.db.select({ total: sum(invoices.total), count: count() })
        .from(invoices)
        .where(and(eq(invoices.organizationId, orgId), eq(invoices.status, 'sent'))),

      // Active terms
      this.db.db.query.terms.findMany({
        where: and(eq(terms.organizationId, orgId), eq(terms.status, 'active')),
      }),

      // Enrollment breakdown by instrument (active enrollments only)
      this.db.db.select({
        instrument: enrollments.instrument,
        lessonType: enrollments.lessonType,
        count: count(),
      })
        .from(enrollments)
        .where(and(eq(enrollments.organizationId, orgId), eq(enrollments.status, 'active')))
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

    // Roll up instrument breakdown — merge private/group counts per instrument
    const instrMap = new Map<string, { private: number; group: number }>();
    for (const row of enrollmentByInstrument) {
      const key = row.instrument;
      const existing = instrMap.get(key) ?? { private: 0, group: 0 };
      if (row.lessonType === 'private') existing.private += row.count;
      else existing.group += row.count;
      instrMap.set(key, existing);
    }
    const instrumentBreakdown = [...instrMap.entries()]
      .map(([instrument, counts]) => ({ instrument, ...counts, total: counts.private + counts.group }))
      .sort((a, b) => b.total - a.total);

    return {
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
        lte(lessons.startsAt, new Date(to)),
      ))
      .groupBy(lessons.status);

    return { from, to, byStatus: stats };
  }

  async getRevenueReport(orgId: string, from: string, to: string) {
    const entries = await this.db.db.select({
      type: ledgerEntries.type,
      total: sum(ledgerEntries.amount),
    })
      .from(ledgerEntries)
      .where(and(
        eq(ledgerEntries.organizationId, orgId),
        gte(ledgerEntries.occurredAt, new Date(from)),
        lte(ledgerEntries.occurredAt, new Date(to)),
      ))
      .groupBy(ledgerEntries.type);

    return { from, to, byType: entries };
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

    const periodLessons = await this.db.db.query.lessons.findMany({
      where: and(
        eq(lessons.organizationId, orgId),
        eq(lessons.studentId, studentId),
        gte(lessons.startsAt, new Date(from)),
        lte(lessons.startsAt, new Date(to)),
      ),
      with: {
        enrollment: { columns: { instrument: true, rate: true } },
        attendance: { columns: { status: true } },
      },
      orderBy: (l, { asc }) => [asc(l.startsAt)],
    });

    const lineItems = periodLessons
      .filter(l => l.status !== 'cancelled_no_pay' && l.status !== 'cancelled_teacher')
      .map(l => ({
        id: l.id,
        date: l.startsAt.toLocaleDateString('en-GB'),
        description: `${l.isTrialLesson ? 'Trial: ' : ''}${l.enrollment?.instrument ?? 'Lesson'} — ${l.duration} min${l.status === 'cancelled_no_makeup' ? ' (late cancellation)' : ''}`,
        amount: l.enrollment?.rate ?? 0,
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

    const periodLessons = await this.db.db.query.lessons.findMany({
      where: and(
        eq(lessons.organizationId, orgId),
        eq(lessons.teacherId, staffId),
        gte(lessons.startsAt, new Date(from)),
        lte(lessons.startsAt, new Date(to)),
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
        let minutes = l.duration;
        if (l.attendance?.actualStartedAt && l.attendance?.actualEndedAt) {
          minutes = Math.round((l.attendance.actualEndedAt.getTime() - l.attendance.actualStartedAt.getTime()) / 60000);
        }
        const amount = Math.round((minutes / 60) * staff.hourlyRate);
        return {
          id: l.id,
          date: l.startsAt.toLocaleDateString('en-GB'),
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

    const periodLessons = await this.db.db.query.lessons.findMany({
      where: and(
        eq(lessons.organizationId, orgId),
        eq(lessons.studentId, studentId),
        gte(lessons.startsAt, new Date(from)),
        lte(lessons.startsAt, new Date(to)),
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
      absent_makeup: 'Absent — makeup credit given',
      absent_no_makeup: 'Absent — late cancellation',
      absent_no_pay: 'Absent — no charge',
      cancelled_teacher: 'Cancelled (teacher)',
    };

    const rows = periodLessons.map(l => ({
      id: l.id,
      date: l.startsAt.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }),
      time: l.startsAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
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

    return { byInstrument: stats };
  }
}
