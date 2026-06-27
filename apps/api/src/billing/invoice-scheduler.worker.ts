import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { eq, and } from 'drizzle-orm';
import { families, memberships } from '@music-life/db';
import { DbService } from '../db/db.service';
import { BillingService } from './billing.service';
import { NotificationsService } from '../notifications/notifications.service';
import { getRedisConnection } from '../common/redis-connection';

const PREVIEW_DAYS_AHEAD = 3;

// This month's (or next month's, if already passed) occurrence of `anchorDay`, shifted by
// `offsetDays`. Exported for unit testing without needing a real DB/Redis connection.
export function nextInvoiceDate(anchorDay: number, offsetDays: number, from: Date): Date {
  const day = Math.min(Math.max(anchorDay, 1), 28);
  const today = new Date(from.getFullYear(), from.getMonth(), from.getDate());

  let candidate = new Date(today.getFullYear(), today.getMonth(), day);
  candidate.setDate(candidate.getDate() + offsetDays);

  if (candidate < today) {
    candidate = new Date(today.getFullYear(), today.getMonth() + 1, day);
    candidate.setDate(candidate.getDate() + offsetDays);
  }
  return candidate;
}

// postpaid bills for the month just finished; prepaid bills ahead for the upcoming month.
export function resolveBillingPeriod(billingMode: 'prepaid' | 'postpaid', invoiceDate: Date): { periodStart: string; periodEnd: string } {
  const monthOffset = billingMode === 'postpaid' ? -1 : 0;
  const start = new Date(invoiceDate.getFullYear(), invoiceDate.getMonth() + monthOffset, 1);
  const end = new Date(invoiceDate.getFullYear(), invoiceDate.getMonth() + monthOffset + 1, 0);
  return { periodStart: start.toISOString().split('T')[0]!, periodEnd: end.toISOString().split('T')[0]! };
}

function daysBetween(a: Date, b: Date): number {
  const msPerDay = 86400000;
  const startOfA = new Date(a.getFullYear(), a.getMonth(), a.getDate());
  const startOfB = new Date(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((startOfA.getTime() - startOfB.getTime()) / msPerDay);
}

@Injectable()
export class InvoiceSchedulerWorker implements OnModuleInit {
  private readonly logger = new Logger(InvoiceSchedulerWorker.name);
  private queue?: Queue;

  constructor(
    private readonly db: DbService,
    private readonly billing: BillingService,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit() {
    // Mirrors RecurrenceWorker's opt-in guard — this writes real invoices (and can send real
    // emails) every run, so it must not fire just because the API process booted locally.
    if (process.env.INVOICE_SCHEDULER_ENABLED !== 'true') {
      this.logger.warn('INVOICE_SCHEDULER_ENABLED not set to "true" — auto-invoicing disabled');
      return;
    }

    const conn = getRedisConnection();
    if (!conn) {
      this.logger.warn('REDIS_URL not configured — auto-invoicing disabled');
      return;
    }

    try {
      this.queue = new Queue('invoice-scheduler', { connection: conn });

      this.queue.add('scan', {}, {
        repeat: { every: 86400000 },
        jobId: 'invoice-scheduler-scan',
      }).catch(() => {});

      new Worker('invoice-scheduler', async (job) => {
        if (job.name === 'scan') await this.scan();
      }, { connection: conn, concurrency: 1 });

      this.logger.log('Invoice scheduler worker started');
    } catch (err) {
      this.logger.warn(`Invoice scheduler worker failed to start: ${err}`);
    }
  }

  private async scan() {
    const now = new Date();
    const autoInvoiceFamilies = await this.db.db.query.families.findMany({
      where: eq(families.autoInvoice, true),
    });

    let generated = 0;
    const previewByOrg = new Map<string, typeof autoInvoiceFamilies>();

    for (const family of autoInvoiceFamilies) {
      const anchorDay = family.billingStartDate ? new Date(family.billingStartDate).getDate() : 1;
      const invoiceDate = nextInvoiceDate(anchorDay, family.invoiceDateOffsetDays, now);
      const daysUntil = daysBetween(invoiceDate, now);

      if (daysUntil === 0) {
        try {
          const { periodStart, periodEnd } = resolveBillingPeriod(family.billingMode, invoiceDate);
          const inv = await this.billing.createInvoice(family.organizationId, {
            familyId: family.id,
            mode: family.invoiceMode,
            periodStart,
            periodEnd,
          });
          generated++;

          if (family.autoEmailInvoice && family.email) {
            await this.billing.sendInvoice(family.organizationId, inv.id);
            await this.notifications.trigger('invoice.sent', {
              orgId: family.organizationId,
              email: family.email,
              body: `Invoice ${inv.number} for £${(inv.total / 100).toFixed(2)} is now available, due ${inv.dueDate}.`,
            });
          }
        } catch (err) {
          this.logger.warn(`Auto-invoice failed for family ${family.id}: ${err instanceof Error ? err.message : err}`);
        }
      } else if (daysUntil === PREVIEW_DAYS_AHEAD) {
        const list = previewByOrg.get(family.organizationId) ?? [];
        list.push(family);
        previewByOrg.set(family.organizationId, list);
      }
    }

    for (const [orgId, familiesDue] of previewByOrg) {
      await this.sendPreviewSummary(orgId, familiesDue).catch(err =>
        this.logger.warn(`Preview summary failed for org ${orgId}: ${err instanceof Error ? err.message : err}`),
      );
    }

    this.logger.log(`Invoice scheduler scan: ${generated} invoices generated, ${previewByOrg.size} org(s) previewed`);
  }

  private async sendPreviewSummary(orgId: string, familiesDue: { name: string }[]) {
    const admins = await this.db.db.query.memberships.findMany({
      where: and(eq(memberships.organizationId, orgId), eq(memberships.baseRole, 'admin')),
      with: { user: { columns: { email: true } } },
    });
    const adminEmails = admins.map(a => a.user?.email).filter((e): e is string => !!e);
    if (adminEmails.length === 0) return;

    const body = `<ul>${familiesDue.map(f => `<li>${f.name}</li>`).join('')}</ul>`;
    for (const email of adminEmails) {
      await this.notifications.trigger('invoice.preview_summary', {
        orgId, email,
        subject: `${familiesDue.length} invoice(s) going out in ${PREVIEW_DAYS_AHEAD} days`,
        body,
      });
    }
  }
}
