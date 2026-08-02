import { BillingService, effectiveLessonAmount } from '../src/billing/billing.service';

// The invoice itemiser must bill each lesson at the SAME fee the attendance
// auto-charge already debited from the family's balance (effectiveLessonAmount).
// The bug: writeLessonLineItems prorated a GROUP class by its minutes, while the
// balance charge bills a group class at its flat set price. So whenever a group
// lesson's duration differed from the enrolment's default length, the statement
// line disagreed with the running balance — under-billing a short session and
// even splitting a bogus "extra time" line for an over-length one.

type Row = { lessonId: string; description: string; amount: number };

function makeService() {
  const inserted: Row[] = [];
  const db = {
    db: {
      insert: () => ({ values: (rows: Row[]) => { inserted.push(...rows); return Promise.resolve(); } }),
      update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
    },
  };
  const svc = new BillingService(db as never);
  return { svc, inserted };
}

function lesson(over: Partial<{ id: string; duration: number; isTrialLesson: boolean; enrollment: Record<string, unknown> }>) {
  return {
    id: 'l-1',
    duration: 60,
    isTrialLesson: false,
    startsAt: new Date(),
    enrollmentId: 'enr-1',
    ...over,
    enrollment: {
      instrument: 'piano',
      rate: 2000,
      trialRate: null,
      defaultDuration: 60,
      lessonType: 'private',
      ...(over.enrollment ?? {}),
    },
  };
}

async function write(svc: BillingService, eligible: unknown[]) {
  await (svc as unknown as {
    writeLessonLineItems: (o: string, i: string, e: unknown[]) => Promise<number>;
  }).writeLessonLineItems('org-1', 'inv-1', eligible);
}

describe('writeLessonLineItems — group flat rate matches the balance charge', () => {
  it('bills a short group session at the flat rate, not prorated', async () => {
    const { svc, inserted } = makeService();
    // Group class: flat £20, default 60 min, but this session ran 45 min.
    const l = lesson({ duration: 45, enrollment: { lessonType: 'group', rate: 2000, defaultDuration: 60 } });
    await write(svc, [l]);

    expect(inserted).toHaveLength(1);
    expect(inserted[0]!.amount).toBe(2000); // flat, NOT proratedAmount(2000,60,45)=1500
    // The line equals exactly what the attendance auto-charge posted.
    expect(inserted[0]!.amount).toBe(
      effectiveLessonAmount({ lessonType: 'group', rate: 2000, defaultDuration: 60, duration: 45 }),
    );
  });

  it('bills an over-length group session at the flat rate with no overrun split', async () => {
    const { svc, inserted } = makeService();
    const l = lesson({ duration: 90, enrollment: { lessonType: 'group', rate: 2000, defaultDuration: 60 } });
    await write(svc, [l]);

    expect(inserted).toHaveLength(1); // no "extra time" line for a flat-price class
    expect(inserted[0]!.amount).toBe(2000);
  });

  it('still prorates a short PRIVATE lesson', async () => {
    const { svc, inserted } = makeService();
    const l = lesson({ duration: 30 }); // private, default 60, £20
    await write(svc, [l]);

    expect(inserted).toHaveLength(1);
    expect(inserted[0]!.amount).toBe(1000); // half the rate
  });

  it('still splits an over-length PRIVATE lesson into base + extra summing to the prorated total', async () => {
    const { svc, inserted } = makeService();
    const l = lesson({ duration: 90 }); // private, default 60, £20 → prorated £30
    await write(svc, [l]);

    expect(inserted).toHaveLength(2);
    expect(inserted[0]!.amount).toBe(2000); // base rate
    expect(inserted[1]!.amount).toBe(1000); // extra 30 min
    const sum = inserted.reduce((s, r) => s + r.amount, 0);
    expect(sum).toBe(effectiveLessonAmount({ rate: 2000, defaultDuration: 60, duration: 90 }));
  });
});
