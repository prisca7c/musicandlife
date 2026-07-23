'use client';

import { useApi } from '@/lib/swr';
import { InfoTooltip } from '@/components/info-tooltip';
import { AlertTriangle } from 'lucide-react';

export interface AutomationFlags {
  recurringLessons: boolean;
  attendanceAutocomplete: boolean;
  lessonReminders: boolean;
  autoInvoicing: boolean;
}

/** Which background job a manual button duplicates. */
export type AutomatedBy = keyof AutomationFlags | 'signups' | 'bankMatching';

// What each job does, in the words a person at the front desk would use.
const JOBS: Record<AutomatedBy, { on: string; off?: string }> = {
  recurringLessons: {
    on: 'Weekly lessons are created for you every night from each student’s enrolment schedule, so you don’t normally need this.',
    off: 'Automatic lesson generation is currently switched OFF for this studio, so this button is the only thing creating these lessons. Ask your administrator to enable it.',
  },
  attendanceAutocomplete: {
    on: 'Lessons that came and went unmarked are marked present automatically overnight, so you don’t normally need this.',
    off: 'Automatic attendance is currently switched OFF, so nothing marks a lesson unless you do. That matters — unmarked lessons don’t charge the family or pay the teacher.',
  },
  lessonReminders: {
    on: 'Reminder emails go out automatically 24 hours before each lesson.',
  },
  signups: {
    on: 'Most students arrive here on their own: when a family completes the sign-up form and you approve it under New students, their record, enrolment and portal login are all created for you. This is only for someone who signs up in person.',
  },
  autoInvoicing: {
    on: 'Families with auto-invoicing switched on are invoiced on schedule, itemised from their lessons. This is only for a one-off or manual bill.',
    off: 'Scheduled invoicing is currently switched OFF for this studio, so no invoice goes out unless you raise it here — even for families set to auto-invoice. Ask your administrator to enable it.',
  },
  bankMatching: {
    on: 'Imported bank payments match themselves to a family by reference or amount. This is only for the ones that couldn’t be matched.',
  },
};

/**
 * The little ⓘ next to a manual button that duplicates something the system
 * already does on its own — so staff know it's there as a fallback, not a chore.
 *
 * Reads the studio's real automation flags: two of the three background jobs
 * are opt-in, and telling someone "this is automatic" when the job is switched
 * off would be worse than saying nothing. When a job is off, this shows a
 * warning instead of a reassurance.
 */
export function AutomatedHint({ by }: { by: AutomatedBy }) {
  const { data: org } = useApi<{ automation?: AutomationFlags }>('/organizations/me');

  const isWorkerFlag = by === 'recurringLessons' || by === 'attendanceAutocomplete'
    || by === 'lessonReminders' || by === 'autoInvoicing';
  // Assume on until we know otherwise, so the hint never flickers to a scary
  // warning while the request is in flight.
  const enabled = !isWorkerFlag || (org?.automation ? org.automation[by as keyof AutomationFlags] : true);

  const job = JOBS[by];
  if (!enabled && job.off) {
    return (
      <span className="inline-flex items-center" title={job.off}>
        <AlertTriangle size={13} className="text-[var(--amber)]" aria-label={job.off} />
      </span>
    );
  }
  return <InfoTooltip text={job.on} />;
}
