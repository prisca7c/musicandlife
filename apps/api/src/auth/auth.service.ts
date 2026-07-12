import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { hash, verify as argonVerify } from 'argon2';
import { eq, and, isNull, gt } from 'drizzle-orm';
import { randomBytes, createHash } from 'crypto';
import {
  users,
  memberships,
  sessions,
  refreshTokens,
  emailVerifications,
  passwordResetTokens,
  organizations,
  staffMembers,
  students,
  guardians,
  families,
} from '@music-life/db';
import type { JwtPayload, BaseRole } from '@music-life/types';
import { DbService } from '../db/db.service';
import { EmailPort } from '../email/ports/email.port';

const ACCESS_TTL = parseInt(process.env.JWT_ACCESS_TTL ?? '900', 10);
const REFRESH_TTL = parseInt(process.env.JWT_REFRESH_TTL ?? '2592000', 10);

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly db: DbService,
    private readonly jwt: JwtService,
    private readonly email: EmailPort,
  ) {}

  // ─── Register ────────────────────────────────────────────────────────────
  async register(emailAddr: string, password: string) {
    const existing = await this.db.db.query.users.findFirst({
      where: eq(users.email, emailAddr.toLowerCase()),
    });
    if (existing) throw new ConflictException('Email already registered');

    const passwordHash = await hash(password);
    const [user] = await this.db.db
      .insert(users)
      .values({ email: emailAddr.toLowerCase(), passwordHash })
      .returning();

    await this.sendVerificationEmail(user!.id, user!.email);

    return { message: 'Registered. Check your email to verify your account.' };
  }

  // ─── Login ────────────────────────────────────────────────────────────────
  async login(
    emailAddr: string,
    password: string,
    userAgent?: string,
    ip?: string,
  ) {
    const user = await this.db.db.query.users.findFirst({
      where: eq(users.email, emailAddr.toLowerCase()),
    });

    if (!user) throw new UnauthorizedException('Invalid credentials');
    if (user.status !== 'active') throw new UnauthorizedException('Account suspended');

    const valid = await argonVerify(user.passwordHash, password);
    if (!valid) throw new UnauthorizedException('Invalid credentials');

    if (!user.emailVerifiedAt) {
      throw new UnauthorizedException('Please verify your email before logging in');
    }

    const membership = await this.db.db.query.memberships.findFirst({
      where: and(
        eq(memberships.userId, user.id),
        eq(memberships.status, 'active'),
      ),
    });
    if (!membership) throw new UnauthorizedException('No active membership');

    return this.createTokens(user.id, membership.id, membership.organizationId, membership.baseRole as BaseRole, userAgent, ip);
  }

  // ─── Refresh ─────────────────────────────────────────────────────────────
  async refresh(rawToken: string) {
    const tokenHash = this.hashToken(rawToken);

    const token = await this.db.db.query.refreshTokens.findFirst({
      where: eq(refreshTokens.tokenHash, tokenHash),
    });

    if (!token) throw new UnauthorizedException('Invalid refresh token');
    if (token.revokedAt) throw new UnauthorizedException('Refresh token revoked');
    if (token.usedAt) {
      // Reuse detected — revoke whole session
      await this.revokeSession(token.sessionId);
      throw new UnauthorizedException('Refresh token reuse detected');
    }
    if (new Date() > token.expiresAt) throw new UnauthorizedException('Refresh token expired');

    await this.db.db
      .update(refreshTokens)
      .set({ usedAt: new Date() })
      .where(eq(refreshTokens.id, token.id));

    const membership = await this.db.db.query.memberships.findFirst({
      where: and(
        eq(memberships.userId, token.userId),
        eq(memberships.status, 'active'),
      ),
    });
    if (!membership) throw new UnauthorizedException('No active membership');

    return this.issueAccessAndRefresh(token.userId, membership.id, membership.organizationId, membership.baseRole as BaseRole, token.sessionId, token.id);
  }

  // ─── Logout ──────────────────────────────────────────────────────────────
  async logout(sessionId: string) {
    await this.revokeSession(sessionId);
  }

  // ─── Verify email ─────────────────────────────────────────────────────────
  async verifyEmail(rawToken: string) {
    const tokenHash = this.hashToken(rawToken);

    const record = await this.db.db.query.emailVerifications.findFirst({
      where: eq(emailVerifications.tokenHash, tokenHash),
    });

    if (!record || record.usedAt || new Date() > record.expiresAt) {
      throw new BadRequestException('Invalid or expired verification token');
    }

    await this.db.db
      .update(emailVerifications)
      .set({ usedAt: new Date() })
      .where(eq(emailVerifications.id, record.id));

    await this.db.db
      .update(users)
      .set({ emailVerifiedAt: new Date(), updatedAt: new Date() })
      .where(eq(users.id, record.userId));

    return { message: 'Email verified. You can now log in.' };
  }

  // ─── Request password reset ───────────────────────────────────────────────
  async requestReset(emailAddr: string) {
    const user = await this.db.db.query.users.findFirst({
      where: eq(users.email, emailAddr.toLowerCase()),
    });

    // Don't reveal whether the email exists
    if (!user) return { message: 'If that email is registered, a reset link has been sent.' };

    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(rawToken);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await this.db.db.insert(passwordResetTokens).values({
      userId: user.id,
      tokenHash,
      expiresAt,
    });

    const resetUrl = `${process.env.WEB_URL}/reset-password?token=${rawToken}`;
    // A mail-provider outage must not turn this into a 500 — that both breaks
    // the reset page and leaks which emails exist (a real email would error
    // while an unknown one returned the generic message). Swallow send failures
    // and always return the same generic response.
    try {
      await this.email.send({
        to: user.email,
        subject: 'Reset your Music & Life password',
        html: `<p>Click <a href="${resetUrl}">here</a> to reset your password. This link expires in 1 hour.</p>`,
      });
    } catch (err) {
      this.logger.warn(`Password reset email failed for ${user.email}: ${err}`);
    }

    return { message: 'If that email is registered, a reset link has been sent.' };
  }

  // ─── Reset password ───────────────────────────────────────────────────────
  async resetPassword(rawToken: string, newPassword: string) {
    const tokenHash = this.hashToken(rawToken);

    const record = await this.db.db.query.passwordResetTokens.findFirst({
      where: eq(passwordResetTokens.tokenHash, tokenHash),
    });

    if (!record || record.usedAt || new Date() > record.expiresAt) {
      throw new BadRequestException('Invalid or expired reset token');
    }

    const passwordHash = await hash(newPassword);

    await this.db.db
      .update(passwordResetTokens)
      .set({ usedAt: new Date() })
      .where(eq(passwordResetTokens.id, record.id));

    await this.db.db
      .update(users)
      .set({ passwordHash, updatedAt: new Date() })
      .where(eq(users.id, record.userId));

    // Revoke all sessions for this user
    await this.db.db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.userId, record.userId), isNull(sessions.revokedAt)));

    return { message: 'Password reset. Please log in with your new password.' };
  }

  // ─── Get current user (for /auth/me) ─────────────────────────────────────
  async getMe(userId: string, orgId: string) {
    const user = await this.db.db.query.users.findFirst({
      where: eq(users.id, userId),
    });
    if (!user) throw new UnauthorizedException();

    const membership = await this.db.db.query.memberships.findFirst({
      where: and(
        eq(memberships.userId, userId),
        eq(memberships.organizationId, orgId),
        eq(memberships.status, 'active'),
      ),
    });

    const org = await this.db.db.query.organizations.findFirst({
      where: eq(organizations.id, orgId),
    });

    const name = await this.resolveDisplayName(userId, orgId, user.email, membership?.baseRole);

    return {
      user: {
        id: user.id,
        email: user.email,
        emailVerified: !!user.emailVerifiedAt,
        name,
      },
      membership: membership
        ? { id: membership.id, role: membership.baseRole }
        : null,
      organization: org ? { id: org.id, name: org.name, slug: org.slug } : null,
    };
  }

  private async resolveDisplayName(
    userId: string,
    orgId: string,
    email: string,
    role?: string,
  ): Promise<string> {
    if (role === 'guardian') {
      const guardian = await this.db.db.query.guardians.findFirst({
        where: and(eq(guardians.userId, userId), eq(guardians.organizationId, orgId)),
        with: { family: { columns: { contactName: true, name: true } } },
      });
      if (guardian?.family?.contactName) return guardian.family.contactName;
      if (guardian?.family?.name) return guardian.family.name;
    } else if (role === 'student') {
      const student = await this.db.db.query.students.findFirst({
        where: and(eq(students.studentUserId, userId), eq(students.organizationId, orgId)),
      });
      if (student) return `${student.firstName} ${student.lastName}`;
    } else {
      const staff = await this.db.db.query.staffMembers.findFirst({
        where: and(eq(staffMembers.userId, userId), eq(staffMembers.organizationId, orgId)),
      });
      if (staff) return `${staff.firstName} ${staff.lastName}`;
    }

    const prefix = email.split('@')[0] ?? email;
    const cleaned = prefix.split(/[._-]/)[0] ?? prefix;
    return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private async createTokens(
    userId: string,
    membershipId: string,
    orgId: string,
    role: BaseRole,
    userAgent?: string,
    ip?: string,
  ) {
    const sessionToken = randomBytes(32).toString('hex');
    const sessionTokenHash = this.hashToken(sessionToken);
    const sessionExpiresAt = new Date(Date.now() + REFRESH_TTL * 1000);

    const [session] = await this.db.db
      .insert(sessions)
      .values({
        userId,
        tokenHash: sessionTokenHash,
        userAgent,
        ip,
        expiresAt: sessionExpiresAt,
      })
      .returning();

    return this.issueAccessAndRefresh(userId, membershipId, orgId, role, session!.id, null);
  }

  private async issueAccessAndRefresh(
    userId: string,
    membershipId: string,
    orgId: string,
    role: BaseRole,
    sessionId: string,
    rotatedFromId: string | null,
  ) {
    const payload: Omit<JwtPayload, 'iat' | 'exp'> = {
      sub: userId,
      sessionId,
      orgId,
      membershipId,
      role,
    };

    const accessToken = await this.jwt.signAsync(payload, {
      expiresIn: ACCESS_TTL,
    });

    const rawRefresh = randomBytes(32).toString('hex');
    const refreshTokenHash = this.hashToken(rawRefresh);
    const refreshExpiresAt = new Date(Date.now() + REFRESH_TTL * 1000);

    await this.db.db.insert(refreshTokens).values({
      sessionId,
      userId,
      tokenHash: refreshTokenHash,
      rotatedFromId: rotatedFromId ?? undefined,
      expiresAt: refreshExpiresAt,
    });

    return { accessToken, refreshToken: rawRefresh };
  }

  private async revokeSession(sessionId: string) {
    await this.db.db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(eq(sessions.id, sessionId));

    await this.db.db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(
        and(eq(refreshTokens.sessionId, sessionId), isNull(refreshTokens.revokedAt)),
      );
  }

  private async sendVerificationEmail(userId: string, emailAddr: string) {
    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(rawToken);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    await this.db.db.insert(emailVerifications).values({
      userId,
      tokenHash,
      expiresAt,
    });

    const verifyUrl = `${process.env.WEB_URL}/verify?token=${rawToken}`;
    await this.email.send({
      to: emailAddr,
      subject: 'Verify your Music & Life account',
      html: `<p>Welcome! Click <a href="${verifyUrl}">here</a> to verify your email. This link expires in 24 hours.</p>`,
    });
  }

  private hashToken(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }
}
