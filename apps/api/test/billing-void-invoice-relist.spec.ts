import { BillingService } from '../src/billing/billing.service';

/**
 * Voiding an invoice reverses its charge but keeps its line items for history.
 * getEligibleLessons must therefore treat a lesson billed ONLY on a void invoice
 * as still un-billed — otherwise voiding an invoice to reissue it would leave
 * those lessons permanently un-billable and the corrected invoice empty. A
 * lesson on a live (non-void) invoice must stay excluded (no double-billing).
 */

function makeService(opts: {
  lessons: { id: string; startsAt: Date }[];
  lineItems: { lessonId: string; invoice: { status: string } }[];
}) {
  const db = {
    db: {
      query: {
        lessons: { findMany: async () => opts.lessons.map(l => ({ ...l, status: 'completed', enrollment: {}, teacher: {} })) },
        invoiceLineItems: { findMany: async () => opts.lineItems },
      },
    },
  };
  return new BillingService(db as never, { trigger: async () => {} } as never);
}

const call = (svc: BillingService, studentIds: string[]) =>
  (svc as never as {
    getEligibleLessons: (o: string, s: string[], ps?: string, pe?: string) => Promise<{ id: string }[]>;
  }).getEligibleLessons('org-1', studentIds);

describe('BillingService.getEligibleLessons — voided invoices re-list their lessons', () => {
  it('a lesson billed only on a VOID invoice is still eligible', async () => {
    const svc = makeService({
      lessons: [{ id: 'les-void', startsAt: new Date('2026-08-01T10:00:00Z') }],
      lineItems: [{ lessonId: 'les-void', invoice: { status: 'void' } }],
    });
    const eligible = await call(svc, ['stu-1']);
    expect(eligible.map(l => l.id)).toEqual(['les-void']);
  });

  it('a lesson on a live (sent) invoice stays excluded — no double-billing', async () => {
    const svc = makeService({
      lessons: [{ id: 'les-live', startsAt: new Date('2026-08-01T10:00:00Z') }],
      lineItems: [{ lessonId: 'les-live', invoice: { status: 'sent' } }],
    });
    const eligible = await call(svc, ['stu-1']);
    expect(eligible).toEqual([]);
  });

  it('a lesson on a void invoice AND a live invoice stays excluded (billed live)', async () => {
    const svc = makeService({
      lessons: [{ id: 'les-both', startsAt: new Date('2026-08-01T10:00:00Z') }],
      lineItems: [
        { lessonId: 'les-both', invoice: { status: 'void' } },
        { lessonId: 'les-both', invoice: { status: 'paid' } },
      ],
    });
    const eligible = await call(svc, ['stu-1']);
    expect(eligible).toEqual([]);
  });
});
