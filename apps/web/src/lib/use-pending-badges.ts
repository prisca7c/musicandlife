'use client';

import { useApi } from './swr';
import { studioDayString } from './datetime';

interface LessonForBadge { startsAt: string; status: string; attendance: unknown | null; }

/**
 * Small counts shown as red badges on the Calendar/Attendance/Requests tab
 * strip: lessons happening today that still need attendance marked, and
 * lesson requests waiting on a decision. Each page in that section calls this
 * itself (SWR dedupes the underlying requests), so the badge stays accurate
 * without a shared top-level fetch.
 */
export function usePendingBadges() {
  const now = new Date();
  const today = studioDayString(now);
  const mon = new Date(`${today}T12:00:00`);
  mon.setDate(mon.getDate() - ((mon.getDay() + 6) % 7));
  const weekStart = studioDayString(mon);

  const { data: lessons = [] } = useApi<LessonForBadge[]>(`/lessons?weekStart=${weekStart}`);
  const { data: bookingReqs = [] } = useApi<{ id: string }[]>('/lesson-requests?status=pending');
  const { data: rescheduleReqs = [] } = useApi<{ id: string }[]>('/reschedule-requests?status=pending');

  const unmarkedToday = lessons.filter(
    l => l.status === 'scheduled' && !l.attendance && studioDayString(l.startsAt) === today,
  ).length;

  return { unmarkedToday, pendingRequests: bookingReqs.length + rescheduleReqs.length };
}
