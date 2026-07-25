import { Injectable, NotFoundException, ConflictException, Logger, BadRequestException } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { registrations, organizations, families, students, enrollments, users, memberships, passwordResetTokens, guardians } from '@music-life/db';
import type { Db } from '@music-life/db';
import { randomBytes, createHash } from 'crypto';
import { DbService } from '../db/db.service';
import { NotificationsService } from '../notifications/notifications.service';
import { EmailPort } from '../email/ports/email.port';
import { brandedEmail, loginDetailsBlock } from '../email/branding';
import { parseCsv } from '../common/csv';
import type { SubmitRegistrationDto } from './dto/submit-registration.dto';

// Either the pooled db or an open transaction — the family/student/enrollment
// creation runs on whichever the caller passes so it can share a transaction
// with the registration-approval claim (all-or-nothing).
type Executor = Db | Parameters<Parameters<Db['transaction']>[0]>[0];

type CreationPayload = {
  studentFirstName: string; studentLastName: string; studentDob?: string; studentEmail?: string;
  familyName: string; contactName: string; contactEmail?: string; contactPhone?: string; address?: string;
  instruments: { instrument: string; lessonType: 'private' | 'group' }[];
  emailReminders?: boolean;
};

@Injectable()
export class RegistrationService {
  private readonly logger = new Logger(RegistrationService.name);

  constructor(
    private readonly db: DbService,
    private readonly notifications: NotificationsService,
    private readonly email: EmailPort,
  ) {}

  /** Public: submit registration */
  async submit(orgSlug: string, dto: SubmitRegistrationDto) {
    const org = await this.db.db.query.organizations.findFirst({
      where: eq(organizations.slug, orgSlug),
    });
    if (!org) throw new NotFoundException('Organisation not found');

    // Idempotency check
    if (dto.idempotencyKey) {
      const existing = await this.db.db.query.registrations.findFirst({
        where: eq(registrations.idempotencyKey, dto.idempotencyKey),
      });
      if (existing) return { id: existing.id, status: existing.status, message: 'Already submitted' };
    }

    const iKey = dto.idempotencyKey ?? randomBytes(16).toString('hex');
    const [reg] = await this.db.db.insert(registrations).values({
      organizationId: org.id,
      payload: dto as unknown as Record<string, unknown>,
      status: 'pending',
      idempotencyKey: iKey,
    }).returning();

    // Notify admin
    this.notifications.trigger('registration.received', {
      orgId: org.id,
      email: process.env.SEED_ADMIN_EMAIL,
      body: `New registration from ${dto.contactName} for ${dto.studentFirstName} ${dto.studentLastName}.`,
    }).catch(e => this.logger.warn('Notification failed', e));

    // Confirmation to the registrant. This is also what auto-subscribes them to
    // Mailrelay (ensureSubscriber runs inside email.send), so it must fire on
    // submit — not just on approval — or the family gets no acknowledgement and
    // is never added to the mailing list.
    if (dto.contactEmail) {
      this.notifications.trigger('registration.submitted', {
        orgId: org.id,
        email: dto.contactEmail,
        body: `We've received ${dto.studentFirstName} ${dto.studentLastName}'s registration and will be in touch soon.`,
      }).catch(e => this.logger.warn('Registration confirmation email failed', e));
    }

    return { id: reg!.id, status: 'pending', message: 'Registration submitted. We\'ll be in touch soon.' };
  }

  /** Admin: list registrations */
  async list(orgId: string, status?: string) {
    return this.db.db.query.registrations.findMany({
      where: status
        ? and(eq(registrations.organizationId, orgId), eq(registrations.status, status as 'pending' | 'approved' | 'denied'))
        : eq(registrations.organizationId, orgId),
      orderBy: (r, { desc }) => [desc(r.submittedAt)],
    });
  }

  /**
   * Creates family + student + enrollments (+ portal account) on the given
   * executor. The welcome/invite email is NOT sent here — it's returned as a
   * `pendingInvite` so the caller can send it only after the surrounding
   * transaction commits (otherwise a rolled-back approval could still email a
   * "set your password" link for a user that no longer exists).
   */
  private async createFamilyStudentEnrollmentsTx(tx: Executor, orgId: string, payload: CreationPayload) {
    // Create family
    const [family] = await tx.insert(families).values({
      organizationId: orgId,
      name: payload.familyName,
      contactName: payload.contactName,
      email: payload.contactEmail,
      phone: payload.contactPhone,
      address: payload.address,
      // Honour the reminder consent checkbox from the form (defaults on).
      emailRemindersEnabled: payload.emailReminders ?? true,
    }).returning();

    // Create student
    const [student] = await tx.insert(students).values({
      organizationId: orgId,
      familyId: family!.id,
      firstName: payload.studentFirstName,
      lastName: payload.studentLastName,
      dob: payload.studentDob,
      email: payload.studentEmail,
      status: 'trial',
    }).returning();

    // Create enrollments for each instrument
    for (const inst of payload.instruments ?? []) {
      await tx.insert(enrollments).values({
        organizationId: orgId,
        studentId: student!.id,
        instrument: inst.instrument,
        lessonType: inst.lessonType,
        rate: 4500,
        autoRenew: true,
        status: 'trial',
      });
    }

    // Welcome email details, always populated when we have a contact email —
    // for a brand-new account it carries a set-password link, for a returning
    // family (the contact already has a login) it points them at the portal.
    let welcome: { to: string; contactName: string; link: string; isNewAccount: boolean } | undefined;

    // If contact email provided, wire up the portal account + guardian link.
    if (payload.contactEmail) {
      const existing = await tx.query.users.findFirst({
        where: eq(users.email, payload.contactEmail.toLowerCase()),
      });

      // The user whose account this family hangs off — a fresh invite, or the
      // returning family's existing login.
      let guardianUserId: string;

      if (!existing) {
        const [newUser] = await tx.insert(users).values({
          email: payload.contactEmail.toLowerCase(),
          passwordHash: 'INVITE_PENDING',
          emailVerifiedAt: new Date(),
        }).returning();
        guardianUserId = newUser!.id;
        await tx.insert(memberships).values({
          userId: guardianUserId, organizationId: orgId, baseRole: 'guardian',
        });
        const rawToken = randomBytes(32).toString('hex');
        const tokenHash = createHash('sha256').update(rawToken).digest('hex');
        await tx.insert(passwordResetTokens).values({
          userId: guardianUserId, tokenHash,
          expiresAt: new Date(Date.now() + 7 * 86400000),
        });
        welcome = {
          to: payload.contactEmail,
          contactName: payload.contactName,
          link: `${process.env.WEB_URL}/reset-password?token=${rawToken}`,
          isNewAccount: true,
        };
      } else {
        guardianUserId = existing.id;
        // A returning contact might not yet be a member of THIS org (e.g. they
        // only guard a family in another studio) — give them a guardian
        // membership here so they can actually log in to this org's portal.
        const membership = await tx.query.memberships.findFirst({
          where: and(eq(memberships.userId, guardianUserId), eq(memberships.organizationId, orgId)),
        });
        if (!membership) {
          await tx.insert(memberships).values({
            userId: guardianUserId, organizationId: orgId, baseRole: 'guardian',
          });
        }
        // Returning family — no new account, but still send a welcome so the
        // approval is never silent. Point them at the login page.
        welcome = {
          to: payload.contactEmail,
          contactName: payload.contactName,
          link: `${process.env.WEB_URL}/login`,
          isNewAccount: false,
        };
      }

      // Link the contact as a guardian of the newly-created family. This row is
      // what the parent portal resolves a login to a family through — it was
      // never created before, so approved families were invisible in the portal
      // (login worked, but every /family/* route 404'd "no family found").
      await tx.insert(guardians).values({
        organizationId: orgId, familyId: family!.id, userId: guardianUserId,
      });
    }

    // Auto-add to the Sender mailing list (best-effort, non-blocking): the
    // family contact goes to the Families audience, and a 16+ student with their
    // own email goes to the Students audience. This fires whenever an admin
    // brings a student on board — approving a registration or a CSV import.
    if (payload.contactEmail) {
      this.email
        .addContact({ email: payload.contactEmail, name: payload.contactName, audience: 'families' })
        .catch((e) => this.logger.warn('Add family contact failed', e));
    }
    if (payload.studentEmail) {
      this.email
        .addContact({
          email: payload.studentEmail,
          name: `${payload.studentFirstName} ${payload.studentLastName}`.trim(),
          audience: 'students',
        })
        .catch((e) => this.logger.warn('Add student contact failed', e));
    }

    return { familyId: family!.id, studentId: student!.id, welcome };
  }

  /**
   * Branded welcome email, fired after the creating transaction commits. Sent on
   * every approval that has a contact email — a brand-new family gets a
   * "set your password" call to action, a returning family gets "log in".
   */
  private sendWelcome(w: { to: string; contactName: string; link: string; isNewAccount: boolean }) {
    const esc = (s: string) => s.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]!));
    const name = esc(w.contactName || 'there');
    const body = w.isNewAccount
      ? `<p>Hi ${name},</p><p>Your registration has been approved &mdash; welcome to Music &amp; Life! Set your portal password to get started, then you can view lessons, book sessions, and see the notes and materials your teacher shares.</p>`
      : `<p>Hi ${name},</p><p>Good news &mdash; your new registration has been approved and added to your existing Music &amp; Life account. Just log in to see everything in one place.</p>`;
    const html = brandedEmail({
      previewText: w.isNewAccount ? 'Set your portal password to get started.' : 'Your new registration has been approved.',
      heading: w.isNewAccount ? 'Welcome to Music & Life!' : "You're all set at Music & Life",
      bodyHtml: body + loginDetailsBlock(w.to),
      cta: { label: w.isNewAccount ? 'Set your password' : 'Log in to your portal', url: w.link },
      footnote: 'Questions? Just reply to this email and our team will be happy to help.',
    });
    this.email.send({
      to: w.to,
      subject: w.isNewAccount ? 'Welcome to Music & Life — set your password' : 'Your Music & Life registration is approved',
      html,
    }).catch((e) => this.logger.warn('Welcome email failed', e));
  }

  /** Shared by registration approval and CSV import: atomically creates family + student + enrollments (+ portal account). */
  async createFamilyStudentEnrollments(orgId: string, payload: CreationPayload) {
    const result = await this.db.db.transaction(tx => this.createFamilyStudentEnrollmentsTx(tx, orgId, payload));
    if (result.welcome) this.sendWelcome(result.welcome);
    return { familyId: result.familyId, studentId: result.studentId };
  }

  /** Admin: approve — atomically claims the registration then creates family + student + enrollments */
  async approve(orgId: string, regId: string, decidedBy: string) {
    const result = await this.db.db.transaction(async (tx) => {
      // Guarded claim: flip pending -> approved only if still pending. Two
      // concurrent approvals race here; exactly one matches a row, the other
      // gets zero rows and aborts, so the family/student are created only once.
      const claimed = await tx.update(registrations)
        .set({ status: 'approved', decidedBy, decidedAt: new Date() })
        .where(and(
          eq(registrations.id, regId),
          eq(registrations.organizationId, orgId),
          eq(registrations.status, 'pending'),
        ))
        .returning({ payload: registrations.payload });

      if (claimed.length === 0) {
        const existing = await tx.query.registrations.findFirst({
          where: and(eq(registrations.id, regId), eq(registrations.organizationId, orgId)),
        });
        if (!existing) throw new NotFoundException('Registration not found');
        throw new BadRequestException('Already decided');
      }

      const payload = claimed[0]!.payload as SubmitRegistrationDto;
      return this.createFamilyStudentEnrollmentsTx(tx, orgId, payload);
    });

    if (result.welcome) this.sendWelcome(result.welcome);
    return { id: regId, status: 'approved', familyId: result.familyId, studentId: result.studentId };
  }

  // ─── CSV student import ─────────────────────────────────────────────────────
  private validateImportRow(data: Record<string, string>): string[] {
    const errors: string[] = [];
    if (!data.studentFirstName) errors.push('studentFirstName is required');
    if (!data.studentLastName) errors.push('studentLastName is required');
    if (!data.guardianFirstName) errors.push('guardianFirstName is required');
    if (!data.guardianLastName) errors.push('guardianLastName is required');
    const emailRe = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
    if (data.studentEmail && !emailRe.test(data.studentEmail)) errors.push('studentEmail is not a valid email');
    if (data.guardianEmail && !emailRe.test(data.guardianEmail)) errors.push('guardianEmail is not a valid email');
    if (data.lessonType && !['private', 'group'].includes(data.lessonType)) errors.push("lessonType must be 'private' or 'group'");
    if (data.studentDob) {
      const t = Date.parse(data.studentDob);
      if (isNaN(t)) {
        errors.push('studentDob is not a valid date');
      } else {
        // Same bound as the student/registration DTOs: not in the future, not a
        // slipped-digit year, so a typo'd DOB is caught before creating a student.
        const now = new Date();
        const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
        const d = new Date(t);
        if (d.getTime() > endOfToday.getTime() || d.getUTCFullYear() < 1900) {
          errors.push('studentDob must be a real date of birth (not in the future, and after 1900)');
        }
      }
    }
    return errors;
  }

  /** Admin: parse an uploaded CSV and validate rows without committing anything. */
  previewImport(csv: string) {
    const records = parseCsv(csv);
    if (records.length === 0) return { rows: [], validCount: 0, errorCount: 0 };

    const header = records[0]!.map(h => h.trim());
    const rows = records.slice(1).map((cols, i) => {
      const data: Record<string, string> = {};
      header.forEach((h, idx) => { data[h] = (cols[idx] ?? '').trim(); });
      return { rowNumber: i + 2, data, errors: this.validateImportRow(data) };
    });

    return {
      rows,
      validCount: rows.filter(r => r.errors.length === 0).length,
      errorCount: rows.filter(r => r.errors.length > 0).length,
    };
  }

  /** Admin: commit previously-previewed rows — reuses the same creation logic as registration approval. */
  async commitImport(orgId: string, rows: Record<string, string>[]) {
    let created = 0;
    const failures: { row: number; error: string }[] = [];

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]!;
      const errors = this.validateImportRow(r);
      if (errors.length > 0) { failures.push({ row: i + 1, error: errors.join('; ') }); continue; }

      try {
        await this.createFamilyStudentEnrollments(orgId, {
          studentFirstName: r.studentFirstName!,
          studentLastName: r.studentLastName!,
          studentDob: r.studentDob || undefined,
          studentEmail: r.studentEmail || undefined,
          familyName: r.familyName || `${r.guardianLastName} Family`,
          contactName: `${r.guardianFirstName} ${r.guardianLastName}`,
          contactEmail: r.guardianEmail || undefined,
          contactPhone: r.guardianPhone || undefined,
          address: r.address || undefined,
          instruments: r.instrument ? [{ instrument: r.instrument, lessonType: (r.lessonType as 'private' | 'group') || 'private' }] : [],
        });
        created++;
      } catch (e) {
        failures.push({ row: i + 1, error: e instanceof Error ? e.message : 'Unknown error' });
      }
    }

    return { created, failures };
  }

  /** Admin: deny */
  async deny(orgId: string, regId: string, decidedBy: string, reason?: string) {
    const reg = await this.db.db.query.registrations.findFirst({
      where: and(eq(registrations.id, regId), eq(registrations.organizationId, orgId)),
    });
    if (!reg) throw new NotFoundException('Registration not found');
    if (reg.status !== 'pending') throw new BadRequestException('Already decided');

    const payload = reg.payload as SubmitRegistrationDto;

    await this.db.db.update(registrations)
      .set({ status: 'denied', decidedBy, decidedAt: new Date(), denyReason: reason })
      .where(eq(registrations.id, regId));

    if (payload.contactEmail) {
      this.notifications.trigger('registration.denied', {
        orgId,
        email: payload.contactEmail,
        body: reason ?? 'We are unable to accept your registration at this time.',
      }).catch(e => this.logger.warn('Denial notification failed', e));
    }

    return { id: regId, status: 'denied' };
  }
}
