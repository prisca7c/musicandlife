'use client';

import { useState } from 'react';
import { useApi } from '@/lib/swr';
import { fmtTime, fmtDate } from '@/lib/datetime';
import { PageHeader } from '@/components/page-header';
import { InfoTooltip } from '@/components/info-tooltip';
import { Badge } from '@/components/badge';
import { Calendar } from 'lucide-react';

interface Lesson {
  id: string; startsAt: string; duration: number; status: string; isTrialLesson: boolean;
  student: { id: string; firstName: string; lastName: string } | null;
  teacher: { id: string; firstName: string; lastName: string } | null;
  enrollment: { instrument: string; lessonType: string } | null;
  attendance: { status: string } | null;
}

const STATUS_LABELS: Record<string, string> = {
  scheduled: 'Scheduled',
  completed: 'Attended',
  cancelled_makeup: 'Lesson earned',
  cancelled_no_makeup: 'Late cancel',
  cancelled_no_pay: 'No charge',
  cancelled_teacher: 'Teacher cancelled',
  makeup: 'Makeup lesson',
};

const STATUS_VARIANT: Record<string, string> = {
  completed: 'active',
  cancelled_makeup: 'warning',
  cancelled_no_makeup: 'error',
  cancelled_no_pay: 'default',
  cancelled_teacher: 'default',
  scheduled: 'info',
  makeup: 'active',
};

export default function FamilyHistoryPage() {
  const [from, setFrom] = useState(() => {
    const d = new Date(); d.setMonth(d.getMonth() - 3);
    return d.toISOString().split('T')[0]!;
  });
  const [to, setTo] = useState(() => new Date().toISOString().split('T')[0]!);

  // Cached read keyed on the date range — instant on revisit, revalidates in
  // the background. Newest lessons first.
  const { data: lessonsRaw = [] } = useApi<Lesson[]>(`/family/lessons?from=${from}&to=${to}`);
  const lessons = [...lessonsRaw].sort((a, b) => new Date(b.startsAt).getTime() - new Date(a.startsAt).getTime());

  const attended = lessons.filter(l => l.status === 'completed').length;
  const total = lessons.filter(l => l.status !== 'scheduled').length;

  return (
    <div>
      <PageHeader
        title={
          <span className="inline-flex items-center gap-2">
            Lesson history
            <InfoTooltip text="Every lesson your family has had, plus any cancellations. A 'makeup credit' is a missed lesson you're allowed to rebook later at no extra charge — it'll show here when one is owed to you." />
          </span>
        }
        subtitle="A record of all your family's lessons"
      />

      {/* Filters */}
      <div className="flex items-center gap-3 mb-6 flex-wrap">
        <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--txt3)' }}>
          <Calendar size={14} />
          <span>From</span>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)}
            className="border border-[var(--bd2)] rounded-xl px-3 py-1.5 text-sm focus:outline-none focus:border-[var(--sage)]" />
          <span>to</span>
          <input type="date" value={to} onChange={e => setTo(e.target.value)}
            className="border border-[var(--bd2)] rounded-xl px-3 py-1.5 text-sm focus:outline-none focus:border-[var(--sage)]" />
        </div>
        {total > 0 && (
          <p className="text-sm" style={{ color: 'var(--txt3)' }}>
            {attended}/{total} attended ({total > 0 ? Math.round((attended / total) * 100) : 0}%)
          </p>
        )}
      </div>

      {lessons.length === 0 ? (
        <div className="bg-white rounded-2xl border border-[var(--bd)] py-12 text-center">
          <p className="text-sm" style={{ color: 'var(--txt3)' }}>No lessons found in this period.</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--bd)' }}>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b" style={{ borderColor: 'var(--bd)', background: 'var(--surf)' }}>
                <th className="text-left px-4 py-3 font-bold text-xs uppercase tracking-widest" style={{ color: 'var(--txt3)' }}>Date</th>
                <th className="text-left px-4 py-3 font-bold text-xs uppercase tracking-widest" style={{ color: 'var(--txt3)' }}>Student</th>
                <th className="text-left px-4 py-3 font-bold text-xs uppercase tracking-widest" style={{ color: 'var(--txt3)' }}>Subject</th>
                <th className="text-left px-4 py-3 font-bold text-xs uppercase tracking-widest" style={{ color: 'var(--txt3)' }}>Teacher</th>
                <th className="text-left px-4 py-3 font-bold text-xs uppercase tracking-widest" style={{ color: 'var(--txt3)' }}>Duration</th>
                <th className="text-left px-4 py-3 font-bold text-xs uppercase tracking-widest" style={{ color: 'var(--txt3)' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {lessons.map((l, i) => (
                <tr key={l.id}
                  className="border-b last:border-0 hover:bg-[var(--surf)] transition-colors"
                  style={{ borderColor: 'var(--bd)', background: i % 2 === 0 ? undefined : 'var(--bg)' }}>
                  <td className="px-4 py-3 text-xs" style={{ color: 'var(--txt3)' }}>
                    {fmtDate(l.startsAt, { day: 'numeric', month: 'short', year: 'numeric' })}
                    <br />
                    <span>{fmtTime(l.startsAt)}</span>
                  </td>
                  <td className="px-4 py-3 font-medium" style={{ color: 'var(--txt)' }}>
                    {l.student?.firstName} {l.student?.lastName}
                    {l.isTrialLesson && <span className="ml-1.5 text-xs px-1.5 py-0.5 rounded bg-[var(--amber-lt)] text-[var(--amber)] font-semibold">trial</span>}
                  </td>
                  <td className="px-4 py-3 capitalize" style={{ color: 'var(--txt)' }}>
                    {l.enrollment?.instrument ?? '—'}
                    {l.enrollment?.lessonType === 'group' && <span className="ml-1 text-xs" style={{ color: 'var(--txt4)' }}>(group)</span>}
                  </td>
                  <td className="px-4 py-3" style={{ color: 'var(--txt3)' }}>
                    {l.teacher ? `${l.teacher.firstName} ${l.teacher.lastName}` : '—'}
                  </td>
                  <td className="px-4 py-3" style={{ color: 'var(--txt3)' }}>{l.duration} min</td>
                  <td className="px-4 py-3">
                    <Badge variant={STATUS_VARIANT[l.status] ?? 'default'}>
                      {STATUS_LABELS[l.status] ?? l.status}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
