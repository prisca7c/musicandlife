import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { and, eq, desc } from 'drizzle-orm';
import { organizations, resources, resourceSubscribers } from '@music-life/db';
import { DbService } from '../db/db.service';
import { EmailPort } from '../email/ports/email.port';
import { FilesService } from '../files/files.service';
import { BillingService } from '../billing/billing.service';
import { brandedEmail } from '../email/branding';
import type { SubscribeDto } from './dto/subscribe.dto';

// The public library is a single-tenant offering, reached from unauthenticated
// pages that carry no org context — resolve the one studio by its slug, exactly
// as the public registration endpoints do.
const PUBLIC_ORG_SLUG = 'music-and-life';

@Injectable()
export class PublicLibraryService {
  constructor(
    private readonly db: DbService,
    private readonly email: EmailPort,
    private readonly files: FilesService,
    private readonly billing: BillingService,
  ) {}

  private today(): string {
    return new Date().toISOString().split('T')[0]!;
  }

  private accessLink(token: string): string {
    return `${process.env.WEB_URL}/library/view?token=${token}`;
  }

  private async publicOrg(): Promise<{ id: string; name: string }> {
    const org = await this.db.db.query.organizations.findFirst({
      where: eq(organizations.slug, PUBLIC_ORG_SLUG),
      columns: { id: true, name: true },
    });
    if (!org) throw new NotFoundException('Studio not found');
    return org;
  }

  // ─── Public: the offer shown on the subscribe page ──────────────────────────
  async getTerms() {
    const org = await this.publicOrg();
    const { price, months } = await this.billing.getResourceSubscriptionTerms(org.id);
    return { studioName: org.name, price, months };
  }

  // ─── Public: register interest in a subscription ────────────────────────────
  // Records the would-be subscriber as 'pending'. In production a payment
  // provider's success webhook would call activate(); until that's wired up a
  // member of staff confirms the payment and activates them by hand (mirroring
  // how the studio already honours bank-transfer payments elsewhere).
  async subscribe(dto: SubscribeDto) {
    const org = await this.publicOrg();
    const email = dto.email.trim().toLowerCase();

    const existing = await this.db.db.query.resourceSubscribers.findFirst({
      where: and(eq(resourceSubscribers.organizationId, org.id), eq(resourceSubscribers.email, email)),
    });

    // A genuinely active subscriber re-submitting shouldn't be knocked back to
    // pending — leave their access intact and just acknowledge. But "active" must
    // mean access they can actually use: a lapsed row keeps status='active' with
    // a past paidUntil (subscriberByToken rejects it), so keying off status alone
    // told a lapsed subscriber "active" while leaving them with no access AND no
    // pending record for staff to renew — they were stuck. Treat lapsed the same
    // as any other non-active state, exactly as list() computes true-active.
    if (existing) {
      const isTrulyActive =
        existing.status === 'active' && !!existing.paidUntil && existing.paidUntil >= this.today();
      if (!isTrulyActive) {
        await this.db.db.update(resourceSubscribers)
          .set({ status: 'pending', name: dto.name ?? existing.name, updatedAt: new Date() })
          .where(eq(resourceSubscribers.id, existing.id));
      }
      return { status: isTrulyActive ? 'active' : 'pending', email };
    }

    await this.db.db.insert(resourceSubscribers).values({
      organizationId: org.id,
      email,
      name: dto.name,
      accessToken: randomBytes(32).toString('hex'),
      status: 'pending',
    });
    return { status: 'pending', email };
  }

  // ─── Public: view the library with a magic-link token ───────────────────────
  private async subscriberByToken(token: string) {
    if (!token) throw new ForbiddenException('Access link is missing or invalid.');
    const sub = await this.db.db.query.resourceSubscribers.findFirst({
      where: eq(resourceSubscribers.accessToken, token),
    });
    // 403 for every failure mode (unknown token, cancelled, lapsed) so a probe
    // can't tell an expired subscriber from a made-up token.
    if (!sub || sub.status !== 'active') throw new ForbiddenException('This access link is no longer active.');
    if (!sub.paidUntil || sub.paidUntil < this.today()) {
      throw new ForbiddenException('Your subscription has lapsed. Please renew to regain access.');
    }
    return sub;
  }

  async getLibrary(token: string) {
    const sub = await this.subscriberByToken(token);
    // Public subscribers see the studio-wide library only — never teacher/family/
    // student-scoped material, which is internal and may name specific pupils.
    const items = await this.db.db.query.resources.findMany({
      where: and(eq(resources.organizationId, sub.organizationId), eq(resources.scope, 'studio')),
      columns: { id: true, title: true, description: true, type: true, url: true, delivery: true, instrument: true },
      with: { file: { columns: { id: true, mime: true, originalName: true } } },
      orderBy: (r) => [desc(r.createdAt)],
    });
    return {
      email: sub.email,
      paidUntil: sub.paidUntil,
      items: items.map(r => ({
        id: r.id, title: r.title, description: r.description, type: r.type,
        url: r.type === 'link' ? r.url : null,
        delivery: r.delivery, instrument: r.instrument,
        hasFile: r.type === 'file' && !!r.file,
        fileName: r.file?.originalName ?? null,
        mime: r.file?.mime ?? null,
      })),
    };
  }

  async signFile(token: string, resourceId: string) {
    const sub = await this.subscriberByToken(token);
    const resource = await this.db.db.query.resources.findFirst({
      where: and(eq(resources.id, resourceId), eq(resources.organizationId, sub.organizationId)),
      columns: { id: true, scope: true, type: true, fileId: true, delivery: true },
    });
    // Only studio-scope files are reachable here — the same gate as getLibrary, so
    // a subscriber can't sign a family/student file by guessing its id.
    if (!resource || resource.scope !== 'studio') throw new NotFoundException('Resource not found');
    if (resource.type !== 'file' || !resource.fileId) {
      throw new BadRequestException('This resource has no file to open.');
    }
    const disposition = resource.delivery === 'view_only' ? 'inline' : 'attachment';
    const signed = await this.files.signDownloadForOrg(resource.fileId, sub.organizationId, { disposition });
    return { url: signed.downloadUrl, delivery: resource.delivery, mime: signed.mime, name: signed.originalName };
  }

  // ─── Staff admin ────────────────────────────────────────────────────────────
  async list(orgId: string) {
    const rows = await this.db.db.query.resourceSubscribers.findMany({
      where: eq(resourceSubscribers.organizationId, orgId),
      columns: { id: true, email: true, name: true, status: true, paidUntil: true, accessToken: true, createdAt: true },
      orderBy: (s) => [desc(s.createdAt)],
    });
    const today = this.today();
    return rows.map(({ accessToken, ...s }) => ({
      ...s,
      // A row can be 'active' yet lapsed if the period ran out without renewal;
      // surface that so staff see who actually has access right now.
      active: s.status === 'active' && !!s.paidUntil && s.paidUntil >= today,
      // The shareable magic link, so staff can copy it to a subscriber whose
      // activation email bounced. Only exposed to staff (this route is guarded).
      accessLink: this.accessLink(accessToken),
    }));
  }

  // Grant (or extend) a paid period and email the magic access link. This is the
  // hook a payment provider's webhook would call; for now staff invoke it once
  // they've confirmed payment.
  async activate(orgId: string, subscriberId: string) {
    const sub = await this.db.db.query.resourceSubscribers.findFirst({
      where: and(eq(resourceSubscribers.id, subscriberId), eq(resourceSubscribers.organizationId, orgId)),
    });
    if (!sub) throw new NotFoundException('Subscriber not found');

    const { months } = await this.billing.getResourceSubscriptionTerms(orgId);
    // Extend from the later of today or the current expiry so renewing early
    // stacks time rather than throwing the remainder away.
    const today = this.today();
    const stillActive = sub.paidUntil && sub.paidUntil >= today;
    const base = stillActive ? new Date(sub.paidUntil!) : new Date(today);
    base.setMonth(base.getMonth() + months);
    const paidUntil = base.toISOString().split('T')[0]!;

    await this.db.db.update(resourceSubscribers)
      .set({ status: 'active', paidUntil, updatedAt: new Date() })
      .where(eq(resourceSubscribers.id, sub.id));

    const link = this.accessLink(sub.accessToken);
    // Best-effort: a paid-up subscriber must not be left without access just
    // because the mailer had a wobble. If the email fails we still activate them
    // and hand staff the link (returned below) so they can pass it on by hand.
    try {
      await this.email.send({
        to: sub.email,
        subject: 'Your resource library access is ready',
        html: brandedEmail({
          previewText: 'Open your Music & Life resource library',
          heading: 'You’re in 🎵',
          bodyHtml: `<p style="margin:0">Your access to the resource library is now active${
            sub.name ? `, ${sub.name.split(' ')[0]}` : ''
          }. Use the button below to browse sheet music, practice tracks and teaching videos — no login needed, just keep this link handy.</p>`,
          cta: { label: 'Open the library', url: link },
          footnote: `Access runs until ${paidUntil}. Bookmark the link — anyone with it can view your library.`,
        }),
      });
    } catch (err) {
      // Swallow — activation already committed. Staff see the link in the list.
      console.error(`[public-library] activation email to ${sub.email} failed`, err);
    }

    return { id: sub.id, status: 'active', paidUntil, accessLink: link };
  }

  // Revoke access immediately — for "I want to leave the list" or a staff removal.
  async cancel(orgId: string, subscriberId: string) {
    const [row] = await this.db.db.update(resourceSubscribers)
      .set({ status: 'canceled', paidUntil: null, updatedAt: new Date() })
      .where(and(eq(resourceSubscribers.id, subscriberId), eq(resourceSubscribers.organizationId, orgId)))
      .returning({ id: resourceSubscribers.id });
    if (!row) throw new NotFoundException('Subscriber not found');
    return { id: row.id, status: 'canceled' };
  }
}
