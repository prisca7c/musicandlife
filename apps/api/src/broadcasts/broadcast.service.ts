import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import {
  memberships, users, enrollments, students, families, guardians, staffMembers,
} from '@music-life/db';
import { DbService } from '../db/db.service';
import { EmailPort } from '../email/ports/email.port';
import { TEMPLATES } from '../notifications/notifications.service';
import type { BroadcastAudience, BroadcastFilterDto } from './dto/broadcast.dto';

// The roles that make up each audience. "Families" means the parents/guardians
// who receive studio communications; children (students) are addressed on their
// own only when explicitly chosen.
const AUDIENCE_ROLES: Record<BroadcastAudience, string[]> = {
  families: ['guardian'],
  teachers: ['teacher'],
  students: ['student'],
  everyone: ['guardian', 'teacher', 'student'],
};

/**
 * Turn the plain text a staff member types into safe, paragraph-formatted HTML.
 * The newsletter template drops `body` straight into the branded shell, so we
 * escape first (no HTML injection from the compose box) and then honour blank
 * lines as paragraphs and single newlines as line breaks.
 */
export function broadcastBodyToHtml(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return escaped
    .split(/\n{2,}/)
    .map((para) => `<p style="margin:0 0 12px">${para.replace(/\n/g, '<br>')}</p>`)
    .join('');
}

@Injectable()
export class BroadcastService {
  private readonly logger = new Logger(BroadcastService.name);

  constructor(
    private readonly db: DbService,
    private readonly email: EmailPort,
  ) {}

  /** Distinct, lower-cased recipient addresses for an audience in this org. */
  private async audienceEmails(orgId: string, audience: BroadcastAudience): Promise<string[]> {
    const rows = await this.db.db.query.memberships.findMany({
      where: and(
        eq(memberships.organizationId, orgId),
        eq(memberships.status, 'active'),
        inArray(memberships.baseRole, AUDIENCE_ROLES[audience] as never),
      ),
      with: { user: { columns: { email: true } } },
    });
    const emails: (string | null | undefined)[] = rows.map((r) => r.user?.email);

    // A family created by staff or bulk import keeps its contact address on the
    // family record and often has no guardian *login* at all — so a
    // membership-only lookup silently skips it. The office sees "sent to N" and
    // never learns those families got nothing. Fold in the family contact
    // address for any audience that includes families, exactly as the subgroup
    // (filtered) path already does, so "message all families" really reaches all.
    if (audience === 'families' || audience === 'everyone') {
      const famRows = await this.db.db.query.families.findMany({
        where: eq(families.organizationId, orgId),
        columns: { id: true, email: true },
      });
      emails.push(...famRows.map((f) => f.email));

      // Since student-portal parity (an adult student can manage their own
      // account with no guardian at all), a family may have neither a
      // guardian login nor a families.email on file — its only reachable
      // contact is the student's own login. Without this, those families were
      // silently invisible to "message all families", the same failure mode
      // families.email was added to close, reopened by a different gap.
      const guardianFamilyIds = new Set(
        (await this.db.db.query.guardians.findMany({
          where: eq(guardians.organizationId, orgId),
          columns: { familyId: true },
        })).map((g) => g.familyId),
      );
      const uncoveredFamilyIds = famRows
        .filter((f) => !f.email?.trim() && !guardianFamilyIds.has(f.id))
        .map((f) => f.id);
      if (uncoveredFamilyIds.length) {
        const studentUserIds = (await this.db.db.query.students.findMany({
          where: and(eq(students.organizationId, orgId), inArray(students.familyId, uncoveredFamilyIds)),
          columns: { studentUserId: true },
        })).map((s) => s.studentUserId).filter((u): u is string => !!u);
        if (studentUserIds.length) {
          const userRows = await this.db.db.query.users.findMany({
            where: inArray(users.id, studentUserIds),
            columns: { email: true },
          });
          emails.push(...userRows.map((u) => u.email));
        }
      }
    }

    return BroadcastService.dedupe(emails);
  }

  /** How many people each audience would reach — powers the pre-send count. */
  async audienceCounts(orgId: string): Promise<Record<BroadcastAudience, number>> {
    const [families, teachers, students, everyone] = await Promise.all([
      this.audienceEmails(orgId, 'families'),
      this.audienceEmails(orgId, 'teachers'),
      this.audienceEmails(orgId, 'students'),
      this.audienceEmails(orgId, 'everyone'),
    ]);
    return {
      families: families.length,
      teachers: teachers.length,
      students: students.length,
      everyone: everyone.length,
    };
  }

  // ─── Subgroup targeting ─────────────────────────────────────────────────────
  // A subgroup is defined by what people study, which lives on enrollments, not
  // on memberships — so a filtered send resolves recipients through enrollments
  // instead of the membership path above.

  static hasFilter(f?: BroadcastFilterDto): boolean {
    return !!(f && (f.instrument || f.lessonType || f.groupName || f.teacherId));
  }

  private static dedupe(emails: (string | null | undefined)[]): string[] {
    return [...new Set(
      emails.map((e) => e?.trim().toLowerCase()).filter((e): e is string => !!e),
    )];
  }

  /** The distinct values the compose screen offers as subgroup options. */
  async segments(orgId: string) {
    const rows = await this.db.db.query.enrollments.findMany({
      where: and(
        eq(enrollments.organizationId, orgId),
        inArray(enrollments.status, ['trial', 'active', 'paused']),
      ),
      columns: { instrument: true, groupName: true, teacherId: true },
    });

    const teacherIds = [...new Set(rows.map((r) => r.teacherId).filter((t): t is string => !!t))];
    const teacherRows = teacherIds.length
      ? await this.db.db.query.staffMembers.findMany({
          where: and(eq(staffMembers.organizationId, orgId), inArray(staffMembers.id, teacherIds)),
          columns: { id: true, firstName: true, lastName: true },
        })
      : [];

    // Instruments were entered inconsistently over time — imported rows use
    // "Piano" while the registration form writes "piano" — so the same
    // instrument appears twice. Fold them case-insensitively (keeping the
    // nicest-looking spelling) or the studio would have to send the same email
    // once per capitalisation. Matching below is case-insensitive to suit.
    const byLower = new Map<string, string>();
    for (const r of rows) {
      const name = r.instrument?.trim();
      if (!name) continue;
      const key = name.toLowerCase();
      const seen = byLower.get(key);
      // Prefer a capitalised spelling for display.
      if (!seen || (seen[0] === seen[0]?.toLowerCase() && name[0] !== name[0]?.toLowerCase())) {
        byLower.set(key, name);
      }
    }

    return {
      instruments: [...byLower.values()].sort((a, b) => a.localeCompare(b)),
      groupNames: [...new Set(rows.map((r) => r.groupName).filter((g): g is string => !!g))].sort(),
      teachers: teacherRows
        .map((t) => ({ id: t.id, name: `${t.firstName} ${t.lastName}` }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  }

  /**
   * Recipients for a subgroup. Withdrawn enrollments are excluded so a family
   * that stopped piano isn't emailed about the piano recital.
   */
  private async filteredEmails(
    orgId: string,
    audience: BroadcastAudience,
    filter: BroadcastFilterDto,
  ): Promise<string[]> {
    const clauses: (SQL | undefined)[] = [
      eq(enrollments.organizationId, orgId),
      inArray(enrollments.status, ['trial', 'active', 'paused']),
      // Case-insensitive: the same instrument is stored as both "Piano" and
      // "piano" depending on whether the row came from an import or the
      // registration form. An exact match would silently reach only half the
      // families who study it.
      filter.instrument
        ? sql`lower(${enrollments.instrument}) = ${filter.instrument.trim().toLowerCase()}`
        : undefined,
      filter.lessonType ? eq(enrollments.lessonType, filter.lessonType) : undefined,
      filter.groupName
        ? sql`lower(${enrollments.groupName}) = ${filter.groupName.trim().toLowerCase()}`
        : undefined,
      filter.teacherId ? eq(enrollments.teacherId, filter.teacherId) : undefined,
    ];

    const matched = await this.db.db.query.enrollments.findMany({
      where: and(...clauses),
      columns: { studentId: true, teacherId: true },
    });
    if (matched.length === 0) return [];

    const studentIds = [...new Set(matched.map((m) => m.studentId))];
    const wantsFamilies = audience === 'families' || audience === 'everyone';
    const wantsStudents = audience === 'students' || audience === 'everyone';
    const wantsTeachers = audience === 'teachers' || audience === 'everyone';

    const out: (string | null | undefined)[] = [];

    if (wantsFamilies || wantsStudents) {
      const studentRows = await this.db.db.query.students.findMany({
        where: and(eq(students.organizationId, orgId), inArray(students.id, studentIds)),
        columns: { id: true, email: true, familyId: true, studentUserId: true },
      });

      if (wantsStudents) {
        out.push(...studentRows.map((s) => s.email));
        // A student who logs in may have registered a different address there.
        const studentUserIds = studentRows.map((s) => s.studentUserId).filter((u): u is string => !!u);
        if (studentUserIds.length) {
          const rows = await this.db.db.query.users.findMany({
            where: inArray(users.id, studentUserIds),
            columns: { email: true },
          });
          out.push(...rows.map((r) => r.email));
        }
      }

      if (wantsFamilies) {
        const familyIds = [...new Set(studentRows.map((s) => s.familyId).filter(Boolean))];
        if (familyIds.length) {
          // The family contact address and any guardian login are both valid
          // ways to reach a family, and plenty of families have only one.
          const [famRows, guardianRows] = await Promise.all([
            this.db.db.query.families.findMany({
              where: and(eq(families.organizationId, orgId), inArray(families.id, familyIds)),
              columns: { id: true, email: true },
            }),
            this.db.db.query.guardians.findMany({
              where: and(eq(guardians.organizationId, orgId), inArray(guardians.familyId, familyIds)),
              with: { user: { columns: { email: true } } },
            }),
          ]);
          out.push(...famRows.map((f) => f.email));
          out.push(...guardianRows.map((g) => (g as { user?: { email: string | null } }).user?.email));

          // Same fallback as audienceEmails: a family with no guardian and no
          // families.email — the adult-student-only case — is only reachable
          // through the matched student's own login.
          const guardianFamilyIds = new Set(guardianRows.map((g) => g.familyId));
          const uncoveredFamilyIds = new Set(
            famRows.filter((f) => !f.email?.trim() && !guardianFamilyIds.has(f.id)).map((f) => f.id),
          );
          if (uncoveredFamilyIds.size) {
            const studentUserIds = studentRows
              .filter((s) => s.familyId && uncoveredFamilyIds.has(s.familyId))
              .map((s) => s.studentUserId)
              .filter((u): u is string => !!u);
            if (studentUserIds.length) {
              const rows = await this.db.db.query.users.findMany({
                where: inArray(users.id, studentUserIds),
                columns: { email: true },
              });
              out.push(...rows.map((r) => r.email));
            }
          }
        }
      }
    }

    if (wantsTeachers) {
      const teacherIds = [...new Set(matched.map((m) => m.teacherId).filter((t): t is string => !!t))];
      if (teacherIds.length) {
        const rows = await this.db.db.query.staffMembers.findMany({
          where: and(eq(staffMembers.organizationId, orgId), inArray(staffMembers.id, teacherIds)),
          with: { user: { columns: { email: true } } },
        });
        out.push(...rows.map((r) => (r as { user?: { email: string | null } }).user?.email));
      }
    }

    return BroadcastService.dedupe(out);
  }

  /** Recipients for a send: the subgroup when filtered, else the whole audience. */
  private async resolveRecipients(
    orgId: string,
    audience: BroadcastAudience,
    filter?: BroadcastFilterDto,
  ): Promise<string[]> {
    return BroadcastService.hasFilter(filter)
      ? this.filteredEmails(orgId, audience, filter!)
      : this.audienceEmails(orgId, audience);
  }

  /** Headcount for the composed selection, so nothing is sent blind. */
  async preview(orgId: string, audience: BroadcastAudience, filter?: BroadcastFilterDto) {
    const recipients = await this.resolveRecipients(orgId, audience, filter);
    return { total: recipients.length, filtered: BroadcastService.hasFilter(filter) };
  }

  private render(subject: string, body: string) {
    return TEMPLATES['newsletter.event']!({
      orgId: '',
      subject,
      body: broadcastBodyToHtml(body),
    });
  }

  /** Send the composed email to a single address (the sender testing it on themselves). */
  async sendTest(orgId: string, userId: string, subject: string, body: string) {
    const me = await this.db.db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: { email: true },
    });
    if (!me?.email) throw new NotFoundException('Your account has no email address to send a test to.');

    const { subject: subj, html } = this.render(subject, body);
    await this.email.send({ to: me.email, subject: subj, html });
    return { ok: true, sentTo: me.email };
  }

  /**
   * Fan the composed email out to a whole audience. Individual failures are
   * tolerated and counted rather than aborting the run, so one bad address
   * can't stop everyone else from being reached.
   */
  async send(
    orgId: string,
    audience: BroadcastAudience,
    subject: string,
    body: string,
    filter?: BroadcastFilterDto,
  ) {
    const recipients = await this.resolveRecipients(orgId, audience, filter);
    const { subject: subj, html } = this.render(subject, body);

    let sent = 0;
    let failed = 0;
    for (const to of recipients) {
      try {
        await this.email.send({ to, subject: subj, html });
        sent++;
      } catch (err) {
        failed++;
        this.logger.warn(`Broadcast to ${to} failed: ${err instanceof Error ? err.message : err}`);
      }
    }
    this.logger.log(`Broadcast "${subject}" to ${audience}: ${sent} sent, ${failed} failed of ${recipients.length}`);
    return { audience, total: recipients.length, sent, failed };
  }
}
