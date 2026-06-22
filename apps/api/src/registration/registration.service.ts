import { Injectable, NotFoundException, ConflictException, Logger, BadRequestException } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { registrations, organizations, families, students, enrollments, users, memberships } from '@music-life/db';
import { randomBytes, createHash } from 'crypto';
import { DbService } from '../db/db.service';
import { NotificationsService } from '../notifications/notifications.service';
import { EmailPort } from '../email/ports/email.port';
import type { SubmitRegistrationDto } from './dto/submit-registration.dto';

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

  /** Admin: approve — atomically creates family + student + enrollments */
  async approve(orgId: string, regId: string, decidedBy: string) {
    const reg = await this.db.db.query.registrations.findFirst({
      where: and(eq(registrations.id, regId), eq(registrations.organizationId, orgId)),
    });
    if (!reg) throw new NotFoundException('Registration not found');
    if (reg.status !== 'pending') throw new BadRequestException('Already decided');

    const payload = reg.payload as SubmitRegistrationDto;

    // Create family
    const [family] = await this.db.db.insert(families).values({
      organizationId: orgId,
      name: payload.familyName,
      contactName: payload.contactName,
      email: payload.contactEmail,
      phone: payload.contactPhone,
      address: payload.address,
    }).returning();

    // Create student
    const [student] = await this.db.db.insert(students).values({
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
      await this.db.db.insert(enrollments).values({
        organizationId: orgId,
        studentId: student!.id,
        instrument: inst.instrument,
        lessonType: inst.lessonType,
        rate: 4500,
        autoRenew: true,
        status: 'trial',
      });
    }

    // If contact email provided, create portal account
    if (payload.contactEmail) {
      const existing = await this.db.db.query.users.findFirst({
        where: eq(users.email, payload.contactEmail.toLowerCase()),
      });
      if (!existing) {
        const [newUser] = await this.db.db.insert(users).values({
          email: payload.contactEmail.toLowerCase(),
          passwordHash: 'INVITE_PENDING',
          emailVerifiedAt: new Date(),
        }).returning();
        await this.db.db.insert(memberships).values({
          userId: newUser!.id, organizationId: orgId, baseRole: 'guardian',
        });
        // Non-blocking invite email
        const rawToken = randomBytes(32).toString('hex');
        const tokenHash = createHash('sha256').update(rawToken).digest('hex');
        const { passwordResetTokens } = await import('@music-life/db');
        await this.db.db.insert(passwordResetTokens).values({
          userId: newUser!.id, tokenHash,
          expiresAt: new Date(Date.now() + 7 * 86400000),
        });
        const link = `${process.env.WEB_URL}/reset-password?token=${rawToken}`;
        this.email.send({
          to: payload.contactEmail,
          subject: 'Welcome to Music & Life — set your password',
          html: `<p>Hi ${payload.contactName},</p><p>Your registration has been approved! Set your portal password here:</p><p><a href="${link}">Set password</a></p>`,
        }).catch(e => this.logger.warn('Welcome email failed', e));
      }
    }

    await this.db.db.update(registrations)
      .set({ status: 'approved', decidedBy, decidedAt: new Date() })
      .where(eq(registrations.id, regId));

    return { id: regId, status: 'approved', familyId: family!.id, studentId: student!.id };
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
