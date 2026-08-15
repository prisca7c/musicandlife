'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import { useApi } from '@/lib/swr';
import { useMe } from '@/lib/use-me';
import { fmtTime, studioDayString } from '@/lib/datetime';
import { Badge } from '@/components/badge';
import { PaidDot } from '@/components/paid-dot';
import { AvailabilityWeekGrid, type AvailWindow } from '@/components/availability-week-grid';
import { linkify } from '@/lib/linkify';
import { useRouter } from 'next/navigation';
import {
  Calendar, PoundSterling,
  ChevronRight, UserCheck,
  Clock, Megaphone, Inbox, ChevronDown, Check,
} from 'lucide-react';

type AttendanceStatus = 'present' | 'absent_makeup' | 'absent_no_makeup' | 'absent_no_pay' | 'cancelled_teacher';

// Same set of outcomes as the full Attendance page — labelled by what happens
// to the money, since that's what marking a lesson actually does.
const QUICK_ACTIONS: { status: AttendanceStatus; label: string }[] = [
  { status: 'present',           label: 'Present' },
  { status: 'absent_makeup',     label: 'Cancelled ≥24h — no charge, rebook' },
  { status: 'absent_no_makeup',  label: 'Cancelled <24h — charged' },
  { status: 'absent_no_pay',     label: 'Absent — no charge' },
  { status: 'cancelled_teacher', label: 'Teacher cancelled' },
];

// A small "take attendance right here" menu on each dashboard lesson row, so
// marking a lesson doesn't require a trip to the full Attendance page for the
// common case of just marking it present.
function QuickAttendanceMenu({ lessonId, onMarked }: { lessonId: string; onMarked: (status: AttendanceStatus) => void }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const tok = () => document.cookie.match(/access_token=([^;]+)/)?.[1];

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  async function mark(status: AttendanceStatus) {
    setSaving(true); setOpen(false); setError('');
    try {
      await apiFetch(`/lessons/${lessonId}/attendance`, { method: 'POST', token: tok(), body: JSON.stringify({ status }) });
      onMarked(status);
    } catch (e) {
      // Leave the row as-is — the full Attendance page shows the real state.
      setError(e instanceof Error ? e.message : 'Could not mark attendance');
    }
    finally { setSaving(false); }
  }

  return (
    <div ref={ref} className="relative inline-block">
      <button
        onClick={() => setOpen(o => !o)}
        disabled={saving}
        title={error || undefined}
        className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-md border hover:bg-[var(--sage-lt)] disabled:opacity-50"
        style={error
          ? { borderColor: 'var(--coral)', color: 'var(--coral)' }
          : { borderColor: 'var(--sage-md)', color: 'var(--sage-dk)' }}
      >
        {saving ? 'Saving…' : error ? 'Couldn’t mark' : 'Attendance'} <ChevronDown size={12} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-56 rounded-xl border bg-white shadow-lg overflow-hidden z-30"
          style={{ borderColor: 'var(--bd)' }}>
          {QUICK_ACTIONS.map(a => (
            <button key={a.status} onClick={() => mark(a.status)}
              className="w-full text-left px-3.5 py-2 text-xs font-medium hover:bg-[var(--sage-lt)] transition-colors flex items-center gap-1.5"
              style={{ color: 'var(--txt2)' }}>
              {a.status === 'present' && <Check size={12} style={{ color: 'var(--sage)' }} />}
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

interface NewsPost { id: string; title: string; body: string; publishedAt: string; }

interface LessonRequest {
  id: string; status: string; createdAt: string;
  student: { firstName: string; lastName: string } | null;
  teacher: { firstName: string; lastName: string } | null;
  enrollment: { instrument: string } | null;
}

function getRoleFromCookie(): string {
  try {
    const token = document.cookie.match(/access_token=([^;]+)/)?.[1];
    if (!token) return 'admin';
    const payload = JSON.parse(atob(token.split('.')[1]!));
    return payload.role ?? 'admin';
  } catch { return 'admin'; }
}

interface InstrumentRow { instrument: string; private: number; group: number; total: number; }

interface KpiData {
  scoped?: boolean;
  students: { active: number; trial: number; total: number };
  families: number;
  staff: number;
  lessons: { completedThisMonth: number; scheduledThisMonth: number; totalThisMonth: number };
  weeklyLessons: { scheduled: number; completed: number; total: number };
  revenue: { thisMonth: number };
  invoices: { outstandingTotal: number; outstandingCount: number };
  activeTerm: { name: string; startsOn: string; endsOn: string } | null;
  instrumentBreakdown: InstrumentRow[];
}

interface Lesson {
  id: string; startsAt: string; duration: number; status: string;
  student: { firstName: string; lastName: string } | null;
  teacher: { firstName: string; lastName: string } | null;
  enrollment: { instrument: string; lessonType: string } | null;
}

// ─── Instrument icon colours ──────────────────────────────────────────────────
const INSTR_COLOURS: Record<string, string> = {
  piano:    '#3D7A55', violin:  '#2B6CB0', guitar:  '#B7791F',
  drums:    '#C05621', cello:   '#6B46C1', viola:   '#2C7A7B',
  'bass guitar': '#276749', vocal: '#97266D', ukulele: '#D69E2E',
  'suzuki violin': '#2B6CB0', ensemble: '#718096',
};
function instrColour(name: string) {
  return INSTR_COLOURS[name.toLowerCase()] ?? '#4A5568';
}

// ─── Stat card ────────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, href, icon, warn = false, muted = false }: {
  label: string; value: React.ReactNode; sub?: string;
  href?: string; icon: React.ReactNode; warn?: boolean; muted?: boolean;
}) {
  const inner = (
    <div className={`bg-white rounded-2xl border p-5 flex items-start gap-4 transition-all hover:shadow-sm
      ${warn ? 'border-[var(--coral-lt)]' : 'border-[var(--bd)]'}`}>
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0
        ${warn ? 'bg-[var(--coral-lt)]' : muted ? 'bg-[var(--surf)]' : 'bg-[var(--sage-lt)]'}`}>
        <span style={{ color: warn ? 'var(--coral)' : muted ? 'var(--txt3)' : 'var(--sage)' }}>{icon}</span>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[11px] font-bold text-[var(--txt4)] uppercase tracking-[0.08em]">{label}</p>
        <p className={`text-2xl font-bold mt-0.5 leading-none
          ${warn ? 'text-[var(--coral)]' : muted ? 'text-[var(--txt3)]' : 'text-[var(--txt)]'}`}>
          {value}
        </p>
        {sub && <p className="text-[11px] text-[var(--txt4)] mt-1 leading-tight">{sub}</p>}
      </div>
      {href && <ChevronRight size={16} className="shrink-0 mt-1" style={{ color: 'var(--txt4)' }} />}
    </div>
  );
  return href ? <Link href={href} className="block">{inner}</Link> : inner;
}

// ─── Admin dashboard ──────────────────────────────────────────────────────────
function AdminDashboard() {
  // Monday of the current week (studio weeks start Monday). Render the fetch
  // bound as the STUDIO-zone day, not `.toISOString()` (which is UTC): under BST
  // (local = UTC+1) local-midnight Monday is 23:00Z Sunday, so toISOString rolled
  // weekStart back to Sunday — the same trap the calendar page already fixed.
  const mon = new Date();
  mon.setDate(mon.getDate() - ((mon.getDay() + 6) % 7));
  mon.setHours(0, 0, 0, 0);
  const weekStart = studioDayString(mon);

  // Each read is cached on its API path — the whole dashboard renders instantly
  // on revisit, then revalidates in the background.
  const { data: newsRaw = [] } = useApi<NewsPost[]>('/news');
  const news = newsRaw.slice(0, 3);
  // Teachers get their own availability grid; non-teachers get an empty list.
  const { data: myAvailability = [] } = useApi<AvailWindow[]>('/staff/me/availability');
  const { data: kpis } = useApi<KpiData>('/reports/dashboard');
  const { data: lessons = [], mutate: mutateLessons } = useApi<Lesson[]>(`/lessons?weekStart=${weekStart}`);
  // Marking attendance moves a lesson off "scheduled" — drop it from the local
  // cache immediately rather than waiting on a refetch, so the row disappears
  // from "Today's lessons" (which only shows still-scheduled lessons) right away.
  function onLessonMarked(lessonId: string) {
    mutateLessons(prev => prev?.filter(l => l.id !== lessonId), { revalidate: false });
  }
  const { data: pendingRequests = [] } = useApi<LessonRequest[]>('/lesson-requests?status=pending');
  const { firstName } = useMe();

  // "Today" in the studio zone (matches how the calendar buckets lessons), and
  // compare each lesson's studio day too — a lesson stored as 23:30Z belongs to
  // the next studio day under BST, so a UTC-prefix startsWith would misfile it.
  const today = studioDayString(new Date());
  const todayLessons = lessons
    .filter(l => studioDayString(l.startsAt) === today && l.status === 'scheduled')
    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());

  const now = new Date();
  const monthLabel = now.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--txt)]">
            {(() => {
              const h = new Date().getHours();
              const part = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
              return firstName ? `${part}, ${firstName}` : part;
            })()}
          </h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--txt3)' }}>Here&apos;s what&apos;s happening at your studio today.</p>
        </div>
        {kpis?.activeTerm && (
          <div className="text-sm bg-[var(--sage-lt)] border border-[var(--sage-md)] rounded-xl px-3 py-1.5 flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--sage)] inline-block" />
            <span className="font-bold text-[var(--sage-dk)]">{kpis.activeTerm.name}</span>
            <span className="text-[var(--txt3)] text-xs">{kpis.activeTerm.startsOn} – {kpis.activeTerm.endsOn}</span>
          </div>
        )}
      </div>

      {/* Snapshot row — trimmed to what's actually acted on day to day.
          Lessons-today/this-week/month counts, Families, and Teaching staff
          were dropped: the "Today's lessons" list below already shows the
          real schedule, and a raw count of families/staff isn't something
          anyone checks on the way past. Financials stay admin-only. */}
      <div className={`grid grid-cols-1 ${kpis?.scoped ? 'sm:grid-cols-1' : 'sm:grid-cols-3'} gap-4 mb-6`}>
        <StatCard label={kpis?.scoped ? 'My students' : 'Active students'} href="/app/students" icon={<UserCheck size={20} />}
          value={kpis?.students.active ?? '—'}
          sub={kpis?.students.trial ? `+ ${kpis.students.trial} on trial` : undefined} />
        {!kpis?.scoped && (
          <>
            <StatCard label={`Revenue — ${monthLabel}`} href="/app/billing" icon={<PoundSterling size={20} />}
              value={kpis ? `£${(kpis.revenue.thisMonth / 100).toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}` : '—'} />
            <StatCard label="Outstanding" href="/app/billing" icon={<PoundSterling size={20} />}
              warn={(kpis?.invoices.outstandingTotal ?? 0) > 0}
              value={
                <span className="inline-flex items-center gap-2">
                  {kpis ? `£${(kpis.invoices.outstandingTotal / 100).toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}` : '—'}
                  {kpis && <PaidDot paid={kpis.invoices.outstandingTotal === 0} title={kpis.invoices.outstandingTotal === 0 ? 'All invoices paid' : 'Money outstanding across the studio'} />}
                </span>
              }
              sub={kpis?.invoices.outstandingCount ? `${kpis.invoices.outstandingCount} unpaid invoice${kpis.invoices.outstandingCount !== 1 ? 's' : ''}` : undefined} />
          </>
        )}
      </div>

      {/* Row 3 — Pending requests + Today's lessons */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 mb-4">

        {/* Pending lesson requests — reschedules/bookings waiting on someone's
            decision, easy to lose track of once they're not the page you're on. */}
        <div className="lg:col-span-2 bg-white rounded-2xl border border-[var(--bd)] overflow-hidden flex flex-col">
          <div className="px-5 py-3.5 border-b border-[var(--bd)] flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
              <Inbox size={16} style={{ color: 'var(--sage)' }} />
              <h2 className="font-bold text-[var(--txt)] text-sm">Requests</h2>
              {pendingRequests.length > 0 && (
                <span className="text-[11px] font-bold bg-[var(--sage-lt)] text-[var(--sage)] rounded-full px-2 py-0.5">
                  {pendingRequests.length}
                </span>
              )}
            </div>
            <Link href="/app/lesson-requests" className="text-xs text-[var(--sage)] hover:underline font-medium">All requests →</Link>
          </div>
          {pendingRequests.length === 0 ? (
            <div className="flex-1 flex items-center justify-center py-10 text-[var(--txt4)] text-sm">
              No pending requests.
            </div>
          ) : (
            <div className="px-5 py-4 space-y-3 overflow-auto">
              {pendingRequests.slice(0, 6).map(r => (
                <Link key={r.id} href="/app/lesson-requests" className="flex items-center justify-between gap-3 group">
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold truncate group-hover:underline" style={{ color: 'var(--txt)' }}>
                      {r.student ? `${r.student.firstName} ${r.student.lastName}` : 'Unassigned student'}
                    </span>
                    <span className="block text-xs truncate" style={{ color: 'var(--txt4)' }}>
                      {r.enrollment?.instrument ? `${r.enrollment.instrument} · ` : ''}
                      {r.teacher ? `${r.teacher.firstName} ${r.teacher.lastName}` : 'No teacher'}
                    </span>
                  </span>
                  <span className="text-[10px] font-bold uppercase shrink-0 px-1.5 py-0.5 rounded-full"
                    style={{
                      background: r.status === 'counter_proposed' ? 'var(--surf)' : 'var(--sage-lt)',
                      color: r.status === 'counter_proposed' ? 'var(--txt3)' : 'var(--sage-dk)',
                    }}>
                    {r.status === 'counter_proposed' ? 'Countered' : 'Pending'}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Today's lessons */}
        <div className="lg:col-span-3 bg-white rounded-2xl border border-[var(--bd)] overflow-hidden flex flex-col">
          <div className="px-5 py-3.5 border-b border-[var(--bd)] flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
              <Calendar size={16} style={{ color: 'var(--sage)' }} />
              <h2 className="font-bold text-[var(--txt)] text-sm">Today&apos;s lessons</h2>
              {todayLessons.length > 0 && (
                <span className="text-[11px] font-bold bg-[var(--sage-lt)] text-[var(--sage)] rounded-full px-2 py-0.5">
                  {todayLessons.length}
                </span>
              )}
            </div>
            <Link href="/app/calendar" className="text-xs text-[var(--sage)] hover:underline font-medium">Calendar →</Link>
          </div>

          {todayLessons.length === 0 ? (
            <div className="flex-1 flex items-center justify-center py-10 text-[var(--txt4)] text-sm">
              No lessons scheduled for today.
            </div>
          ) : (
            <div className="overflow-auto flex-1">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-[var(--surf)] border-b border-[var(--bd)]">
                  <tr>
                    {['Time', 'Student', 'Instrument', 'Teacher', 'Min', ''].map(h => (
                      <th key={h} className="text-left px-4 py-2.5 text-[11px] font-bold text-[var(--txt3)] uppercase tracking-wide whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--bd)]">
                  {todayLessons.map(l => {
                    const instr = l.enrollment?.instrument;
                    const isGroup = l.enrollment?.lessonType === 'group';
                    return (
                      <tr key={l.id} className="hover:bg-[var(--surf)]">
                        <td className="px-4 py-2.5 font-bold text-[var(--sage)] whitespace-nowrap tabular-nums">
                          {fmtTime(l.startsAt)}
                        </td>
                        <td className="px-4 py-2.5 font-medium">{l.student?.firstName} {l.student?.lastName}</td>
                        <td className="px-4 py-2.5">
                          {instr ? (
                            <span className="flex items-center gap-1.5">
                              <span className="capitalize text-[13px]" style={{ color: instrColour(instr) }}>{instr}</span>
                              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${isGroup ? 'bg-blue-50 text-blue-600' : 'bg-[var(--sage-lt)] text-[var(--sage)]'}`}>
                                {isGroup ? 'Group' : 'Private'}
                              </span>
                            </span>
                          ) : <span className="text-[var(--txt4)]">—</span>}
                        </td>
                        <td className="px-4 py-2.5 text-[var(--txt3)]">
                          {l.teacher ? `${l.teacher.firstName} ${l.teacher.lastName}` : '—'}
                        </td>
                        <td className="px-4 py-2.5 text-[var(--txt4)] tabular-nums">{l.duration}</td>
                        <td className="px-4 py-2.5 text-right">
                          <QuickAttendanceMenu lessonId={l.id} onMarked={() => onLessonMarked(l.id)} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* My availability — teachers only */}
      {kpis?.scoped && myAvailability.length > 0 && (
        <div className="bg-white rounded-2xl border border-[var(--bd)] overflow-hidden mb-4">
          <div className="px-5 py-3.5 border-b border-[var(--bd)] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clock size={16} style={{ color: 'var(--sage)' }} />
              <h2 className="font-bold text-[var(--txt)] text-sm">My weekly availability</h2>
            </div>
            <Link href="/app/availability" className="text-xs text-[var(--sage)] hover:underline font-medium">Edit →</Link>
          </div>
          <div className="px-5 py-4">
            <AvailabilityWeekGrid windows={myAvailability} />
          </div>
        </div>
      )}

      {/* Row 4 — Studio News */}
      {news.length > 0 && (
        <div className="bg-white rounded-2xl border border-[var(--bd)] overflow-hidden">
          <div className="px-5 py-3.5 border-b border-[var(--bd)] flex items-center gap-2">
            <Megaphone size={16} style={{ color: 'var(--sage)' }} />
            <h2 className="font-bold text-[var(--txt)] text-sm">Studio News</h2>
          </div>
          <div className="px-5 py-4 space-y-3">
            {news.map(n => (
              <div key={n.id}>
                <p className="text-sm font-bold" style={{ color: 'var(--txt)' }}>{n.title}</p>
                <p className="text-sm leading-relaxed line-clamp-2" style={{ color: 'var(--txt3)' }}>{linkify(n.body)}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const [role, setRole] = useState('');
  useEffect(() => {
    const r = getRoleFromCookie();
    setRole(r);
    if (r === 'guardian' || r === 'student') router.replace('/app/family/dashboard');
  }, [router]);
  if (!role || role === 'guardian' || role === 'student') return null;
  return <AdminDashboard />;
}
