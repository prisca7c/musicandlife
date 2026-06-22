'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/badge';
import { Check, X, AlertTriangle, Calendar, RefreshCw } from 'lucide-react';

interface Lesson {
  id: string; startsAt: string; duration: number; status: string;
  student: { id: string; firstName: string; lastName: string } | null;
  teacher: { id: string; firstName: string; lastName: string } | null;
  attendance: { status: string } | null;
  enrollment: { instrument: string; lessonType: string } | null;
}

type AttendanceStatus = 'present' | 'absent_makeup' | 'absent_no_makeup' | 'absent_no_pay' | 'cancelled_teacher';

const PRIVATE_ACTIONS: { status: AttendanceStatus; label: string; color: string; bg: string; border: string }[] = [
  { status: 'present',          label: 'Present',           color: 'text-[var(--sage-dk)]',  bg: 'bg-[var(--sage-lt)]',  border: 'border-[var(--sage-md)]' },
  { status: 'absent_makeup',    label: 'Makeup (≥24h)',      color: 'text-[var(--amber)]',    bg: 'bg-[var(--amber-lt)]', border: 'border-[var(--amber-md)]' },
  { status: 'absent_no_makeup', label: 'No makeup (<24h)',   color: 'text-[var(--coral)]',    bg: 'bg-[var(--coral-lt)]', border: 'border-[var(--coral)]' },
  { status: 'absent_no_pay',    label: 'No class, no pay',   color: 'text-[var(--sky)]',      bg: 'bg-[var(--sky-lt)]',   border: 'border-[var(--sky-md)]' },
  { status: 'cancelled_teacher',label: 'Teacher cancel',     color: 'text-[var(--txt3)]',     bg: 'bg-[var(--surf)]',     border: 'border-[var(--bd2)]' },
];

const GROUP_ACTIONS: { status: AttendanceStatus; label: string; color: string; bg: string; border: string }[] = [
  { status: 'present',          label: 'Present',        color: 'text-[var(--sage-dk)]', bg: 'bg-[var(--sage-lt)]', border: 'border-[var(--sage-md)]' },
  { status: 'absent_no_pay',    label: 'Absent',         color: 'text-[var(--sky)]',     bg: 'bg-[var(--sky-lt)]',  border: 'border-[var(--sky-md)]' },
  { status: 'cancelled_teacher',label: 'Cancelled',      color: 'text-[var(--txt3)]',    bg: 'bg-[var(--surf)]',    border: 'border-[var(--bd2)]' },
];

export default function AttendancePage() {
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [pending, setPending] = useState<Record<string, AttendanceStatus>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [date, setDate] = useState(() => new Date().toISOString().split('T')[0]!);
  const tok = () => document.cookie.match(/access_token=([^;]+)/)?.[1];

  const mon = new Date(date);
  mon.setDate(mon.getDate() - ((mon.getDay() + 6) % 7));

  function load() {
    apiFetch<Lesson[]>(`/lessons?weekStart=${mon.toISOString().split('T')[0]}`, { token: tok() })
      .then(all => {
        const today = all.filter(l => l.startsAt.startsWith(date) && l.status === 'scheduled');
        setLessons(today);
        const defaults: Record<string, AttendanceStatus> = {};
        today.forEach(l => { if (!l.attendance) defaults[l.id] = 'present'; });
        setPending(defaults);
      })
      .catch(() => {});
  }

  useEffect(() => { load(); }, [date]);

  async function markOne(lessonId: string, status: AttendanceStatus) {
    setPending(p => ({ ...p, [lessonId]: status }));
    setSaving(lessonId);
    try {
      await apiFetch(`/lessons/${lessonId}/attendance`, {
        method: 'POST', token: tok(),
        body: JSON.stringify({ status }),
      });
      load();
    } catch (e) { console.error(e); }
    finally { setSaving(null); }
  }

  async function confirmAll() {
    setSaving('all');
    for (const lesson of lessons) {
      if (lesson.attendance) continue;
      const status = pending[lesson.id] ?? 'present';
      try {
        await apiFetch(`/lessons/${lesson.id}/attendance`, {
          method: 'POST', token: tok(),
          body: JSON.stringify({ status }),
        });
      } catch (e) { console.error(e); }
    }
    setSaving(null);
    load();
  }

  const unmarked = lessons.filter(l => !l.attendance);
  const marked = lessons.filter(l => l.attendance);

  return (
    <div>
      <PageHeader title="Attendance" subtitle="Quick-mark today's lessons" />

      <div className="flex items-center gap-3 mb-6 flex-wrap">
        <div className="flex items-center gap-2">
          <Calendar size={16} className="text-[var(--txt3)]" />
          <input type="date" value={date} onChange={e => setDate(e.target.value)}
            className="border-[1.5px] border-[var(--bd2)] rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[var(--sage)] focus:shadow-[0_0_0_3px_var(--sage-lt)]" />
        </div>
        {unmarked.length > 0 && (
          <button onClick={confirmAll} disabled={saving === 'all'}
            className="flex items-center gap-1.5 bg-[var(--sage)] text-white rounded-xl px-4 py-2 text-sm font-bold hover:bg-[var(--sage-dk)] disabled:opacity-50">
            <Check size={14} /> Confirm all as present ({unmarked.length})
          </button>
        )}
        <button onClick={load} className="flex items-center gap-1 text-sm border border-[var(--bd2)] rounded-xl px-3 py-2 hover:bg-[var(--surf)]">
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {lessons.length === 0 && (
        <div className="bg-white rounded-2xl border border-[var(--bd)] px-6 py-12 text-center">
          <p className="text-[var(--txt3)]">No scheduled lessons for {date}.</p>
          <Link href="/app/calendar" className="text-sm text-[var(--sage)] hover:underline mt-2 block">View calendar →</Link>
        </div>
      )}

      {unmarked.length > 0 && (
        <div className="mb-6">
          <p className="text-xs font-bold uppercase tracking-widest text-[var(--txt4)] mb-3 flex items-center gap-1.5">
            <AlertTriangle size={13} /> Needs marking ({unmarked.length})
          </p>
          <div className="space-y-2">
            {unmarked.map(l => {
              const isGroup = l.enrollment?.lessonType === 'group';
              const actions = isGroup ? GROUP_ACTIONS : PRIVATE_ACTIONS;
              const cur = pending[l.id] ?? 'present';
              return (
                <div key={l.id} className="bg-white rounded-2xl border border-[var(--bd)] p-4">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div>
                      <p className="font-semibold text-sm text-[var(--txt)]">
                        {new Date(l.startsAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                        {' · '}
                        {l.student?.firstName} {l.student?.lastName}
                      </p>
                      <p className="text-xs text-[var(--txt3)] mt-0.5">
                        {l.duration} min · {l.teacher?.firstName} {l.teacher?.lastName}
                        {isGroup && <span className="ml-1.5 text-[var(--amber)] font-medium">· Group</span>}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {actions.map(a => (
                        <button key={a.status} onClick={() => markOne(l.id, a.status)} disabled={saving === l.id}
                          className={`text-xs font-semibold px-3 py-1.5 rounded-lg border transition-all disabled:opacity-50
                            ${cur === a.status ? `${a.bg} ${a.border} ${a.color}` : 'border-[var(--bd2)] text-[var(--txt3)] hover:border-[var(--bd)] hover:bg-[var(--surf)]'}`}>
                          {a.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {marked.length > 0 && (
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-[var(--txt4)] mb-3 flex items-center gap-1.5">
            <Check size={13} /> Marked ({marked.length})
          </p>
          <div className="space-y-1.5">
            {marked.map(l => (
              <div key={l.id} className="bg-white rounded-xl border border-[var(--bd)] px-4 py-2.5 flex items-center justify-between opacity-70">
                <p className="text-sm text-[var(--txt)]">
                  {new Date(l.startsAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                  {' · '}
                  {l.student?.firstName} {l.student?.lastName}
                </p>
                <Badge variant={l.attendance?.status ?? 'default'}>
                  {l.attendance?.status?.replace(/_/g, ' ')}
                </Badge>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
