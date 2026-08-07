import { BadRequestException } from '@nestjs/common';
import { PayrollService } from '../src/payroll/payroll.service';

/**
 * Two status guards missing from payroll:
 *  1. createPayrollRun (the single-teacher path) never checked the teacher was
 *     active — createPayrollRunsForAll (the batch path) already filters to
 *     active staff, so the single-create was the only way to pay a departed
 *     teacher for lessons attributed after they left.
 *  2. approveExpense had no status guard, unlike decideRateChange's — an
 *     already-decided expense could be silently re-approved.
 */

function makeService(opts: {
  staff?: Record<string, unknown>;
  existingRun?: Record<string, unknown>;
  expense?: Record<string, unknown>;
} = {}) {
  const db = {
    db: {
      query: {
        staffMembers: { findFirst: async () => opts.staff },
        payrollRuns: { findFirst: async () => opts.existingRun },
        lessons: { findMany: async () => [] },
        expenses: { findFirst: async () => opts.expense },
      },
      insert: () => ({
        values: () => ({ onConflictDoNothing: () => ({ returning: async () => [{ id: 'run-1' }] }) }),
      }),
      update: () => ({
        set: (v: Record<string, unknown>) => ({ where: () => ({ returning: async () => [{ id: 'exp-1', ...v }] }) }),
      }),
    },
  };
  return new PayrollService(db as never);
}

describe('PayrollService.createPayrollRun — active-teacher guard', () => {
  it('refuses to create a run for an inactive teacher', async () => {
    const svc = makeService({ staff: { id: 'tea-1', hourlyRate: 3000, status: 'inactive' } });
    await expect(svc.createPayrollRun('org-1', {
      staffId: 'tea-1', periodStart: '2026-06-01', periodEnd: '2026-06-30',
    } as never)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('allows an active teacher', async () => {
    const svc = makeService({ staff: { id: 'tea-1', hourlyRate: 3000, status: 'active' } });
    await expect(svc.createPayrollRun('org-1', {
      staffId: 'tea-1', periodStart: '2026-06-01', periodEnd: '2026-06-30',
    } as never)).resolves.toMatchObject({ id: 'run-1' });
  });
});

describe('PayrollService.approveExpense — status guard', () => {
  it('refuses to re-approve an already-approved expense', async () => {
    const svc = makeService({ expense: { status: 'approved' } });
    await expect(svc.approveExpense('org-1', 'exp-1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('approves a pending expense', async () => {
    const svc = makeService({ expense: { status: 'pending' } });
    await expect(svc.approveExpense('org-1', 'exp-1')).resolves.toMatchObject({ status: 'approved' });
  });
});
