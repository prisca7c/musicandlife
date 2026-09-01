import { BillingService } from '../src/billing/billing.service';

/**
 * A draft invoice is just a draft — nothing has gone out, the family has never
 * seen it, and staff routinely build a few drafts to compare before picking
 * one to send. A lesson on a draft must stay eligible for a different draft;
 * only once an invoice is actually SENT (or PAID) does it become "this lesson
 * is spoken for." Without this, re-running Create Invoice for a period whose
 * lessons were already on an untouched draft silently came back empty —
 * indistinguishable from the feature being broken.
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

describe('BillingService.getEligibleLessons — a draft invoice does not block re-invoicing', () => {
  it('a lesson billed only on a DRAFT invoice is still eligible for another invoice', async () => {
    const svc = makeService({
      lessons: [{ id: 'les-draft', startsAt: new Date('2026-09-19T10:00:00Z') }],
      lineItems: [{ lessonId: 'les-draft', invoice: { status: 'draft' } }],
    });
    const eligible = await call(svc, ['stu-1']);
    expect(eligible.map(l => l.id)).toEqual(['les-draft']);
  });

  it('a lesson on a SENT invoice stays excluded — the family has already seen it billed', async () => {
    const svc = makeService({
      lessons: [{ id: 'les-sent', startsAt: new Date('2026-09-19T10:00:00Z') }],
      lineItems: [{ lessonId: 'les-sent', invoice: { status: 'sent' } }],
    });
    const eligible = await call(svc, ['stu-1']);
    expect(eligible).toEqual([]);
  });

  it('a lesson on a PAID invoice stays excluded', async () => {
    const svc = makeService({
      lessons: [{ id: 'les-paid', startsAt: new Date('2026-09-19T10:00:00Z') }],
      lineItems: [{ lessonId: 'les-paid', invoice: { status: 'paid' } }],
    });
    const eligible = await call(svc, ['stu-1']);
    expect(eligible).toEqual([]);
  });

  it('a lesson on a draft AND a sent invoice stays excluded (the sent one governs)', async () => {
    const svc = makeService({
      lessons: [{ id: 'les-both', startsAt: new Date('2026-09-19T10:00:00Z') }],
      lineItems: [
        { lessonId: 'les-both', invoice: { status: 'draft' } },
        { lessonId: 'les-both', invoice: { status: 'sent' } },
      ],
    });
    const eligible = await call(svc, ['stu-1']);
    expect(eligible).toEqual([]);
  });
});
