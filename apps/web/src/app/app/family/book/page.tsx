'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { formatMoney } from '@/lib/money';
import { useApi } from '@/lib/swr';
import { fmtTime, studioDayString } from '@/lib/datetime';
import { PageHeader } from '@/components/page-header';
import { InfoTooltip } from '@/components/info-tooltip';
import { SearchableSelect } from '@/components/searchable-select';
import { ChevronLeft, ChevronRight, Check, Loader2, Repeat, X } from 'lucide-react';

interface Teacher { id: string; firstName: string; lastName: string; instruments: string[]; defaultDuration: number; }
interface Enrollment { id: string; instrument: string; rate: number; teacherId: string | null; lessonType: string; status: string; defaultDuration: number; }
interface Student { id: string; firstName: string; lastName: string; status: string; enrollments: Enrollment[]; }
interface DashboardData { students: Student[]; }
interface RawSlot { startsAt: string; endsAt: string; }

// One available slot, tagged with the enrolment (and so the student + teacher +
// price) it belongs to — needed once several teachers/children are overlaid on
// one calendar.
interface Slot {
  startsAt: string;
  enrollmentId: string;
  studentId: string;
  studentName: string;
  teacherId: string;
  teacherName: string;
  instrument: string;
  duration: number;
  price: number;
}

const ALL = '__all__';
const LEAD_HOURS = 48;

// A small, colour-blind-friendly palette so each teacher reads as a distinct
// colour when more than one is shown at once.
const TEACHER_COLORS = ['#2f6f4f', '#8a5a2b', '#3b5b9a', '#7a3b8a', '#9a2b4b', '#2b7a7a'];

function weekMonday(date: Date) {
  const d = new Date(date);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  d.setHours(0, 0, 0, 0);
  return d;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export default function BookLessonPage() {
  const router = useRouter();
  const tok = () => document.cookie.match(/access_token=([^;]+)/)?.[1];

  const { data: teachers = [] } = useApi<Teacher[]>('/family/teachers');
  const { data: dashData } = useApi<DashboardData>('/family/dashboard');
  const students = useMemo(() => (dashData?.students as unknown as Student[]) ?? [], [dashData]);

  const [selectedStudent, setSelectedStudent] = useState('');
  const [teacherFilter, setTeacherFilter] = useState<string>(ALL);
  const [weekStart, setWeekStart] = useState(() => weekMonday(new Date()));
  const [isTrial, setIsTrial] = useState(false);
  const [recurring, setRecurring] = useState(false);
  // Ranked picks (1st = booked now, 2nd/3rd = fallbacks). All must belong to the
  // same enrolment — you book one lesson, not a mix of teachers.
  const [picks, setPicks] = useState<Slot[]>([]);
  const [booking, setBooking] = useState(false);
  const [done, setDone] = useState<{ recurring: boolean } | null>(null);

  // A one-child family (or a student logging in) shouldn't be asked to choose.
  const onlyStudentId = students.length === 1 ? students[0]!.id : null;
  useEffect(() => { if (onlyStudentId) setSelectedStudent(prev => prev || onlyStudentId); }, [onlyStudentId]);
  // Default multi-child parents to "All my children" so they see everything at once.
  useEffect(() => {
    if (students.length > 1 && !selectedStudent) setSelectedStudent(ALL);
  }, [students.length, selectedStudent]);

  const teacherName = (id: string | null) => {
    const t = teachers.find(x => x.id === id);
    return t ? `${t.firstName} ${t.lastName}` : 'Your teacher';
  };

  // Every bookable (student, enrolment) pair in the current scope. This is what
  // the calendar draws availability for.
  const scope = useMemo(() => {
    const chosen = selectedStudent === ALL ? students : students.filter(s => s.id === selectedStudent);
    const seen = new Set<string>();
    const out: { studentId: string; studentName: string; enrollmentId: string; instrument: string; rate: number; duration: number; teacherId: string }[] = [];
    for (const s of chosen) {
      for (const e of s.enrollments ?? []) {
        // Group classes meet at a fixed shared time — they aren't self-bookable
        // as individual slots, so keep them out of the picker entirely.
        if (!((e.status === 'active' || e.status === 'trial') && e.teacherId && e.lessonType !== 'group')) continue;
        // Collapse enrolments that would book the identical lesson — same child,
        // teacher, instrument (case-insensitive: "piano"/"Piano" are one thing),
        // length AND price. Anything that still differs (e.g. two piano rates) is
        // a real choice, so we keep it and disambiguate it by price below.
        const key = `${s.id}:${e.teacherId}:${e.instrument.trim().toLowerCase()}:${e.defaultDuration}:${e.rate}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
          studentId: s.id,
          studentName: `${s.firstName} ${s.lastName}`,
          enrollmentId: e.id,
          instrument: e.instrument,
          rate: e.rate,
          duration: e.defaultDuration,
          teacherId: e.teacherId as string,
        });
      }
    }
    return out;
  }, [selectedStudent, students]);

  // Distinct teachers in scope → the "see all / one at a time" filter.
  const scopeTeachers = useMemo(() => {
    const ids = [...new Set(scope.map(e => e.teacherId))];
    return ids.map((id, i) => ({ id, name: teacherName(id), color: TEACHER_COLORS[i % TEACHER_COLORS.length] }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, teachers]);
  const colorFor = (teacherId: string) => scopeTeachers.find(t => t.id === teacherId)?.color ?? TEACHER_COLORS[0];

  // If the current filter no longer matches anyone in scope, fall back to "all".
  useEffect(() => {
    if (teacherFilter !== ALL && !scopeTeachers.some(t => t.id === teacherFilter)) setTeacherFilter(ALL);
  }, [scopeTeachers, teacherFilter]);

  const activeEnrollments = useMemo(
    () => scope.filter(e => teacherFilter === ALL || e.teacherId === teacherFilter),
    [scope, teacherFilter],
  );

  // When more than one kind of lesson (a different instrument, or a different
  // child) shares the calendar, the time alone doesn't say which is which — so
  // we label each slot. multiChild adds the child's name on top of that.
  const instrKey = (studentId: string, instrument: string) => `${studentId}:${instrument.trim().toLowerCase()}`;
  const multiKind = useMemo(
    () => new Set(activeEnrollments.map(e => instrKey(e.studentId, e.instrument))).size > 1,
    [activeEnrollments],
  );
  const multiChild = useMemo(
    () => new Set(activeEnrollments.map(e => e.studentId)).size > 1,
    [activeEnrollments],
  );
  // Same child + same instrument but different prices (e.g. two piano rates) look
  // identical on the calendar — flag those so the slot shows its price to tell
  // them apart. Only kicks in on a genuine clash, so normal calendars stay clean.
  const priceAmbiguous = useMemo(() => {
    const rates = new Map<string, Set<number>>();
    for (const e of activeEnrollments) {
      const k = instrKey(e.studentId, e.instrument);
      (rates.get(k) ?? rates.set(k, new Set()).get(k)!).add(e.rate);
    }
    return new Set([...rates].filter(([, r]) => r.size > 1).map(([k]) => k));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeEnrollments]);

  // ── Fan-out availability: one call per enrolment in view, merged. SWR can't key
  //    a dynamic number of requests, so this loads them in parallel by hand. ──
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const ws = weekStart.toISOString().split('T')[0];
  const enrollFetchKey = activeEnrollments.map(e => `${e.enrollmentId}:${e.teacherId}:${e.duration}`).join('|');

  const reqSeq = useRef(0);
  useEffect(() => {
    if (activeEnrollments.length === 0) { setSlots([]); return; }
    const seq = ++reqSeq.current;
    setLoadingSlots(true);
    Promise.all(
      activeEnrollments.map(async (e) => {
        try {
          const raw = await apiFetch<RawSlot[]>(
            `/family/availability?teacherId=${e.teacherId}&weekStart=${ws}&duration=${e.duration}`,
            { token: tok() },
          );
          return (raw ?? []).map<Slot>(s => ({
            startsAt: s.startsAt,
            enrollmentId: e.enrollmentId,
            studentId: e.studentId,
            studentName: e.studentName,
            teacherId: e.teacherId,
            teacherName: teacherName(e.teacherId),
            instrument: e.instrument,
            duration: e.duration,
            price: e.rate,
          }));
        } catch { return []; }
      }),
    ).then(perEnrollment => {
      if (seq !== reqSeq.current) return; // a newer request superseded this one
      setSlots(perEnrollment.flat());
      setLoadingSlots(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enrollFetchKey, ws]);

  // Clear picks whenever the scope/week changes — stale picks would point at slots
  // no longer shown.
  useEffect(() => { setPicks([]); setRecurring(false); }, [enrollFetchKey, ws]);

  const lockedEnrollment = picks[0]?.enrollmentId ?? null;
  const cutoff = Date.now() + LEAD_HOURS * 3600000;
  const slotKey = (s: Slot) => `${s.enrollmentId}@${s.startsAt}`;
  const pickRank = (s: Slot) => picks.findIndex(p => slotKey(p) === slotKey(s));
  // A back-up that overlaps a time already picked is useless — the lesson can't
  // sit in two places at once, so the teacher could never move it there. (Easy
  // to hit with a 60-min lesson and 15-min slots: 09:30 falls inside 09:00.)
  const overlapsPick = (s: Slot) =>
    picks.some(p => p.enrollmentId === s.enrollmentId
      && slotKey(p) !== slotKey(s)
      && Math.abs(new Date(p.startsAt).getTime() - new Date(s.startsAt).getTime()) < s.duration * 60000);

  function toggleSlot(s: Slot) {
    const existing = pickRank(s);
    if (existing >= 0) { setPicks(picks.filter((_, i) => i !== existing)); return; }
    // Picks from a different enrolment start a fresh selection — one booking is
    // one teacher/instrument for one child.
    if (lockedEnrollment && s.enrollmentId !== lockedEnrollment) { setPicks([s]); return; }
    if (recurring) { setPicks([s]); return; }          // a series uses one weekly time
    if (picks.length >= 3) return;                      // 1st + two fallbacks max
    setPicks([...picks, s]);
  }

  // Build the 7-day week grid (Mon→Sun) with each day's slots sorted by time.
  const days = useMemo(() => {
    const byDay = new Map<string, Slot[]>();
    for (const s of slots) {
      const day = studioDayString(s.startsAt);
      (byDay.get(day) ?? byDay.set(day, []).get(day)!).push(s);
    }
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekStart.getTime() + i * 86400000);
      const key = studioDayString(d);
      const daySlots = (byDay.get(key) ?? []).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
      return { date: d, key, slots: daySlots };
    });
  }, [slots, weekStart]);

  async function book() {
    const first = picks[0];
    if (!first) return;
    setBooking(true);
    try {
      await apiFetch('/family/lessons', {
        method: 'POST', token: tok(),
        body: JSON.stringify({
          teacherId: first.teacherId,
          studentId: first.studentId,
          enrollmentId: first.enrollmentId,
          startsAt: first.startsAt,
          startsAt2: recurring ? undefined : picks[1]?.startsAt,
          startsAt3: recurring ? undefined : picks[2]?.startsAt,
          duration: first.duration,
          isTrialLesson: isTrial,
          recurring,
        }),
      });
      setDone({ recurring });
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Booking failed — that time may no longer be available.');
    } finally { setBooking(false); }
  }

  if (done) return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="w-16 h-16 rounded-full bg-[var(--sage-lt)] flex items-center justify-center mb-4">
        <Check size={32} className="text-[var(--sage-dk)]" />
      </div>
      <h2 className="text-xl font-black mb-2" style={{ color: 'var(--txt)' }}>
        {done.recurring ? 'Weekly lesson set up!' : 'Lesson booked!'}
      </h2>
      <p className="text-sm mb-6 max-w-md" style={{ color: 'var(--txt3)' }}>
        {done.recurring
          ? 'Your weekly lesson is now on the calendar. Your teacher will confirm it or suggest another time.'
          : 'Your first-choice time is booked. Your teacher will confirm it, or move it to one of your other choices if they need to.'}
      </p>
      <div className="flex gap-3">
        <button onClick={() => { setDone(null); setPicks([]); setRecurring(false); }}
          className="px-4 py-2 rounded-xl border border-[var(--bd2)] text-sm font-medium hover:bg-[var(--surf)]">
          Book another
        </button>
        <button onClick={() => router.push('/app/family/dashboard')}
          className="px-4 py-2 rounded-xl bg-[var(--sage)] text-white text-sm font-bold hover:bg-[var(--sage-dk)]">
          Go to dashboard
        </button>
      </div>
    </div>
  );

  const multiTeacher = scopeTeachers.length > 1;

  return (
    <div>
      <PageHeader
        title={
          <span className="inline-flex items-center gap-2">
            Book a lesson
            <InfoTooltip text="Pick your best time and up to two back-ups. Your first choice is booked straight away; your teacher confirms it or moves it to a back-up if that time doesn't work. You'll only ever see times the teacher is genuinely free." />
          </span>
        }
        subtitle="Choose who it's for, then tap your preferred times on the calendar"
      />

      {/* ── Controls: child + teacher filter ── */}
      <div className="flex flex-wrap items-center gap-3 mb-5">
        {students.length > 1 && (
          <div className="min-w-[220px]">
            <SearchableSelect
              options={[{ value: ALL, label: 'All my children' }, ...students.map(s => ({ value: s.id, label: `${s.firstName} ${s.lastName}` }))]}
              value={selectedStudent} onChange={v => setSelectedStudent(v)}
              placeholder="Select child…"
            />
          </div>
        )}

        {multiTeacher && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-semibold mr-1" style={{ color: 'var(--txt3)' }}>Teachers:</span>
            <button onClick={() => setTeacherFilter(ALL)}
              className="px-2.5 py-1 rounded-lg text-xs font-semibold border transition"
              style={teacherFilter === ALL
                ? { borderColor: 'var(--sage)', background: 'var(--sage-lt)', color: 'var(--sage-dk)' }
                : { borderColor: 'var(--bd2)', color: 'var(--txt3)' }}>
              See all
            </button>
            {scopeTeachers.map(t => (
              <button key={t.id} onClick={() => setTeacherFilter(t.id)}
                className="px-2.5 py-1 rounded-lg text-xs font-semibold border transition inline-flex items-center gap-1.5"
                style={teacherFilter === t.id
                  ? { borderColor: t.color, background: `${t.color}14`, color: t.color }
                  : { borderColor: 'var(--bd2)', color: 'var(--txt3)' }}>
                <span className="w-2 h-2 rounded-full" style={{ background: t.color }} />
                {t.name}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* ── Calendar ── */}
        <div className="lg:col-span-3">
          {scope.length === 0 ? (
            <div className="bg-white rounded-2xl border border-[var(--bd)] p-12 text-center">
              <p className="text-sm" style={{ color: 'var(--txt3)' }}>
                No bookable instruments yet. Please contact the studio to get set up.
              </p>
            </div>
          ) : (
            <div className="bg-white rounded-2xl border p-4 sm:p-5" style={{ borderColor: 'var(--bd)' }}>
              {/* Week nav */}
              <div className="flex items-center justify-between mb-4">
                <button onClick={() => setWeekStart(d => new Date(d.getTime() - 7 * 86400000))}
                  className="p-2 rounded-xl border border-[var(--bd2)] hover:bg-[var(--surf)]" aria-label="Previous week">
                  <ChevronLeft size={16} />
                </button>
                <p className="font-bold text-sm" style={{ color: 'var(--txt)' }}>
                  {weekStart.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })} –{' '}
                  {new Date(weekStart.getTime() + 6 * 86400000).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
                </p>
                <button onClick={() => setWeekStart(d => new Date(d.getTime() + 7 * 86400000))}
                  className="p-2 rounded-xl border border-[var(--bd2)] hover:bg-[var(--surf)]" aria-label="Next week">
                  <ChevronRight size={16} />
                </button>
              </div>

              {loadingSlots ? (
                <div className="py-16 text-center text-[var(--txt3)] text-sm flex items-center justify-center gap-2">
                  <Loader2 size={16} className="animate-spin" /> Loading times…
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
                  {days.map(({ date, key, slots: daySlots }) => {
                    const isToday = studioDayString(new Date()) === key;
                    return (
                      <div key={key} className="min-h-[120px]">
                        <div className="text-center mb-2">
                          <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--txt3)' }}>
                            {date.toLocaleDateString('en-GB', { weekday: 'short' })}
                          </p>
                          <p className="text-sm font-black" style={{ color: isToday ? 'var(--sage-dk)' : 'var(--txt)' }}>
                            {date.getDate()}
                          </p>
                        </div>
                        <div className="flex flex-col gap-1.5">
                          {daySlots.length === 0 ? (
                            <p className="text-[11px] text-center py-2" style={{ color: 'var(--txt4)' }}>—</p>
                          ) : daySlots.map(s => {
                            const rank = pickRank(s);
                            const picked = rank >= 0;
                            const tooSoon = new Date(s.startsAt).getTime() < cutoff;
                            const overlaps = !picked && overlapsPick(s);
                            const showPrice = priceAmbiguous.has(instrKey(s.studentId, s.instrument));
                            const showLabel = multiKind || showPrice;
                            const c = colorFor(s.teacherId);
                            return (
                              <button key={slotKey(s)} disabled={tooSoon || overlaps} onClick={() => toggleSlot(s)}
                                title={tooSoon
                                  ? `Online bookings need ${LEAD_HOURS}h notice — call the studio for sooner.`
                                  : overlaps
                                  ? 'Overlaps a time you’ve already picked.'
                                  : `${s.studentName} · ${cap(s.instrument)} · ${formatMoney(s.price)} · ${s.teacherName}`}
                                className="relative w-full rounded-lg text-xs font-semibold border py-1.5 px-1 transition disabled:opacity-35 disabled:cursor-not-allowed"
                                style={picked
                                  ? { borderColor: 'var(--sage)', background: 'var(--sage)', color: '#fff' }
                                  : { borderColor: 'var(--bd2)', color: 'var(--txt)' }}>
                                {multiTeacher && !picked && (
                                  <span className="absolute left-1 top-1 w-1.5 h-1.5 rounded-full" style={{ background: c }} />
                                )}
                                <span className="block leading-tight">
                                  {fmtTime(s.startsAt)}
                                  {picked && <span className="ml-1 text-[10px] font-black">#{rank + 1}</span>}
                                </span>
                                {showLabel && (
                                  <span className="block text-[9px] font-medium leading-tight truncate"
                                    style={{ color: picked ? 'rgba(255,255,255,0.85)' : 'var(--txt3)' }}>
                                    {cap(s.instrument)}
                                    {showPrice ? ` · ${formatMoney(s.price)}` : ''}
                                    {multiChild ? ` · ${s.studentName.split(' ')[0]}` : ''}
                                  </span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {!loadingSlots && slots.length === 0 && scope.length > 0 && (
                <p className="text-center text-sm mt-4" style={{ color: 'var(--txt3)' }}>
                  No available times this week. Try the next week →
                </p>
              )}
            </div>
          )}
        </div>

        {/* ── Selection / confirm ── */}
        <div className="space-y-4">
          <div className="bg-white rounded-2xl border p-5 sticky top-4" style={{ borderColor: 'var(--bd)' }}>
            <p className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: 'var(--txt3)' }}>Your choices</p>

            {picks.length === 0 ? (
              <p className="text-sm" style={{ color: 'var(--txt3)' }}>
                Tap a time on the calendar. Your <strong>1st</strong> choice is booked right away; add up to two back-ups your teacher can move it to.
              </p>
            ) : (
              <>
                <div className="mb-3 rounded-xl border px-3 py-2 text-sm" style={{ borderColor: 'var(--bd2)', background: 'var(--surf)' }}>
                  <p className="font-bold" style={{ color: 'var(--txt)' }}>{cap(picks[0]!.instrument)}</p>
                  <p className="text-xs" style={{ color: 'var(--txt3)' }}>
                    {picks[0]!.studentName} · {picks[0]!.teacherName} · {picks[0]!.duration} min · {formatMoney(picks[0]!.price)}
                  </p>
                </div>

                <ul className="space-y-1.5 mb-3">
                  {picks.map((p, i) => (
                    <li key={slotKey(p)} className="flex items-center justify-between gap-2 text-sm rounded-lg border px-2.5 py-1.5"
                      style={{ borderColor: i === 0 ? 'var(--sage-md)' : 'var(--bd2)' }}>
                      <span style={{ color: 'var(--txt)' }}>
                        <span className="font-black mr-1.5" style={{ color: 'var(--sage-dk)' }}>#{i + 1}</span>
                        {new Date(p.startsAt).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })} · {fmtTime(p.startsAt)}
                        {i === 0 && <span className="ml-1.5 text-[10px] font-bold uppercase" style={{ color: 'var(--sage-dk)' }}>booked now</span>}
                      </span>
                      <button onClick={() => setPicks(picks.filter((_, j) => j !== i))} className="text-[var(--txt4)] hover:text-[var(--txt)]" aria-label="Remove">
                        <X size={14} />
                      </button>
                    </li>
                  ))}
                </ul>

                <label className="flex items-center gap-2.5 text-sm cursor-pointer mb-2">
                  <input type="checkbox" checked={recurring}
                    // A weekly series and a one-off trial are mutually exclusive —
                    // turning one on turns the other off.
                    onChange={e => { setRecurring(e.target.checked); if (e.target.checked) { setPicks(p => p.slice(0, 1)); setIsTrial(false); } }}
                    className="rounded border-[var(--bd2)]" />
                  <span className="inline-flex items-center gap-1.5" style={{ color: 'var(--txt)' }}>
                    <Repeat size={13} /> Repeat weekly
                  </span>
                </label>
                {recurring && (
                  <p className="text-xs mb-2 rounded-lg px-2.5 py-1.5" style={{ background: 'var(--sage-lt)', color: 'var(--sage-dk)' }}>
                    Books this time every week — no need to rebook. Back-up times don&apos;t apply to a weekly series.
                  </p>
                )}

                {!recurring && (
                  <label className="flex items-center gap-2.5 text-sm cursor-pointer mb-3">
                    <input type="checkbox" checked={isTrial} onChange={e => setIsTrial(e.target.checked)} className="rounded border-[var(--bd2)]" />
                    <span style={{ color: 'var(--txt)' }}>This is a trial lesson</span>
                  </label>
                )}

                <button onClick={book} disabled={booking}
                  className="w-full bg-[var(--sage)] text-white font-bold text-sm py-2.5 rounded-xl hover:bg-[var(--sage-dk)] disabled:opacity-50 flex items-center justify-center gap-2">
                  {booking ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
                  {recurring ? 'Set up weekly lesson' : 'Book & send to teacher'}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
