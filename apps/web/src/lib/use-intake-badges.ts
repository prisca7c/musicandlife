'use client';

import { useApi } from './swr';

interface RegForBadge { status: string; }
interface WaitingForBadge { id: string; }

/**
 * Counts for the red badges on the Students > Pending tab and its Sign-ups /
 * Waiting list sub-tabs. Each backing list is already server-filtered by
 * status (registrations?status=pending, students?status=waiting), so once a
 * sign-up is approved or a waiting student is promoted they drop out of the
 * count on their own — nothing here needs to separately "notice" the status
 * change. Enquiries (leads) aren't counted: those are prospects who haven't
 * signed up at all, not something waiting on a decision the same way.
 */
export function useIntakeBadges() {
  const { data: registrations = [] } = useApi<RegForBadge[]>('/registrations?status=pending');
  const { data: waitingData } = useApi<{ data: WaitingForBadge[] }>('/students?status=waiting&limit=200&offset=0');
  const signupsPending = registrations.length;
  const waitingList = waitingData?.data.length ?? 0;
  return { signupsPending, waitingList, total: signupsPending + waitingList };
}
