'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import { Badge } from '@/components/badge';
import { useRouter } from 'next/navigation';
import {
  Calendar, PoundSterling,
  ChevronRight, Users, UserCheck,
  Briefcase, TrendingUp, Music, Clock,
} from 'lucide-react';

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
  room: { name: string } | null;
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
  const [kpis, setKpis] = useState<KpiData | null>(null);
  const [todayLessons, setTodayLessons] = useState<Lesson[]>([]);
  const tok = () => document.cookie.match(/access_token=([^;]+)/)?.[1];

  useEffect(() => {
    const t = tok();
    const mon = new Date();
    mon.setDate(mon.getDate() - ((mon.getDay() + 6) % 7));
    mon.setHours(0, 0, 0, 0);
    Promise.all([
      apiFetch<KpiData>('/reports/dashboard', { token: t }).catch(() => null),
      apiFetch<Lesson[]>(`/lessons?weekStart=${mon.toISOString().split('T')[0]}`, { token: t }).catch(() => []),
    ]).then(([k, lessons]) => {
      setKpis(k);
      const today = new Date().toISOString().split('T')[0];
      setTodayLessons(
        (lessons as Lesson[])
          .filter(l => l.startsAt.startsWith(today!) && l.status === 'scheduled')
          .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())
      );
    });
  }, []);

  const now = new Date();
  const monthLabel = now.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  const breakdown = kpis?.instrumentBreakdown ?? [];
  const maxTotal = Math.max(...breakdown.map(r => r.total), 1);

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-[var(--txt)]">Dashboard</h1>
        {kpis?.activeTerm && (
          <div className="text-sm bg-[var(--sage-lt)] border border-[var(--sage-md)] rounded-xl px-3 py-1.5 flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--sage)] inline-block" />
            <span className="font-bold text-[var(--sage-dk)]">{kpis.activeTerm.name}</span>
            <span className="text-[var(--txt3)] text-xs">{kpis.activeTerm.startsOn} – {kpis.activeTerm.endsOn}</span>
          </div>
        )}
      </div>

      {/* Row 1 — snapshot (scoped to own students/lessons for teachers) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <StatCard label={kpis?.scoped ? 'My students' : 'Active students'} href="/app/students" icon={<UserCheck size={20} />}
          value={kpis?.students.active ?? '—'}
          sub={kpis?.students.trial ? `+ ${kpis.students.trial} on trial` : undefined} />
        {!kpis?.scoped && (
          <>
            <StatCard label="Families" href="/app/families" icon={<Users size={20} />}
              value={kpis?.families ?? '—'} />
            <StatCard label="Teaching staff" href="/app/staff" icon={<Briefcase size={20} />}
              value={kpis?.staff ?? '—'} sub="active" />
          </>
        )}
        <StatCard label="Lessons today" href="/app/calendar" icon={<Clock size={20} />}
          value={todayLessons.length}
          sub={todayLessons.length > 0 ? `next: ${new Date(todayLessons[0]!.startsAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : 'none scheduled'} />
      </div>

      {/* Row 2 — Activity (financials hidden for teachers) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="This week" href="/app/calendar" icon={<Calendar size={20} />} muted
          value={kpis?.weeklyLessons.total ?? '—'}
          sub={kpis ? `${kpis.weeklyLessons.completed} done · ${kpis.weeklyLessons.scheduled} ahead` : undefined} />
        <StatCard label={`Lessons — ${monthLabel}`} icon={<TrendingUp size={20} />} muted
          value={kpis?.lessons.totalThisMonth ?? '—'}
          sub={kpis ? `${kpis.lessons.completedThisMonth} completed` : undefined} />
        {!kpis?.scoped && (
          <>
            <StatCard label={`Revenue — ${monthLabel}`} href="/app/billing" icon={<PoundSterling size={20} />}
              value={kpis ? `£${(kpis.revenue.thisMonth / 100).toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}` : '—'} />
            <StatCard label="Outstanding" href="/app/billing" icon={<PoundSterling size={20} />}
              warn={(kpis?.invoices.outstandingTotal ?? 0) > 0}
              value={kpis ? `£${(kpis.invoices.outstandingTotal / 100).toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}` : '—'}
              sub={kpis?.invoices.outstandingCount ? `${kpis.invoices.outstandingCount} unpaid invoice${kpis.invoices.outstandingCount !== 1 ? 's' : ''}` : undefined} />
          </>
        )}
      </div>

      {/* Row 3 — Instrument breakdown + Today's lessons */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 mb-4">

        {/* Enrollment by instrument */}
        <div className="lg:col-span-2 bg-white rounded-2xl border border-[var(--bd)] overflow-hidden">
          <div className="px-5 py-3.5 border-b border-[var(--bd)] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Music size={16} style={{ color: 'var(--sage)' }} />
              <h2 className="font-bold text-[var(--txt)] text-sm">Enrolment by instrument</h2>
            </div>
            <Link href="/app/students" className="text-xs text-[var(--sage)] hover:underline font-medium">All students →</Link>
          </div>
          <div className="px-5 py-4 space-y-3">
            {breakdown.length === 0 && (
              <p className="text-sm text-[var(--txt4)] text-center py-4">No enrolment data yet.</p>
            )}
            {breakdown.map(row => (
              <div key={row.instrument}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-semibold capitalize" style={{ color: instrColour(row.instrument) }}>
                    {row.instrument}
                  </span>
                  <div className="flex items-center gap-2 text-[11px] text-[var(--txt4)]">
                    {row.private > 0 && <span>{row.private} private</span>}
                    {row.group > 0 && <span className="text-blue-500">{row.group} group</span>}
                    <span className="font-bold text-[var(--txt2)]">{row.total}</span>
                  </div>
                </div>
                <div className="h-2 bg-[var(--surf)] rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all"
                    style={{
                      width: `${(row.total / maxTotal) * 100}%`,
                      background: instrColour(row.instrument),
                    }} />
                </div>
              </div>
            ))}
          </div>
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
                    {['Time', 'Student', 'Instrument', 'Teacher', 'Min'].map(h => (
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
                          {new Date(l.startsAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
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
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
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
