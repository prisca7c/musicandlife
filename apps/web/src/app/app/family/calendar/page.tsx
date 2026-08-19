'use client';

import { apiFetch } from '@/lib/api';
import { useApi } from '@/lib/swr';
import { FamilyCalendarView } from '@/components/family-calendar-view';

interface Feed {
  token: string;
  familyName: string;
  studentId: string | null;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export default function FamilyCalendarPage() {
  const { data: feed, mutate } = useApi<Feed>('/family/calendar');
  const url = feed
    ? `${API_URL}/public/calendar/${feed.token}.ics${feed.studentId ? `?student=${feed.studentId}` : ''}`
    : '';

  return (
    <FamilyCalendarView
      url={url}
      onRegenerate={async () => {
        await apiFetch('/family/calendar/regenerate', { method: 'POST' });
        await mutate();
      }}
    />
  );
}
