import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { eq, and, ne } from 'drizzle-orm';
import { families, memberships, invoices } from '@music-life/db';
import { DbService } from '../db/db.service';
import { BillingService } from './billing.service';
import { NotificationsService } from '../notifications/notifications.service';
import { withAdvisoryLock } from '../common/cron-lock';
import { getOrgTimezone } from '../common/timezone';

// "Today" as a calendar date IN the studio's timezone, not the server's. The
// cron fires once a day at 6am server-time (UTC on Render); for a studio
// whose zone is materially ahead of or behind UTC, that instant can already
// be a different local calendar day, shifting nextInvoiceDate's day-of-month
// comparison by one and firing an auto-invoice a day early or late.
function orgToday(now: Date, timeZone: string): Date {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const m: Record<string, string> = {};
  for (const p of parts) if (p.type !== 'literal') m[p.type] = p.value;
  return new Date(Number(m.year), Number(m.month) - 1, Number(m.day));
}

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

type CustomUnit = 'day' | 'week' | 'month' | 'year';

// Format a Date's LOCAL calendar day as YYYY-MM-DD. Deliberately not
// `.toISOString().split('T')[0]` — for a machine whose local zone is ahead of
// UTC (e.g. BST), that renders the *previous* day, the same trap this
// worker's orgToday() comment already documents for the cron's own clock.
// These date objects are constructed as local-midnight calendar dates (via
// addInterval/nextCustomInvoiceDate), so their local Y/M/D is the ground truth.
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addInterval(d: Date, value: number, unit: CustomUnit): Date {
  const next = new Date(d);
  if (unit === 'day') next.setDate(next.getDate() + value);
  else if (unit === 'week') next.setDate(next.getDate() + value * 7);
  else if (unit === 'month') next.setMonth(next.getMonth() + value);
  else next.setFullYear(next.getFullYear() + value);
  return next;
}

// Steps forward from `anchor` by whole `value`-`unit` intervals until reaching
// the first occurrence on or after `from` — the custom-cadence equivalent of
// nextInvoiceDate's "this or next monthly occurrence".
export function nextCustomInvoiceDate(anchor: Date, value: number, unit: CustomUnit, from: Date): Date {
  const step = Math.max(1, value);
  let candidate = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
  const today = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  if (candidate > today) return candidate;
  // Bounded loop: even a 1-day interval over a multi-year-old anchor is at
  // most a few thousand iterations, negligible for a once-a-day cron.
  while (candidate < today) candidate = addInterval(candidate, step, unit);
  return candidate;
}

// The period a custom-cadence invoice covers: one interval ending at (postpaid)
// or starting from (prepaid) the invoice date.
export function resolveCustomBillingPeriod(
  billingMode: 'prepaid' | 'postpaid', invoiceDate: Date, value: number, unit: CustomUnit,
): { periodStart: string; periodEnd: string } {
  const step = Math.max(1, value);
  if (billingMode === 'postpaid') {
    const start = addInterval(invoiceDate, -step, unit);
    const end = new Date(invoiceDate);
    end.setDate(end.getDate() - 1);
    return { periodStart: ymd(start), periodEnd: ymd(end) };
  }
  const end = addInterval(invoiceDate, step, unit);
  end.setDate(end.getDate() - 1);
  return { periodStart: ymd(invoiceDate), periodEnd: ymd(end) };
}

function daysBetween(a: Date, b: Date): number {
  const msPerDay = 86400000;
  const startOfA = new Date(a.getFullYear(), a.getMonth(), a.getDate());
  const startOfB = new Date(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((startOfA.getTime() - startOfB.getTime()) / msPerDay);
}

@Injectable()
export class InvoiceSchedulerWorker {
  private readonly logger = new Logger(InvoiceSchedulerWorker.name);
  private static readonly LOCK_KEY = 811003;

  constructor(
    private readonly db: DbService,
    private readonly billing: BillingService,
    private readonly notifications: NotificationsService,
  ) {}

  // Writes real invoices (and can send real emails) every run, so it stays
  // opt-in (INVOICE_SCHEDULER_ENABLED) and must not fire from a local `pnpm dev`.
  @Cron(CronExpression.EVERY_DAY_AT_6AM)
  async run() {
    if (process.env.INVOICE_SCHEDULER_ENABLED !== 'true') return;
    await withAdvisoryLock(this.db.db, InvoiceSchedulerWorker.LOCK_KEY, () => this.scan());
  }

  private async scan() {
    const now = new Date();
    const autoInvoiceFamilies = await this.db.db.query.families.findMany({
      where: eq(families.autoInvoice, true),
    });

    let generated = 0;
    const previewByOrg = new Map<string, typeof autoInvoiceFamilies>();

    for (const family of autoInvoiceFamilies) {
      const tz = await getOrgTimezone(this.db.db, family.organizationId);
      const today = orgToday(now, tz);

      // Custom cadence steps from the billing start date by the family's own
      // interval; monthly_statement/per_lesson both fire on a fixed monthly
      // anchor day regardless of content mode — that split predates this
      // feature and is unrelated to it.
      const isCustom = family.invoiceMode === 'custom' && family.customIntervalValue && family.customIntervalUnit;
      let invoiceDate: Date;
      if (isCustom) {
        const anchor = family.billingStartDate ? new Date(family.billingStartDate) : today;
        invoiceDate = nextCustomInvoiceDate(anchor, family.customIntervalValue!, family.customIntervalUnit as 'day' | 'week' | 'month' | 'year', today);
        invoiceDate.setDate(invoiceDate.getDate() + family.invoiceDateOffsetDays);
      } else {
        const anchorDay = family.billingStartDate ? new Date(family.billingStartDate).getDate() : 1;
        invoiceDate = nextInvoiceDate(anchorDay, family.invoiceDateOffsetDays, today);
      }
      const daysUntil = daysBetween(invoiceDate, today);

      if (daysUntil === 0) {
        try {
          const { periodStart, periodEnd } = isCustom
            ? resolveCustomBillingPeriod(family.billingMode, invoiceDate, family.customIntervalValue!, family.customIntervalUnit as 'day' | 'week' | 'month' | 'year')
            : resolveBillingPeriod(family.billingMode, invoiceDate);

          // Idempotency: never auto-generate a second invoice for a period this
          // family has already been billed for. The daily cron normally hits
          // daysUntil===0 on a single day, but a redeploy that replays a missed
          // job, a manual invocation, or any same-day re-entry lands here again;
          // the advisory lock only serialises *concurrent* runs, it does not
          // remember that this period was already invoiced. Without this guard a
          // family gets duplicate monthly statements. (A DB unique constraint is
          // deliberately NOT used: per-class invoicing legitimately produces
          // several invoices for the same family + period.)
          const existing = await this.db.db.query.invoices.findFirst({
            where: and(
              eq(invoices.organizationId, family.organizationId),
              eq(invoices.familyId, family.id),
              eq(invoices.periodStart, periodStart),
              eq(invoices.periodEnd, periodEnd),
              ne(invoices.status, 'void'),
            ),
            columns: { id: true },
          });
          if (existing) {
            this.logger.log(`Skipping ${family.id}: already invoiced for ${periodStart}–${periodEnd}`);
            continue;
          }

          const inv = await this.billing.createInvoice(family.organizationId, {
            familyId: family.id,
            // 'custom' is a scheduling cadence, not a distinct invoice content
            // type — it bills like a monthly_statement (an itemised statement
            // over the period), just on a different-length period.
            mode: family.invoiceMode === 'per_lesson' ? 'per_lesson' : 'monthly_statement',
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

  private async sendPreviewSummary(orgId: string, familiesDue: { name: string; contactName: string | null }[]) {
    const admins = await this.db.db.query.memberships.findMany({
      where: and(eq(memberships.organizationId, orgId), eq(memberships.baseRole, 'admin')),
      with: { user: { columns: { email: true } } },
    });
    const adminEmails = admins.map(a => a.user?.email).filter((e): e is string => !!e);
    if (adminEmails.length === 0) return;

    // Escape the family name before embedding — it is user-supplied (a parent
    // types familyName/contactName on the public registration form, or it comes
    // from a CSV import) and this summary body is rendered as HTML by the branded
    // email template (invoice.preview_summary embeds ctx.body raw). Without
    // escaping, a family named e.g. `<a href="…">click</a>` or a tracking pixel
    // renders live in the admin's inbox — stored HTML injection. Same class as
    // the message sender-name fix (#176).
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const body = `<ul>${familiesDue.map(f => `<li>${esc(f.contactName?.trim() || f.name)}</li>`).join('')}</ul>`;
    for (const email of adminEmails) {
      await this.notifications.trigger('invoice.preview_summary', {
        orgId, email,
        subject: `${familiesDue.length} invoice(s) going out in ${PREVIEW_DAYS_AHEAD} days`,
        body,
      });
    }
  }
}
