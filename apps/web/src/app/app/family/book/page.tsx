'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { formatMoney } from '@/lib/money';
import { useApi } from '@/lib/swr';
import { fmtTime, fmtDate, studioDayString } from '@/lib/datetime';
import { PageHeader } from '@/components/page-header';
import { InfoTooltip } from '@/components/info-tooltip';
import { SearchableSelect } from '@/components/searchable-select';
import { ChevronLeft, ChevronRight, Check, Loader2, Repeat, X } from 'lucide-react';

interface Teacher { id: string; firstName: string; lastName: string; instruments: string[]; defaultDuration: number; }
interface Enrollment { id: string; instrument: string; rate: number; teacherId: string | null; lessonType: string; status: string; defaultDuration: number; }
interface Student { id: string; firstName: string; lastName: string; status: string; enrollments: Enrollment[]; }
interface DashboardData { students: Student[]; }
interface RawSlot { startsAt: string; endsAt: string; }

// One thing the studio has actually set the family up for: a specific child
// taking a specific instrument with a specific teacher.
interface Assignment {
  enrollmentId: string;
  studentId: string;
  studentName: string;
  teacherId: string;
  instrument: string;
  duration: number;
  price: number;
}

// One real open slot on a teacher's calendar. Availability is teacher+time
// only — a teacher is free at 4pm or they aren't, independent of what
// they'll be teaching then — so a slot is tagged with every assignment it
// could be booked against, not a single fixed instrument.
interface Slot {
  startsAt: string;
  teacherId: string;
  teacherName: string;
  duration: number;
  candidates: Assignment[];
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
  const [recurring, setRecurring] = useState(false);
  // Optional last date for a recurring series (studio-local YYYY-MM-DD); '' = open-ended.
  const [recurringEnd, setRecurringEnd] = useState('');
  // Ranked time picks (1st = booked now, 2nd/3rd = fallbacks). All must belong
  // to the same teacher+duration calendar — you book one lesson at one length,
  // not a mix of teachers or lesson lengths.
  const [picks, setPicks] = useState<Slot[]>([]);
  // Which assignment (child + instrument) the current picks are for. Set
  // automatically when a slot has only one possible assignment; the family
  // checks one explicitly when the same real time could serve more than one
  // of their assignments with that teacher (e.g. two instruments, same length).
  const [chosenEnrollmentId, setChosenEnrollmentId] = useState<string | null>(null);
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

  // Every bookable assignment in the current scope.
  const assignments = useMemo(() => {
    const chosen = selectedStudent === ALL ? students : students.filter(s => s.id === selectedStudent);
    const seen = new Set<string>();
    const out: Assignment[] = [];
    for (const s of chosen) {
      for (const e of s.enrollments ?? []) {
        // Group classes meet at a fixed shared time — they aren't self-bookable
        // as individual slots, so keep them out of the picker entirely.
        if (!((e.status === 'active' || e.status === 'trial') && e.teacherId && e.lessonType !== 'group')) continue;
        // Collapse enrolments that would book the identical lesson — same child,
        // teacher, instrument (case-insensitive: "piano"/"Piano" are one thing),
        // length AND price. Anything that still differs (e.g. two piano rates) is
        // a real choice, so we keep it and disambiguate it in the assignment picker.
        const key = `${s.id}:${e.teacherId}:${e.instrument.trim().toLowerCase()}:${e.defaultDuration}:${e.rate}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
          enrollmentId: e.id,
          studentId: s.id,
          studentName: `${s.firstName} ${s.lastName}`,
          teacherId: e.teacherId as string,
          instrument: e.instrument,
          duration: e.defaultDuration,
          price: e.rate,
        });
      }
    }
    return out;
  }, [selectedStudent, students]);

  // Distinct teachers in scope → the "see all / one at a time" filter.
  const scopeTeachers = useMemo(() => {
    const ids = [...new Set(assignments.map(a => a.teacherId))];
    return ids.map((id, i) => ({ id, name: teacherName(id), color: TEACHER_COLORS[i % TEACHER_COLORS.length] }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignments, teachers]);
  const colorFor = (teacherId: string) => scopeTeachers.find(t => t.id === teacherId)?.color ?? TEACHER_COLORS[0];

  // If the current filter no longer matches anyone in scope, fall back to "all".
  useEffect(() => {
    if (teacherFilter !== ALL && !scopeTeachers.some(t => t.id === teacherFilter)) setTeacherFilter(ALL);
  }, [scopeTeachers, teacherFilter]);

  const activeAssignments = useMemo(
    () => assignments.filter(a => teacherFilter === ALL || a.teacherId === teacherFilter),
    [assignments, teacherFilter],
  );

  const multiChild = useMemo(
    () => new Set(activeAssignments.map(a => a.studentId)).size > 1,
    [activeAssignments],
  );

  // ── Distinct (teacher, duration) calendars to fetch. This is the fix: a
  //    teacher's real open slots are fetched once per lesson length, never
  //    once per instrument, so the same true time slot can't appear twice
  //    fighting to look like two different bookable things. ──
  const calendars = useMemo(() => {
    const seen = new Map<string, { teacherId: string; duration: number }>();
    for (const a of activeAssignments) {
      const key = `${a.teacherId}:${a.duration}`;
      if (!seen.has(key)) seen.set(key, { teacherId: a.teacherId, duration: a.duration });
    }
    return [...seen.values()];
  }, [activeAssignments]);
  const calendarFetchKey = calendars.map(c => `${c.teacherId}:${c.duration}`).join('|');

  const [slots, setSlots] = useState<Slot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  // The week's start date to fetch, as the STUDIO-zone day of the grid's first
  // column. weekStart is local midnight Monday; `.toISOString()` would render it
  // in UTC, which under BST (local = UTC+1) rolls back to Sunday — so the API
  // fetched [Sun..Sat] while the grid drew [Mon..Sun], leaving the Sunday column
  // permanently empty every summer (no Sunday slots bookable) and fetching a
  // phantom prior Sunday. studioDayString matches the grid's day-0 key exactly.
  const ws = studioDayString(weekStart);

  const reqSeq = useRef(0);
  useEffect(() => {
    if (calendars.length === 0) { setSlots([]); return; }
    const seq = ++reqSeq.current;
    setLoadingSlots(true);
    Promise.all(
      calendars.map(async (c) => {
        try {
          const raw = await apiFetch<RawSlot[]>(
            `/family/availability?teacherId=${c.teacherId}&weekStart=${ws}&duration=${c.duration}`,
            { token: tok() },
          );
          const candidates = activeAssignments.filter(a => a.teacherId === c.teacherId && a.duration === c.duration);
          return (raw ?? []).map<Slot>(s => ({
            startsAt: s.startsAt,
            teacherId: c.teacherId,
            teacherName: teacherName(c.teacherId),
            duration: c.duration,
            candidates,
          }));
        } catch { return []; }
      }),
    ).then(perCalendar => {
      if (seq !== reqSeq.current) return; // a newer request superseded this one
      setSlots(perCalendar.flat());
      setLoadingSlots(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calendarFetchKey, ws]);

  // Clear picks whenever the scope/week changes — stale picks would point at slots
  // no longer shown.
  useEffect(() => { setPicks([]); setChosenEnrollmentId(null); setRecurring(false); setRecurringEnd(''); }, [calendarFetchKey, ws]);

  const lockedCalendar = picks[0] ? `${picks[0].teacherId}:${picks[0].duration}` : null;
  const cutoff = Date.now() + LEAD_HOURS * 3600000;
  const slotKey = (s: Slot) => `${s.teacherId}:${s.duration}@${s.startsAt}`;
  const pickRank = (s: Slot) => picks.findIndex(p => slotKey(p) === slotKey(s));

  // Every assignment the current picks could be booked against.
  const currentCandidates = picks[0]?.candidates ?? [];
  const currentPickKey = picks[0] ? slotKey(picks[0]) : null;
  useEffect(() => {
    // Auto-choose when there's only one possibility; otherwise wait for the
    // family to check one (and clear a stale choice that no longer applies).
    if (currentCandidates.length === 1) { setChosenEnrollmentId(currentCandidates[0]!.enrollmentId); return; }
    setChosenEnrollmentId(prev => (currentCandidates.some(c => c.enrollmentId === prev) ? prev : null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPickKey]);

  function toggleSlot(s: Slot) {
    const existing = pickRank(s);
    if (existing >= 0) { setPicks(picks.filter((_, i) => i !== existing)); return; }
    // A pick from a different teacher/duration calendar starts a fresh
    // selection — one booking is one teacher at one lesson length.
    const cal = `${s.teacherId}:${s.duration}`;
    if (lockedCalendar && cal !== lockedCalendar) { setPicks([s]); return; }
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

  const chosen = currentCandidates.find(c => c.enrollmentId === chosenEnrollmentId) ?? null;

  async function book() {
    const first = picks[0];
    if (!first || !chosen) return;
    if (recurring && !confirm(`Set up a weekly lesson with ${first.teacherName} every ${fmtDate(first.startsAt, { weekday: 'long' })} at ${fmtTime(first.startsAt)}${recurringEnd ? ` until ${recurringEnd}` : ', with no end date'}? This books an ongoing series, not a one-off lesson.`)) return;
    setBooking(true);
    try {
      await apiFetch('/family/lessons', {
        method: 'POST', token: tok(),
        body: JSON.stringify({
          teacherId: first.teacherId,
          studentId: chosen.studentId,
          enrollmentId: chosen.enrollmentId,
          startsAt: first.startsAt,
          startsAt2: recurring ? undefined : picks[1]?.startsAt,
          startsAt3: recurring ? undefined : picks[2]?.startsAt,
          duration: first.duration,
          recurring,
          recurringEndDate: recurring && recurringEnd ? recurringEnd : undefined,
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
        <button onClick={() => { setDone(null); setPicks([]); setChosenEnrollmentId(null); setRecurring(false); setRecurringEnd(''); }}
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

        {/* Single teacher in scope: no filter chips needed, but the parent still
            needs to see who they're booking with — previously this was only in
            a hover tooltip on each slot, invisible until you moused over one. */}
        {!multiTeacher && scopeTeachers.length === 1 && (
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold" style={{ color: 'var(--txt3)' }}>
            <span className="w-2 h-2 rounded-full" style={{ background: scopeTeachers[0]!.color }} />
            with {scopeTeachers[0]!.name}
          </span>
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
          {assignments.length === 0 ? (
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
                  {/* Same studio-zone-anchored rendering as the day columns below —
                      weekStart is browser-local midnight, which the raw Date read
                      out via toLocaleDateString (no timeZone) instead of `days[]`'s
                      studio-zone keys. */}
                  {new Date(`${days[0]!.key}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' })} –{' '}
                  {new Date(`${days[6]!.key}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })}
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
                  {days.map(({ key, slots: daySlots }) => {
                    const isToday = studioDayString(new Date()) === key;
                    // The column's label must agree with `key` (the studio-zone
                    // day its slots were grouped by), not the browser's local
                    // reading of a raw Date. `date.toLocaleDateString(...)` with
                    // no timeZone reads the BROWSER's zone: a tester whose device
                    // isn't set to the studio's zone could see a column labelled
                    // "Sat" actually populated with a neighbouring studio-zone
                    // day's slots (and vice versa) — indistinguishable from the
                    // teacher's real Saturday/Sunday hours being swapped. Deriving
                    // the label from `key` itself (via a UTC-noon anchor, the same
                    // technique the backend uses to turn a date into a weekday)
                    // makes the label zone-independent and always correct.
                    const anchor = new Date(`${key}T12:00:00Z`);
                    return (
                      <div key={key} className="min-h-[120px]">
                        <div className="text-center mb-2">
                          <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--txt3)' }}>
                            {anchor.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' })}
                          </p>
                          <p className="text-sm font-black" style={{ color: isToday ? 'var(--sage-dk)' : 'var(--txt)' }}>
                            {Number(key.slice(8, 10))}
                          </p>
                        </div>
                        <div className="flex flex-col gap-1.5">
                          {daySlots.length === 0 ? (
                            <p className="text-[11px] text-center py-2" style={{ color: 'var(--txt4)' }}>—</p>
                          ) : daySlots.map(s => {
                            const rank = pickRank(s);
                            const picked = rank >= 0;
                            const tooSoon = new Date(s.startsAt).getTime() < cutoff;
                            const c = colorFor(s.teacherId);
                            return (
                              <button key={slotKey(s)} disabled={tooSoon} onClick={() => toggleSlot(s)}
                                title={tooSoon
                                  ? `Online bookings need ${LEAD_HOURS}h notice — call the studio for sooner.`
                                  : `${s.teacherName} · ${s.duration} min`}
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
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {!loadingSlots && slots.length === 0 && assignments.length > 0 && (
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
                {/* Which assignment this booking is for — only asked when the
                    picked time could genuinely serve more than one of the
                    family's instruments with that teacher. */}
                {currentCandidates.length > 1 && (
                  <div className="mb-3">
                    <p className="text-xs font-bold mb-1.5" style={{ color: 'var(--txt2)' }}>Which lesson is this for?</p>
                    <div className="space-y-1.5">
                      {currentCandidates.map(c => (
                        <label key={c.enrollmentId}
                          className="flex items-center gap-2 text-sm cursor-pointer rounded-lg border px-2.5 py-1.5"
                          style={{ borderColor: chosenEnrollmentId === c.enrollmentId ? 'var(--sage-md)' : 'var(--bd2)' }}>
                          <input type="checkbox" checked={chosenEnrollmentId === c.enrollmentId}
                            onChange={() => setChosenEnrollmentId(c.enrollmentId)}
                            className="rounded border-[var(--bd2)]" />
                          <span style={{ color: 'var(--txt)' }}>
                            {cap(c.instrument)}{multiChild ? ` · ${c.studentName}` : ''}
                            <span style={{ color: 'var(--txt4)' }}> · {formatMoney(c.price)}</span>
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                {chosen && (
                  <div className="mb-3 rounded-xl border px-3 py-2 text-sm" style={{ borderColor: 'var(--bd2)', background: 'var(--surf)' }}>
                    <p className="font-bold" style={{ color: 'var(--txt)' }}>{cap(chosen.instrument)}</p>
                    <p className="text-xs" style={{ color: 'var(--txt3)' }}>
                      {chosen.studentName} · {picks[0]!.teacherName} · {picks[0]!.duration} min · {formatMoney(chosen.price)}
                    </p>
                  </div>
                )}

                <ul className="space-y-1.5 mb-3">
                  {picks.map((p, i) => (
                    <li key={slotKey(p)} className="flex items-center justify-between gap-2 text-sm rounded-lg border px-2.5 py-1.5"
                      style={{ borderColor: i === 0 ? 'var(--sage-md)' : 'var(--bd2)' }}>
                      <span style={{ color: 'var(--txt)' }}>
                        <span className="font-black mr-1.5" style={{ color: 'var(--sage-dk)' }}>#{i + 1}</span>
                        {/* Studio-zone, not browser-local — this is the same slot the
                            grid column (and the min= on the recurring-end date picker
                            below) is keyed by via studioDayString; a raw
                            toLocaleDateString here read the browser's clock instead and
                            could show a different day than the column the parent
                            actually clicked. */}
                        {fmtDate(p.startsAt, { weekday: 'short', day: 'numeric', month: 'short' })} · {fmtTime(p.startsAt)}
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
                    // A weekly series books one recurring slot, so drop any ranked
                    // fallback picks when it's turned on.
                    onChange={e => { setRecurring(e.target.checked); if (e.target.checked) setPicks(p => p.slice(0, 1)); }}
                    className="rounded border-[var(--bd2)]" />
                  <span className="inline-flex items-center gap-1.5" style={{ color: 'var(--txt)' }}>
                    <Repeat size={13} /> Repeat weekly
                  </span>
                </label>
                {recurring && (
                  <div className="mb-2">
                    <p className="text-xs mb-2 rounded-lg px-2.5 py-1.5" style={{ background: 'var(--sage-lt)', color: 'var(--sage-dk)' }}>
                      Books this time every week — no need to rebook. Back-up times don&apos;t apply to a weekly series.
                    </p>
                    <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--txt2)' }}>
                      Ends on (optional)
                    </label>
                    <div className="flex items-center gap-2">
                      <input type="date" value={recurringEnd}
                        min={picks[0] ? studioDayString(picks[0].startsAt) : undefined}
                        onChange={e => setRecurringEnd(e.target.value)}
                        className="ui-input text-xs py-1.5 flex-1 min-w-0" />
                      {recurringEnd && (
                        <button type="button" onClick={() => setRecurringEnd('')}
                          className="shrink-0 text-[var(--txt4)] hover:text-[var(--txt)]" aria-label="Clear end date">
                          <X size={13} />
                        </button>
                      )}
                    </div>
                    <p className="text-[11px] mt-1" style={{ color: 'var(--txt4)' }}>
                      Leave blank to keep going until you cancel.
                    </p>
                  </div>
                )}

                {/* No "this is a trial lesson" toggle: whether a booking is a
                    trial is decided by the enrolment's status (set by the studio),
                    never self-declared here. The server ignores any client trial
                    flag — letting the parent set it would promise a trial price
                    the booking would never actually be charged. */}

                <button onClick={book} disabled={booking || !chosen}
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
