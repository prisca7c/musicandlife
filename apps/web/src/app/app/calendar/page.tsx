'use client';

import { useState, useEffect, useRef, FormEvent } from 'react';
import { apiFetch } from '@/lib/api';
import { useApi } from '@/lib/swr';
import { fmtTime, fmtTimeEnd, fmtDate, studioMinutesFromMidnight, studioDayString } from '@/lib/datetime';
import { lessonStatusLabel, attendanceStatusLabel } from '@/lib/lesson-status';
import { useRole } from '@/lib/use-role';
import { usePendingBadges } from '@/lib/use-pending-badges';
import { Modal } from '@/components/modal';
import { Badge } from '@/components/badge';
import { SearchableSelect } from '@/components/searchable-select';
import { InfoTooltip } from '@/components/info-tooltip';
import { AssignStudentsModal } from '@/components/assign-students-modal';
import { SectionTabs } from '@/components/section-tabs';
import { lessonRate } from '@music-life/types';
import { useInstruments } from '@/lib/use-instruments';
import { ChevronDown, ChevronLeft, ChevronRight, Users, Check, X, Repeat, PoundSterling, Shuffle, Pencil, Copy, Trash2, ListFilter, Send } from 'lucide-react';

interface Lesson {
  id: string; startsAt: string; duration: number; status: string; notes: string | null;
  enrollmentId?: string | null;
  student: { id: string; firstName: string; lastName: string } | null;
  teacher: { id: string; firstName: string; lastName: string } | null;
  attendance: { status: string } | null;
  enrollment: { instrument: string; lessonType: string; groupName?: string | null; teacherId?: string | null } | null;
  paymentStatus?: 'paid' | 'unpaid' | 'void' | 'unbilled';
}
interface StaffMember { id: string; firstName: string; lastName: string; }
interface Student { id: string; firstName: string; lastName: string; }
interface Enrollment {
  id: string; instrument: string; lessonType: string; groupName?: string | null; status: string;
  teacherId?: string | null; rate?: number; defaultDuration?: number;
}
interface StudentDetail { id: string; enrollments: Enrollment[]; }
interface Availability { id: string; staffId: string; weekday: string; startTime: string; endTime: string; }

// ─── Layout constants ─────────────────────────────────────────────────────────
const PX_PER_HOUR = 100;         // pixel height per 1 hour band
const DAY_START   = 8;           // 08:00
const DAY_END     = 21;          // 21:00
const HOURS       = Array.from({ length: DAY_END - DAY_START }, (_, i) => i + DAY_START);
const DAYS        = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const WEEKDAY_KEYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const TOTAL_H     = HOURS.length * PX_PER_HOUR; // 1144px

// ─── Availability band geometry (windows are studio wall-clock "HH:MM") ─────────
function hhmmToMin(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}
/** Pixel top/height for a window, clamped to the visible DAY_START..DAY_END range. */
function bandBox(startMin: number, endMin: number): { top: number; height: number } | null {
  const top = Math.max((startMin - DAY_START * 60) / 60 * PX_PER_HOUR, 0);
  const bottom = Math.min((endMin - DAY_START * 60) / 60 * PX_PER_HOUR, TOTAL_H);
  if (bottom <= top) return null;
  return { top, height: bottom - top };
}
/** Merge overlapping windows into a flat set of [start,end] minute ranges (for the week view union). */
function mergeWindows(wins: Availability[]): [number, number][] {
  const iv = wins.map(w => [hhmmToMin(w.startTime), hhmmToMin(w.endTime)] as [number, number])
    .sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const [s, e] of iv) {
    const last = out[out.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}
function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getRoleFromToken(token?: string): string {
  try {
    if (!token) return '';
    const payload = JSON.parse(atob(token.split('.')[1]!));
    return payload.role ?? '';
  } catch { return ''; }
}

function getWeekStart(date: Date) {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  d.setHours(0, 0, 0, 0);
  return d;
}
// The calendar's from/to/weekStart fetch bounds, as the STUDIO-zone day of a
// local-midnight grid date. `.toISOString()` renders in UTC, which under BST
// (local = UTC+1) rolls a local Monday back to Sunday — so the API window
// started a day early and its upper bound cut off the grid's final Sunday,
// hiding every Sunday lesson from the week view (and the last Sunday of the
// month view) all summer. studioDayString matches how the grid buckets lessons.
function formatDate(d: Date) { return studioDayString(d); }

// Render a Date for display using the STUDIO-zone calendar day, not the
// browser's. `d.toLocaleDateString(...)` with no `timeZone` reads the day/
// weekday out of the browser's local clock — for a viewer whose device isn't
// set to the studio's zone, near a day boundary that can read a different
// weekday (or day-of-month) than what studioDayString buckets the grid's
// lessons/availability bands by, e.g. a "Sat" header sitting over Sunday's
// data. Anchoring at noon UTC of the studio-zone day string (the same
// technique the backend uses to turn a date into a weekday) makes the label
// zone-independent and always agree with the grid underneath it.
function formatDateLabel(d: Date, opts: Intl.DateTimeFormatOptions) {
  return new Date(`${studioDayString(d)}T12:00:00Z`).toLocaleDateString('en-GB', { ...opts, timeZone: 'UTC' });
}

// The 6-week (42-day) grid that renders the month containing `date`: always
// starts on the Monday on or before the 1st, so the first week's leading days
// from the previous month fill in, and covers 42 days so any month fits.
function getMonthGrid(date: Date): { monthStart: Date; gridStart: Date; gridEnd: Date } {
  const monthStart = new Date(date.getFullYear(), date.getMonth(), 1);
  const gridStart = getWeekStart(monthStart);
  const gridEnd = new Date(gridStart);
  gridEnd.setDate(gridEnd.getDate() + 41);
  return { monthStart, gridStart, gridEnd };
}

// Position on the day grid using the lesson's wall-clock time in the studio zone
// (so a 16:00 lesson sits at the 16:00 row for every viewer, not the browser's zone).
function minutesFromDayStart(iso: string): number {
  return studioMinutesFromMidnight(iso) - DAY_START * 60;
}

// ─── Overlap-aware stacked layout ──────────────────────────────────────────────
// Overlapping lessons stack into rows, ordered chronologically (then
// alphabetically by student for exact ties) — same ordering `sorted` below
// already produces, so a cluster's array order *is* its row order. Each row
// holds up to MAX_PER_ROW lessons side by side (a studio with several
// teachers can easily have 5-6 lessons at the exact same time; one row per
// lesson made the day view absurdly tall), and once a row is full the next
// lesson wraps to a new row below, growing that hour's elastic height.
const STACK_ROW_H = 45;  // px per row once a slot is stacked — sized for the compact 2-line block
const STACK_GAP    = 1;  // gap between rows sharing the same/overlapping time — they're one moment, keep them tight
const CLUSTER_GAP  = 5;  // gap between separate time clusters — visually distinct from the same-time gap above
const MAX_PER_ROW  = 3;  // most lessons allowed side by side in one stacked row before wrapping

type LessonLayout = Lesson & { rowIndex: number; colIndex: number; colsInRow: number; stackSize: number; clusterTop: number; clusterHeight: number; ownTop: number; ownHeight: number };

// ─── Elastic hour rows ────────────────────────────────────────────────────────
// An hour with several simultaneous lessons stacked in it used to keep the same
// fixed PX_PER_HOUR band as every other hour, so the stack just overflowed
// downward past its own gridline (computeLayout's cursorBottom pushdown kept
// boxes from overlapping, but the hour LINES underneath never moved to match —
// a busy 3pm could visibly bleed into 4/5pm's rows while those hours' own
// labels stayed put where they were). Real per-hour heights fix that: each
// hour grows to fit whatever it actually needs to render, and every column
// shares the same set of heights so the hour gridlines still line up across
// the whole grid.
const BASELINE_HOURS = HOURS.map(() => PX_PER_HOUR);

function cumulativeOffsets(hourHeights: number[]): number[] {
  const offsets: number[] = [];
  let acc = 0;
  for (const h of hourHeights) { offsets.push(acc); acc += h; }
  return offsets;
}
function elasticTotalHeight(hourHeights: number[]): number {
  return hourHeights.reduce((a, b) => a + b, 0);
}
/** Convert "minutes since DAY_START" into a pixel Y using per-hour heights that may differ from PX_PER_HOUR. */
function elasticY(minutesFromDayStart: number, hourHeights: number[], offsets: number[]): number {
  const clamped = Math.max(0, Math.min(minutesFromDayStart, hourHeights.length * 60));
  const hourIdx = Math.min(hourHeights.length - 1, Math.floor(clamped / 60));
  const fracIntoHour = (clamped - hourIdx * 60) / 60;
  return offsets[hourIdx]! + fracIntoHour * hourHeights[hourIdx]!;
}
/** Elastic-aware replacement for bandBox, used once hourHeights aren't uniform. */
function elasticBandBox(startMin: number, endMin: number, hourHeights: number[], offsets: number[]): { top: number; height: number } | null {
  const top = elasticY(startMin - DAY_START * 60, hourHeights, offsets);
  const bottom = elasticY(endMin - DAY_START * 60, hourHeights, offsets);
  if (bottom <= top) return null;
  return { top, height: bottom - top };
}

// One pass at uniform PX_PER_HOUR heights just to find out how tall each hour
// actually needs to be across every column (day, or teacher, depending on
// view) — then the real layout pass below uses that per-hour height instead.
// Two or more SEPARATE clusters (not overlapping each other, just both
// starting within the same clock hour — e.g. one at :05 and another at :40)
// each need their own real room; summing them (not just taking whichever one
// is tallest) is what actually guarantees the real layout pass below never
// has to push the second one down past its true start time into the next
// hour's row.
function computeElasticHourHeights(columns: Lesson[][]): number[] {
  const needed = HOURS.map(() => PX_PER_HOUR);
  for (const col of columns) {
    const clusters = clusterLessons(col);
    const perHour = HOURS.map(() => 0);
    for (const cluster of clusters) {
      // Laying this one cluster out alone always yields its true, pushdown-free
      // height — computeLayout never pushes down the very first (only) cluster
      // it processes in a pass.
      const solo = computeLayout(cluster, BASELINE_HOURS);
      const clusterHeight = solo[0]?.clusterHeight ?? 0;
      const startMin = minutesFromDayStart(cluster[0]!.startsAt);
      const hourIdx = Math.min(HOURS.length - 1, Math.max(0, Math.floor(startMin / 60)));
      perHour[hourIdx] += clusterHeight + CLUSTER_GAP;
    }
    for (let hi = 0; hi < HOURS.length; hi++) {
      if (perHour[hi]! > 0) needed[hi] = Math.max(needed[hi]!, perHour[hi]!);
    }
  }
  return needed;
}

// How many lessons in a cluster are simultaneously "live" at their busiest
// instant — a sweep over start/end events, processing an end before a start
// at the same instant so two back-to-back lessons that just touch don't
// count as overlapping (matches the clustering sweep below).
function peakOverlap(cluster: Lesson[]): number {
  const events: { t: number; delta: number }[] = [];
  for (const l of cluster) {
    const start = new Date(l.startsAt).getTime();
    events.push({ t: start, delta: 1 }, { t: start + l.duration * 60000, delta: -1 });
  }
  events.sort((a, b) => a.t - b.t || a.delta - b.delta);
  let cur = 0, peak = 0;
  for (const e of events) { cur += e.delta; peak = Math.max(peak, cur); }
  return peak;
}

// Greedy interval-column packing (the standard "day view" calendar layout):
// walk lessons in start order, drop each into the first column whose last
// lesson has already ended by this one's start, opening a new column only
// when none are free. Two lessons that don't directly overlap can end up
// sharing a column even if a third lesson links them into the same cluster.
function assignColumns(cluster: Lesson[]): { colIndex: number; numColumns: number }[] {
  const colEnds: number[] = [];
  const colIndexes = cluster.map(l => {
    const start = new Date(l.startsAt).getTime();
    const end = start + l.duration * 60000;
    let col = colEnds.findIndex(e => e <= start);
    if (col === -1) { col = colEnds.length; colEnds.push(end); } else { colEnds[col] = end; }
    return col;
  });
  const numColumns = colEnds.length;
  return colIndexes.map(colIndex => ({ colIndex, numColumns }));
}

// Split into clusters of transitively-overlapping lessons — a sweep that
// starts a new cluster whenever a gap opens up. A lesson linked into a
// busier cluster through an intermediate lesson it doesn't itself overlap
// still belongs in that cluster, so the whole group stacks together.
function clusterLessons(dayLessons: Lesson[]): Lesson[][] {
  const sorted = [...dayLessons].sort((a, b) => {
    const byTime = new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime();
    if (byTime !== 0) return byTime;
    const aName = `${a.student?.firstName ?? ''} ${a.student?.lastName ?? ''}`;
    const bName = `${b.student?.firstName ?? ''} ${b.student?.lastName ?? ''}`;
    return aName.localeCompare(bName);
  });

  const clusters: Lesson[][] = [];
  let current: Lesson[] = [];
  let clusterEnd = -Infinity;
  for (const l of sorted) {
    const start = new Date(l.startsAt).getTime();
    const end = start + l.duration * 60000;
    if (current.length > 0 && start >= clusterEnd) {
      clusters.push(current);
      current = [];
      clusterEnd = -Infinity;
    }
    current.push(l);
    clusterEnd = Math.max(clusterEnd, end);
  }
  if (current.length > 0) clusters.push(current);
  return clusters;
}

function computeLayout(dayLessons: Lesson[], hourHeights: number[] = BASELINE_HOURS): LessonLayout[] {
  const clusters = clusterLessons(dayLessons);

  // A stacked cluster's rendered height is, in the worst case, an artificial
  // "however many rows it takes to read", not the real elapsed time the
  // cluster spans — so on a busy day a big cluster can render taller than
  // the clock gap before the next cluster starts, and the two visually
  // collide even though neither is time-overlapping. Walk clusters in order
  // and push each one's top down past the previous cluster's actual rendered
  // bottom (never earlier than its own real start time) so rendered boxes
  // never overlap, at the cost of losing exact clock alignment on days packed
  // tightly enough to need it.
  const offsets = cumulativeOffsets(hourHeights);
  let cursorBottom = -Infinity;
  const result: LessonLayout[] = [];
  const MIN_BOX_H = STACK_ROW_H * 0.6; // a very short lesson still needs to be tappable/readable

  for (const cluster of clusters) {
    const startMinutes = minutesFromDayStart(cluster[0]!.startsAt);
    const naturalTop = elasticY(startMinutes, hourHeights, offsets);
    const clusterTop = Math.max(naturalTop, cursorBottom);
    const pushDown = clusterTop - naturalTop;

    if (cluster.length === 1) {
      // A lesson's own box height always reflects its true duration at the
      // fixed baseline rate — never scaled by this hour's elastic size, or a
      // short lesson would render abnormally tall purely because some other
      // cluster (in this hour, in this or another column) needed more room.
      const clusterHeight = Math.max((cluster[0]!.duration / 60) * PX_PER_HOUR, STACK_ROW_H);
      cursorBottom = clusterTop + clusterHeight + CLUSTER_GAP;
      result.push({
        ...cluster[0]!, rowIndex: 0, colIndex: 0, colsInRow: 1, stackSize: 1,
        clusterTop, clusterHeight, ownTop: clusterTop, ownHeight: clusterHeight - STACK_GAP,
      });
      continue;
    }

    // Few enough lessons overlapping at once to lay them out side by side at
    // their true, duration-accurate height (like a normal day-view calendar) —
    // this is the common case (2-3 lessons whose times only partly overlap).
    // Only when MORE than MAX_PER_ROW are genuinely simultaneous (several
    // teachers double-booked at the exact same moment) does true-height
    // side-by-side layout stop being readable, so that case falls back to
    // fixed-height compact rows below instead.
    if (peakOverlap(cluster) <= MAX_PER_ROW) {
      const assigned = assignColumns(cluster);
      const boxes = cluster.map((l, i) => {
        const start = minutesFromDayStart(l.startsAt);
        const top = elasticY(start, hourHeights, offsets) + pushDown;
        // Height is the lesson's true duration at the fixed baseline rate —
        // elasticY is only for POSITION (so a box still starts in the right
        // place after however many stretched hours come before it), never for
        // sizing a box that isn't itself the reason this hour got stretched.
        const height = Math.max((l.duration / 60) * PX_PER_HOUR, MIN_BOX_H);
        return { l, top, height, ...assigned[i]! };
      });
      const clusterBottom = Math.max(...boxes.map(b => b.top + b.height));
      const clusterHeight = clusterBottom - clusterTop;
      cursorBottom = clusterBottom + CLUSTER_GAP;
      boxes.forEach(b => {
        result.push({
          ...b.l, rowIndex: 0, colIndex: b.colIndex, colsInRow: b.numColumns, stackSize: cluster.length,
          clusterTop, clusterHeight, ownTop: b.top, ownHeight: b.height - STACK_GAP,
        });
      });
      continue;
    }

    const numRows = Math.ceil(cluster.length / MAX_PER_ROW);
    const clusterHeight = numRows * STACK_ROW_H;
    cursorBottom = clusterTop + clusterHeight + CLUSTER_GAP;
    cluster.forEach((l, i) => {
      const rowIndex = Math.floor(i / MAX_PER_ROW);
      const rowStart = rowIndex * MAX_PER_ROW;
      const colsInRow = Math.min(MAX_PER_ROW, cluster.length - rowStart);
      const ownTop = clusterTop + rowIndex * STACK_ROW_H;
      result.push({
        ...l, rowIndex, colIndex: i - rowStart, colsInRow, stackSize: cluster.length,
        clusterTop, clusterHeight, ownTop, ownHeight: STACK_ROW_H - STACK_GAP,
      });
    });
  }
  return result;
}

// ─── Instrument colours ───────────────────────────────────────────────────────
const INSTR_HUE: Record<string, string> = {
  piano: '#3D7A55', violin: '#2B6CB0', guitar: '#B7791F', drums: '#C05621',
  cello: '#553C9A', viola: '#2C7A7B', 'bass guitar': '#276749', vocal: '#97266D',
  ukulele: '#D69E2E', 'susuki violin': '#2B6CB0', ensemble: '#718096',
};
function instrColor(name?: string | null) { return INSTR_HUE[(name ?? '').toLowerCase()] ?? '#4A5568'; }

// ─── Teacher colours — fixed, named per real teacher (studio's own colour
// key), each tuned to sit in the middle of the range: saturated enough to
// read at a glance, but not so bright it glares or so dark it looks black on
// the block. Anyone not on this list (a new hire, the QA test account) falls
// back to the old deterministic palette so they still get a stable, distinct
// colour rather than breaking. ──────────────────────────────────────────────
const NAMED_TEACHER_COLORS: Record<string, string> = {
  dunni: '#8B5E3C',     // brown
  orlando: '#6B46C1',   // purple
  yanice: '#B83280',    // pink
  franklin: '#4A5568',  // grey
  lily: '#C53030',      // red
  peter: '#2F855A',     // green
  theodore: '#C05621',  // yellow/orange
  christine: '#2B6CB0', // blue
};
const TEACHER_PALETTE = [
  '#2B6CB0', '#B7791F', '#553C9A', '#276749', '#C05621',
  '#97266D', '#2C7A7B', '#9B2C2C', '#1A4971', '#6B46C1',
  '#975A16', '#22543D',
];
// Index-based assignment from the currently loaded staff list guarantees no two
// teachers share a color (a pure hash can collide); falls back to a hash for any
// teacher not in the current list (e.g. inactive staff still referenced by a lesson).
// Beyond the fixed palette's size, colors are generated via hue rotation so any
// number of teachers stays distinct rather than wrapping back to reused hexes.
function colorAtIndex(i: number) {
  if (i < TEACHER_PALETTE.length) return TEACHER_PALETTE[i]!;
  const hue = Math.round((i * 360) / Math.max(TEACHER_PALETTE.length, 1)) % 360;
  return `hsl(${hue}, 55%, 38%)`;
}
let teacherColorMap: Record<string, string> = {};
function setTeacherColorMap(staffList: { id: string; firstName: string }[]) {
  const sorted = [...staffList].sort((a, b) => a.id.localeCompare(b.id));
  const map: Record<string, string> = {};
  let fallbackIdx = 0;
  sorted.forEach((s) => {
    const named = NAMED_TEACHER_COLORS[s.firstName.trim().toLowerCase()];
    map[s.id] = named ?? colorAtIndex(fallbackIdx++);
  });
  teacherColorMap = map;
}
function teacherColor(teacherId?: string | null) {
  if (!teacherId) return '#718096';
  if (teacherColorMap[teacherId]) return teacherColorMap[teacherId];
  let hash = 0;
  for (let i = 0; i < teacherId.length; i++) hash = (hash * 31 + teacherId.charCodeAt(i)) >>> 0;
  return TEACHER_PALETTE[hash % TEACHER_PALETTE.length]!;
}

// ─── Attendance landmark — one icon standing in for "what happened", shown in
// the block's left rail. Detail (which cancellation reason, etc.) lives one
// click away in the lesson modal; the calendar grid only needs the headline.
function attendanceIcon(status: string): { Icon: typeof Check; color: string; title: string } | null {
  if (status === 'completed') return { Icon: Check, color: '#22543D', title: 'Present' };
  if (status.startsWith('cancelled')) return { Icon: X, color: '#9B2C2C', title: 'Absent / cancelled' };
  return null;
}
const PAID_COLOR = '#22543D';
const UNPAID_COLOR = '#9B2C2C';
const PENDING_COLOR = '#718096';

// ─── Payment landmark — mirrors attendanceIcon: green once paid, red once
// unpaid, grey until the lesson has actually happened (nothing to collect yet).
function paymentIcon(lesson: Pick<Lesson, 'paymentStatus' | 'status'>): { color: string; title: string } | null {
  if (lesson.paymentStatus === 'paid') return { color: PAID_COLOR, title: 'Paid' };
  if (lesson.paymentStatus === 'unpaid') {
    if (lesson.status !== 'completed' && !lesson.status.startsWith('cancelled')) {
      return { color: PENDING_COLOR, title: "Lesson hasn't happened yet" };
    }
    return { color: UNPAID_COLOR, title: 'Unpaid' };
  }
  return null;
}

// ─── Lesson block ─────────────────────────────────────────────────────────────
function LessonBlock({ lesson, onClick }: { lesson: LessonLayout; onClick: () => void }) {
  const stacked = lesson.stackSize > 1;
  // ownTop/ownHeight are precomputed by computeLayout: for lessons whose
  // cluster stayed within MAX_PER_ROW simultaneous overlaps, these are real
  // duration-accurate pixel positions (side by side, each box its own true
  // length) — only a cluster busier than that falls back to fixed-height
  // compact rows, where a block can't show both "which slot" and "exactly
  // when" at once.
  const top    = lesson.ownTop;
  const height = lesson.ownHeight;
  const left   = stacked ? `${(lesson.colIndex * 100) / lesson.colsInRow}%` : 0;
  const width  = stacked ? `calc(${100 / lesson.colsInRow}% - 3px)` : 'calc(100% - 3px)';

  const instr    = lesson.enrollment?.instrument;
  const isGrp    = lesson.enrollment?.lessonType === 'group';
  const tColor   = teacherColor(lesson.teacher?.id);
  const iColor   = instrColor(instr);
  const present  = attendanceIcon(lesson.status);
  const paid     = paymentIcon(lesson);
  // A substitute: someone other than the student's normal enrolled teacher is
  // covering this one occurrence.
  const isSub = !!lesson.enrollment?.teacherId && !!lesson.teacher && lesson.enrollment.teacherId !== lesson.teacher.id;
  // A cancelled lesson used to render with the exact same full-strength colour
  // as a live one — the only tell was a 10px icon — so a cancelled block still
  // read as "there's a lesson here" at a glance. Dim it and strike the name,
  // matching how the month view already marks cancellations.
  const cancelled = lesson.status.startsWith('cancelled');
  // Group lessons are more usefully identified by their group name than by
  // repeating "group" — fall back to the instrument if no group name is set.
  const secondaryLabel = isGrp && lesson.enrollment?.groupName ? lesson.enrollment.groupName : instr;

  return (
    <button
      onClick={onClick}
      style={{
        top, height, left, width,
        background: hexToRgba(tColor, cancelled ? 0.06 : 0.14),
        borderColor: hexToRgba(tColor, cancelled ? 0.3 : 0.55),
        opacity: cancelled ? 0.65 : 1,
      }}
      className="absolute rounded-lg border cursor-pointer text-left overflow-hidden transition-all hover:brightness-95 hover:shadow-md group z-10 flex items-stretch gap-0.5 px-1"
    >
      {/* Left rail: attendance status, paid status stacked underneath. Only
          reserved when there's actually a landmark to show — a lesson with
          neither (not yet happened, nothing to collect) shouldn't leave a
          blank gutter; its content starts flush left instead. */}
      {(present || paid) && (
        <span className="flex flex-col items-center justify-center shrink-0 w-4 gap-0.5">
          {present && (
            <span title={present.title}>
              <present.Icon size={11} style={{ color: present.color }} aria-label={present.title} />
            </span>
          )}
          {paid && (
            <span title={paid.title}>
              <PoundSterling size={10} style={{ color: paid.color }} aria-label={paid.title} />
            </span>
          )}
        </span>
      )}

      {/* Middle: two compact lines — time + name, then instrument/group + teacher */}
      <span className="flex-1 min-w-0 flex flex-col justify-center gap-0.5 py-0.5">
        <span className="flex items-baseline gap-1 min-w-0">
          <span className="text-[10px] font-bold leading-none tabular-nums shrink-0" style={{ color: tColor, opacity: 0.7 }}>
            {fmtTime(lesson.startsAt)}
          </span>
          <span className="text-[13px] font-bold leading-tight truncate" style={{ color: tColor, textDecoration: cancelled ? 'line-through' : undefined }}>
            {lesson.student?.firstName} {lesson.student?.lastName}
          </span>
        </span>
        <span className="flex items-center gap-1 min-w-0">
          {secondaryLabel && (
            <span className="text-[10px] font-semibold capitalize shrink-0 whitespace-nowrap" style={{ color: iColor }}>
              {secondaryLabel}
            </span>
          )}
          {isSub && <Shuffle size={10} className="shrink-0" style={{ color: tColor }} aria-label="Substitute teacher" />}
          {lesson.teacher && (
            <span className="text-[10px] leading-tight truncate min-w-0 flex-1" style={{ color: tColor, opacity: 0.7 }}>
              · {lesson.teacher.firstName} {lesson.teacher.lastName}
            </span>
          )}
        </span>
      </span>
    </button>
  );
}

// ─── Add lesson modal ─────────────────────────────────────────────────────────
interface SlotsResponse { date: string; weekday: string; noWindows: boolean; slots: string[]; }
type AddResult =
  | { kind: 'weekly'; created: number; through: string }
  | { kind: 'request'; teacherName: string; count: number }
  | { kind: 'single'; lessonId: string; studentName: string };

function to12h(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const ap = (h ?? 0) < 12 ? 'am' : 'pm';
  const hr = ((h ?? 0) % 12) || 12;
  return `${hr}:${String(m ?? 0).padStart(2, '0')}${ap}`;
}

function AddLessonModal({ open, onClose, onCreated, defaultDate, defaultTime }: {
  open: boolean; onClose: () => void; onCreated: () => void;
  defaultDate?: string; defaultTime?: string;
}) {
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [studentsList, setStudentsList] = useState<Student[]>([]);
  const [studentId, setStudentId] = useState('');
  const [teacherId, setTeacherId] = useState('');
  const [lessonType, setLessonType] = useState<'private' | 'group'>('private');
  const [instrument, setInstrument] = useState('');
  const [groupName, setGroupName] = useState('');
  const [duration, setDuration] = useState('30');
  const [date, setDate] = useState(defaultDate ?? '');
  const [notes, setNotes] = useState('');
  // Availability-driven time selection.
  const [slots, setSlots] = useState<string[]>([]);
  const [noWindows, setNoWindows] = useState(false);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [picks, setPicks] = useState<string[]>([]);     // ranked HH:MM (1st, 2nd, 3rd)
  const [manualTime, setManualTime] = useState('');      // fallback when no teacher assigned
  const [letTeacherChoose, setLetTeacherChoose] = useState(true);
  const [repeat, setRepeat] = useState(false);
  // 'ongoing' = no end date, matching the family self-booking flow's default —
  // the daily recurrence worker keeps topping up new weeks forever on its own,
  // so there was never a real reason to force picking a stop point up front.
  const [repeatWeeks, setRepeatWeeks] = useState('ongoing');
  const [customEndDate, setCustomEndDate] = useState('');
  // For the "Termly" repeat option — not every student is on a term (adult
  // learners in particular often aren't), so this is offered only when an
  // active term actually exists rather than forced on everyone.
  const { data: terms = [] } = useApi<{ id: string; name: string; status: string; endsOn: string }[]>(open ? '/terms' : null);
  const activeTerm = terms.find(t => t.status === 'active');
  const [result, setResult] = useState<AddResult | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [undoing, setUndoing] = useState(false);
  const [isTeacher, setIsTeacher] = useState(false);
  const tok = () => document.cookie.match(/access_token=([^;]+)/)?.[1];
  const orgInstruments = useInstruments();
  // Validation errors (e.g. "no time picked") render at the top of the modal,
  // but the form is long enough to scroll — someone down at "Repeat weekly"
  // clicking submit saw nothing happen because the banner appeared off-screen
  // above the fold. Scroll it into view whenever a new error lands.
  const errorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [error]);

  useEffect(() => {
    if (!open) return;
    setStudentId(''); setTeacherId(''); setDuration('30');
    setLessonType('private'); setInstrument(''); setGroupName('');
    setDate(defaultDate ?? ''); setNotes('');
    setSlots([]); setNoWindows(false); setPicks([]); setManualTime(defaultTime ?? '');
    setLetTeacherChoose(true);
    setRepeat(false); setRepeatWeeks('ongoing'); setCustomEndDate(''); setResult(null); setError('');
    const t = tok();
    const role = getRoleFromToken(t);
    const teacherSelf = role === 'teacher';
    setIsTeacher(teacherSelf);
    Promise.all([
      teacherSelf
        ? apiFetch<StaffMember | null>('/staff/me', { token: t }).catch(() => null).then(me => me ? [me] : [])
        : apiFetch<StaffMember[]>('/staff', { token: t }).catch(() => []),
      apiFetch<Student[]>('/students', { token: t }).catch(() => []),
    ]).then(([s, st]) => {
      setStaff(s);
      setStudentsList(st);
      if (teacherSelf && s[0]) setTeacherId(s[0].id);
    });
  }, [open, defaultDate, defaultTime]);

  // A teacher booking for themselves is the one choosing the time, so the
  // "let the teacher pick" hand-off doesn't apply. Recurring weekly bookings and
  // unassigned lessons are always booked directly too (there's no teacher to ask).
  const isUnassigned = !teacherId;
  const requestMode = !isTeacher && !isUnassigned && !repeat && letTeacherChoose;

  // Fetch the teacher's bookable slots whenever teacher / date / duration change.
  useEffect(() => {
    if (!open || !teacherId || !date) { setSlots([]); setNoWindows(false); return; }
    const t = tok();
    setLoadingSlots(true);
    const dur = parseInt(duration) || 60;
    apiFetch<SlotsResponse>(`/scheduling/available-slots?teacherId=${teacherId}&date=${date}&duration=${dur}`, { token: t })
      .then(res => {
        setSlots(res.slots); setNoWindows(res.noWindows);
        // Drop any ranked picks that are no longer offered (date/duration changed).
        setPicks(prev => prev.filter(p => res.slots.includes(p)));
      })
      .catch(() => { setSlots([]); setNoWindows(false); })
      .finally(() => setLoadingSlots(false));
  }, [open, teacherId, date, duration]);

  function toggleSlot(label: string) {
    if (requestMode) {
      setPicks(prev => prev.includes(label)
        ? prev.filter(p => p !== label)
        : prev.length >= 3 ? prev : [...prev, label]);
    } else {
      setPicks(prev => (prev[0] === label ? [] : [label]));  // single pick for direct booking
    }
  }

  const instrumentOptions = lessonType === 'private' ? orgInstruments.private : orgInstruments.group;
  const durationOptions = lessonType === 'private'
    ? [{ value: '30', label: '30 min' }, { value: '45', label: '45 min' }, { value: '60', label: '60 min' }]
    : [{ value: '60', label: '60 min' }];
  const teacherName = staff.find(s => s.id === teacherId)?.firstName ?? 'the teacher';

  async function ensureEnrollmentId(t?: string): Promise<string> {
    // Find or create a matching enrollment so the lesson carries instrument + type (+ group name).
    const detail = await apiFetch<StudentDetail>(`/students/${studentId}`, { token: t });
    // Case/whitespace-insensitive, matching the server's own duplicate check
    // (assertNoDuplicateEnrollment) — an exact string match here missed a real
    // pre-existing enrollment whenever the two disagreed on casing (e.g. an
    // imported "Piano" vs. this picker's canonical lowercase "piano"), which
    // then tried to create a second one and got rejected as a duplicate by
    // that same server check. Case-insensitive here keeps both sides in sync.
    const instrumentNorm = instrument.trim().toLowerCase();
    const existing = detail.enrollments.find(
      en => en.instrument.trim().toLowerCase() === instrumentNorm && en.lessonType === lessonType && en.status !== 'withdrawn'
        && (lessonType !== 'group' || (en.groupName ?? '') === groupName.trim()),
    );
    if (existing) {
      // A matching enrollment can predate this booking and carry a different (or
      // no) teacher. Without reconciling it, this dialog's teacher choice is
      // cosmetic — recurring materialization reads enrollment.teacherId, not
      // what's shown here, so "repeat weekly" would silently book the OLD
      // teacher's series instead of the one just picked.
      if (teacherId && (existing.teacherId ?? '') !== teacherId) {
        await apiFetch(`/enrollments/${existing.id}`, {
          method: 'PATCH', token: t, body: JSON.stringify({ teacherId }),
        });
      }
      return existing.id;
    }
    const created = await apiFetch<{ id: string }>(`/students/${studentId}/enrollments`, {
      method: 'POST', token: t, body: JSON.stringify({
        instrument, lessonType, duration: parseInt(duration) || 60,
        groupName: lessonType === 'group' && groupName.trim() ? groupName.trim() : undefined,
        teacherId: teacherId || undefined,
        rate: lessonRate(lessonType, parseInt(duration) || 60),
        autoRenew: false, status: 'active',
      }),
    });
    return created.id;
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!studentId) { setError('Please select a student'); return; }
    if (!instrument) { setError('Please select an instrument or group'); return; }
    if (!date) { setError('Please pick a date'); return; }
    if (repeat && repeatWeeks === 'custom' && !customEndDate) { setError('Please pick an end date, or choose Ongoing instead.'); return; }

    // Resolve the chosen time(s). Unassigned lessons use the manual time; every
    // teacher-assigned lesson is picked from their availability slots.
    const times = isUnassigned ? (manualTime ? [manualTime] : []) : picks;
    if (times.length === 0) {
      setError(isUnassigned ? 'Please enter a time' : `Please choose an available time in ${teacherName}'s hours`);
      return;
    }

    setSaving(true); setError('');
    const t = tok();
    try {
      const enrollmentId = await ensureEnrollmentId(t);

      if (repeat) {
        // Set the enrollment's weekly schedule (weekday derived from the picked
        // date), then materialise the series so every week appears at once.
        // `date` is already a studio-zone "YYYY-MM-DD" string; parsing it as
        // "...T12:00:00" (no Z) reads it back in the BROWSER's zone via getDay(),
        // which for a large enough offset can name the wrong weekday for the
        // recurring rule actually written to the enrollment. Anchor at noon UTC
        // and read getUTCDay() instead — zone-independent, same as elsewhere.
        const weekday = WEEKDAY_KEYS[(new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7];
        // A finite pick needs its own endDate on the rule — without it the
        // daily recurrence worker has no way to know to stop, and would just
        // keep extending the series forever regardless of what was chosen here.
        // 'weekly'/'monthly' are just fixed week counts (1 / 4); 'termly' ends
        // at the active term's own end date, when one exists.
        const weeksFromEndDate = (end: string) =>
          Math.max(1, Math.ceil((new Date(`${end}T12:00:00Z`).getTime() - new Date(`${date}T12:00:00Z`).getTime()) / (7 * 86400000)) + 1);
        let endDate: string | undefined;
        let weeksToBook: number | undefined;
        if (repeatWeeks === 'ongoing') {
          endDate = undefined; weeksToBook = undefined;
        } else if (repeatWeeks === 'custom') {
          endDate = customEndDate || undefined;
          weeksToBook = customEndDate ? weeksFromEndDate(customEndDate) : undefined;
        } else if (repeatWeeks === 'termly') {
          endDate = activeTerm?.endsOn;
          weeksToBook = endDate ? weeksFromEndDate(endDate) : undefined;
        } else {
          const n = parseInt(repeatWeeks) || 1;
          endDate = studioDayString(new Date(new Date(`${date}T12:00:00Z`).getTime() + n * 7 * 86400000));
          weeksToBook = n;
        }
        await apiFetch(`/enrollments/${enrollmentId}`, {
          method: 'PATCH', token: t, body: JSON.stringify({ scheduleRule: { weekday, startTime: times[0], endDate } }),
        });
        const r = await apiFetch<{ created: number; through: string }>('/lessons/recurring', {
          method: 'POST', token: t,
          body: JSON.stringify({
            enrollmentId,
            // 'ongoing': omit weeks entirely so the API's own default window
            // applies — the series doesn't stop there, the daily worker keeps
            // extending it for as long as the enrolment stays active.
            weeks: weeksToBook,
            startFrom: date,
          }),
        });
        onCreated();
        setResult({ kind: 'weekly', created: r.created, through: r.through });
      } else if (requestMode) {
        // Hand the ranked times to the teacher — no lesson exists until they confirm.
        await apiFetch('/lesson-requests', { method: 'POST', token: t, body: JSON.stringify({
          studentId, teacherId, enrollmentId,
          duration: parseInt(duration) || 60,
          proposedStartsAt: `${date}T${times[0]}:00`,
          proposedStartsAt2: times[1] ? `${date}T${times[1]}:00` : undefined,
          proposedStartsAt3: times[2] ? `${date}T${times[2]}:00` : undefined,
          notes: notes || undefined,
        })});
        setResult({ kind: 'request', teacherName, count: times.length });
      } else {
        const created = await apiFetch<{ id: string }>('/lessons', { method: 'POST', token: t, body: JSON.stringify({
          studentId, teacherId: teacherId || undefined,
          enrollmentId,
          startsAt: `${date}T${times[0]}:00`,
          duration: parseInt(duration) || 60,
          notes: notes || undefined,
        })});
        onCreated();
        const studentName = studentsList.find(s => s.id === studentId);
        setResult({ kind: 'single', lessonId: created.id, studentName: studentName ? `${studentName.firstName} ${studentName.lastName}` : 'the student' });
      }
    } catch (err) { setError(err instanceof Error ? err.message : 'Error'); }
    finally { setSaving(false); }
  }

  const submitLabel = saving ? 'Saving…'
    : repeat ? 'Book weekly lessons'
    : requestMode ? `Send to ${teacherName} to confirm`
    : 'Add lesson';

  return (
    <Modal open={open} onClose={onClose} title="Add lesson">
      {error && (
        <div ref={errorRef} className="mb-4 text-sm rounded-xl px-4 py-3"
          style={{ background: 'var(--coral-lt)', color: 'var(--coral)', border: '1px solid #FCA5A5' }}>
          {error}
        </div>
      )}
      {result ? (
        <div className="space-y-4">
          <div className="rounded-xl px-4 py-4 text-sm"
            style={{ background: 'var(--sage-lt)', color: 'var(--sage-dk)', border: '1px solid var(--sage)' }}>
            {result.kind === 'weekly' ? (
              <>
                <p className="font-bold text-base mb-1">Weekly lessons booked ✓</p>
                {result.created > 0 ? (
                  <p>Added <strong>{result.created}</strong> weekly lesson{result.created !== 1 ? 's' : ''} through{' '}
                    {new Date(result.through).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}.</p>
                ) : (
                  <p>No new lessons were booked — they may already exist for this weekly slot.</p>
                )}
              </>
            ) : result.kind === 'single' ? (
              <>
                <p className="font-bold text-base mb-1">Lesson booked ✓</p>
                <p>Booked for <strong>{result.studentName}</strong>. Made a mistake? You can undo this right away.</p>
              </>
            ) : (
              <>
                <p className="font-bold text-base mb-1">Sent to {result.teacherName} ✓</p>
                <p>Proposed <strong>{result.count}</strong> time{result.count !== 1 ? 's' : ''}. {result.teacherName} will pick one to confirm —
                  it appears on the calendar the moment they do. You can track it under <strong>Booking requests</strong>.</p>
              </>
            )}
          </div>
          <div className="flex gap-3">
            {result.kind === 'single' && (
              <button type="button" disabled={undoing} onClick={async () => {
                setUndoing(true);
                try {
                  await apiFetch(`/lessons/${result.lessonId}`, { method: 'DELETE', token: tok() });
                  onCreated(); onClose();
                } catch (e) { setError(e instanceof Error ? e.message : 'Could not undo — the lesson is still booked.'); }
                finally { setUndoing(false); }
              }} className="text-sm flex-1 rounded-[9px] px-3 py-2 font-semibold transition-colors disabled:opacity-50"
                style={{ border: '1.5px solid var(--coral)', color: 'var(--coral)', background: '#fff' }}>
                {undoing ? 'Undoing…' : 'Undo'}
              </button>
            )}
            <button type="button" onClick={onClose} className="ui-btn-primary">Done</button>
          </div>
        </div>
      ) : (
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="ui-label">Student <span style={{ color: 'var(--coral)' }}>*</span></label>
          <SearchableSelect
            options={studentsList.map(s => ({ value: s.id, label: `${s.firstName} ${s.lastName}` }))}
            value={studentId} onChange={setStudentId} placeholder="Select student…"
          />
        </div>

        <div>
          <label className="ui-label">Lesson type <span style={{ color: 'var(--coral)' }}>*</span></label>
          <div className="flex gap-1 p-1 rounded-xl border border-[var(--bd)]" style={{ background: 'var(--bg2)' }}>
            {(['private', 'group'] as const).map(t => (
              <button
                key={t} type="button"
                onClick={() => { setLessonType(t); setInstrument(''); if (t === 'group') setDuration('60'); }}
                className="flex-1 text-sm py-1.5 rounded-lg font-semibold capitalize transition-all"
                style={{
                  background: lessonType === t ? 'white' : 'transparent',
                  color: lessonType === t ? 'var(--txt)' : 'var(--txt4)',
                  boxShadow: lessonType === t ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                }}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="ui-label">{lessonType === 'private' ? 'Instrument' : 'Group type'} <span style={{ color: 'var(--coral)' }}>*</span></label>
          <SearchableSelect
            options={instrumentOptions.map(i => ({ value: i, label: i.charAt(0).toUpperCase() + i.slice(1) }))}
            value={instrument} onChange={setInstrument} placeholder="Select…"
          />
        </div>

        {lessonType === 'group' && (
          <div>
            <label className="ui-label">Group name</label>
            <input
              value={groupName} onChange={e => setGroupName(e.target.value)}
              placeholder="e.g. Tuesday 4pm Ensemble" className="ui-input"
            />
          </div>
        )}

        {!isTeacher && (
          <div>
            <label className="ui-label">Teacher</label>
            <SearchableSelect
              options={staff.map(s => ({ value: s.id, label: `${s.firstName} ${s.lastName}` }))}
              value={teacherId} onChange={setTeacherId} emptyLabel="Unassigned"
            />
          </div>
        )}
        <div>
          <label className="ui-label">Duration (min)</label>
          {lessonType === 'group' ? (
            <SearchableSelect options={durationOptions} value={duration} onChange={setDuration} disabled />
          ) : (
            <input
              type="number" min="5" max="240" step="5"
              value={duration} onChange={e => setDuration(e.target.value)}
              className="ui-input"
            />
          )}
        </div>

        <div>
          <label className="ui-label">Date <span style={{ color: 'var(--coral)' }}>*</span></label>
          <input type="date" required value={date} onChange={e => setDate(e.target.value)} className="ui-input" />
        </div>

        {/* Time — availability-driven when a teacher is assigned, manual otherwise */}
        <div>
          <label className="ui-label flex items-center gap-1.5">
            {requestMode ? 'Preferred times' : 'Time'} <span style={{ color: 'var(--coral)' }}>*</span>
            {!isUnassigned && (
              <InfoTooltip text={requestMode
                ? `Pick up to three times inside ${teacherName}'s working hours. ${teacherName} confirms whichever suits — the lesson is only booked once they do.`
                : `Only times inside ${teacherName}'s working hours that are free of other lessons are shown, so you can't double-book.`} />
            )}
          </label>

          {isUnassigned ? (
            <>
              <input type="time" value={manualTime} onChange={e => setManualTime(e.target.value)} className="ui-input" />
              <p className="text-[11px] mt-1" style={{ color: 'var(--txt4)' }}>
                Assign a teacher above to pick from their available times.
              </p>
            </>
          ) : !date ? (
            <p className="text-sm" style={{ color: 'var(--txt4)' }}>Pick a date to see available times.</p>
          ) : loadingSlots ? (
            <p className="text-sm" style={{ color: 'var(--txt4)' }}>Finding {teacherName}&rsquo;s free times…</p>
          ) : slots.length === 0 ? (
            <div className="rounded-xl px-3.5 py-3 text-sm"
              style={{ background: 'var(--surf)', color: 'var(--txt3)', border: '1px solid var(--bd)' }}>
              No free times in {teacherName}&rsquo;s hours that day. Try another date, a shorter duration, or check their availability.
            </div>
          ) : (
            <>
              {noWindows && (
                <p className="text-[11px] mb-1.5" style={{ color: 'var(--coral)' }}>
                  {teacherName} hasn&rsquo;t set working hours yet — showing the full day. Set their availability for tighter suggestions.
                </p>
              )}
              <div className="flex flex-wrap gap-1.5">
                {slots.map(s => {
                  const rank = picks.indexOf(s);
                  const active = rank >= 0;
                  return (
                    <button
                      key={s} type="button" onClick={() => toggleSlot(s)}
                      className="text-xs font-semibold rounded-lg px-2.5 py-1.5 tabular-nums transition-colors flex items-center gap-1.5"
                      style={{
                        background: active ? 'var(--sage)' : 'white',
                        color: active ? 'white' : 'var(--txt2)',
                        border: `1.5px solid ${active ? 'var(--sage)' : 'var(--bd2)'}`,
                      }}
                    >
                      {requestMode && active && (
                        <span className="inline-flex items-center justify-center w-4 h-4 rounded-full text-[9px] font-bold"
                          style={{ background: 'rgba(255,255,255,0.3)' }}>{rank + 1}</span>
                      )}
                      {to12h(s)}
                    </button>
                  );
                })}
              </div>
              {requestMode && (
                <p className="text-[11px] mt-1.5" style={{ color: 'var(--txt4)' }}>
                  {picks.length === 0
                    ? `Tap up to 3 times in order of preference — ${teacherName} confirms one.`
                    : `Ranked: ${picks.map((p, i) => `${i + 1}. ${to12h(p)}`).join('  ')}`}
                </p>
              )}
            </>
          )}
        </div>

        {/* Let the teacher pick the final time (front desk only, single non-recurring lesson) */}
        {!isTeacher && !isUnassigned && !repeat && (
          <div className="rounded-xl border p-3" style={{ borderColor: letTeacherChoose ? 'var(--sage)' : 'var(--bd)', background: letTeacherChoose ? 'var(--sage-lt)' : 'transparent' }}>
            <label className="flex items-start gap-2.5 cursor-pointer">
              <input type="checkbox" checked={letTeacherChoose} onChange={e => { setLetTeacherChoose(e.target.checked); setPicks([]); }}
                className="h-4 w-4 rounded mt-0.5" style={{ accentColor: 'var(--sage)' }} />
              <span>
                <span className="text-sm font-semibold block" style={{ color: 'var(--txt)' }}>Let {teacherName} pick the final time</span>
                <span className="text-[11px]" style={{ color: 'var(--txt3)' }}>
                  {letTeacherChoose
                    ? `Propose up to 3 times; ${teacherName} confirms one and it's added then.`
                    : 'Off: the lesson is booked immediately at the time you choose.'}
                </span>
              </span>
            </label>
          </div>
        )}

        {!repeat && (
          <div>
            <label className="ui-label">Notes</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} className="ui-input" style={{ resize: 'vertical' }} />
          </div>
        )}

        {/* Repeat weekly — turns this into a recurring weekly booking (booked directly) */}
        <div className="rounded-xl border p-3" style={{ borderColor: repeat ? 'var(--sage)' : 'var(--bd)', background: repeat ? 'var(--sage-lt)' : 'transparent' }}>
          <label className="flex items-center gap-2.5 cursor-pointer">
            <input type="checkbox" checked={repeat} onChange={e => setRepeat(e.target.checked)}
              className="h-4 w-4 rounded" style={{ accentColor: 'var(--sage)' }} />
            <span className="text-sm font-semibold" style={{ color: 'var(--txt)' }}>Repeat weekly</span>
          </label>
          {repeat && (
            <div className="mt-3">
              <div className="flex items-center gap-2">
                <span className="text-sm shrink-0" style={{ color: 'var(--txt3)' }}>Book this slot</span>
                <div className="w-44">
                  <SearchableSelect
                    options={[
                      { value: 'ongoing', label: 'Ongoing (no end date)' },
                      { value: '1', label: 'Weekly (stop after 1 week)' },
                      { value: '4', label: 'Monthly (stop after 4 weeks)' },
                      // Not every student is on a term (adult learners often
                      // aren't) — only offered when there's an active term to
                      // reference, rather than forcing everyone through one.
                      ...(activeTerm ? [{ value: 'termly', label: `Termly (until ${activeTerm.name} ends)` }] : []),
                      { value: 'custom', label: 'Until a custom date' },
                    ]}
                    value={repeatWeeks} onChange={setRepeatWeeks}
                  />
                </div>
                {repeatWeeks === 'custom' && (
                  <input type="date" value={customEndDate} min={date}
                    onChange={e => setCustomEndDate(e.target.value)}
                    className="ui-input w-auto" style={{ width: 150 }} />
                )}
              </div>
              <p className="text-[11px] mt-1.5" style={{ color: 'var(--txt4)' }}>
                {repeatWeeks === 'ongoing'
                  ? 'Keeps booking every week automatically until someone cancels it.'
                  : repeatWeeks === 'custom'
                  ? (customEndDate ? `Books every week through ${customEndDate}, then stops on its own.` : 'Pick the last date this should book through.')
                  : repeatWeeks === 'termly'
                  ? (activeTerm ? `Books every week through ${activeTerm.endsOn} (end of ${activeTerm.name}), then stops on its own.` : 'No active term to book through.')
                  : repeatWeeks === '1'
                  ? 'Books just this one lesson, then stops on its own.'
                  : 'Books every week for the next 4 weeks, then stops on its own.'}
              </p>
            </div>
          )}
        </div>

        <div className="flex gap-3 pt-1">
          <button type="submit" disabled={saving} className="ui-btn-primary">
            {submitLabel}
          </button>
          <button type="button" onClick={onClose} className="ui-btn-ghost">Cancel</button>
        </div>
      </form>
      )}
    </Modal>
  );
}

// ─── New default lesson modal ─────────────────────────────────────────────────
// Quick-add shortcut: pick a student, resolve their active enrollment, and only
// ask for date/time — teacher, duration, and rate are taken from the enrollment.
function NewDefaultLessonModal({ open, onClose, onCreated, defaultDate, defaultTime }: {
  open: boolean; onClose: () => void; onCreated: () => void;
  defaultDate?: string; defaultTime?: string;
}) {
  const [studentsList, setStudentsList] = useState<Student[]>([]);
  const [studentId, setStudentId] = useState('');
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [enrollmentId, setEnrollmentId] = useState('');
  const [loadingEnrollments, setLoadingEnrollments] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const tok = () => document.cookie.match(/access_token=([^;]+)/)?.[1];

  useEffect(() => {
    if (!open) return;
    setStudentId(''); setEnrollments([]); setEnrollmentId(''); setError('');
    apiFetch<Student[]>('/students', { token: tok() }).then(setStudentsList).catch(() => {});
  }, [open]);

  useEffect(() => {
    if (!studentId) { setEnrollments([]); setEnrollmentId(''); return; }
    setLoadingEnrollments(true); setError('');
    apiFetch<StudentDetail>(`/students/${studentId}`, { token: tok() })
      .then(detail => {
        const active = detail.enrollments.filter(e => e.status === 'active');
        setEnrollments(active);
        setEnrollmentId(active.length === 1 ? active[0]!.id : '');
        if (active.length === 0) setError('This student has no active enrollment — use "Add lesson" instead.');
      })
      .catch(() => setError("Could not load this student's enrollments"))
      .finally(() => setLoadingEnrollments(false));
  }, [studentId]);

  const selectedEnrollment = enrollments.find(e => e.id === enrollmentId);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selectedEnrollment) { setError('Select a student with an active enrollment'); return; }
    setSaving(true); setError('');
    const f = new FormData(e.currentTarget);
    try {
      await apiFetch('/lessons', { method: 'POST', token: tok(), body: JSON.stringify({
        studentId, enrollmentId: selectedEnrollment.id,
        teacherId: selectedEnrollment.teacherId ?? undefined,
        startsAt: `${f.get('date')}T${f.get('time')}:00`,
        duration: selectedEnrollment.defaultDuration ?? 60,
      })});
      onCreated(); onClose();
    } catch (err) { setError(err instanceof Error ? err.message : 'Error'); }
    finally { setSaving(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title="New default lesson">
      {error && (
        <div className="mb-4 text-sm rounded-xl px-4 py-3"
          style={{ background: 'var(--coral-lt)', color: 'var(--coral)', border: '1px solid #FCA5A5' }}>
          {error}
        </div>
      )}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="ui-label">Student <span style={{ color: 'var(--coral)' }}>*</span></label>
          <SearchableSelect
            options={studentsList.map(s => ({ value: s.id, label: `${s.firstName} ${s.lastName}` }))}
            value={studentId} onChange={setStudentId} placeholder="Select student…"
          />
        </div>

        {studentId && loadingEnrollments && (
          <p className="text-sm" style={{ color: 'var(--txt4)' }}>Loading enrollments…</p>
        )}

        {studentId && enrollments.length > 1 && (
          <div>
            <label className="ui-label">Enrollment <span style={{ color: 'var(--coral)' }}>*</span></label>
            <div className="space-y-1.5">
              {enrollments.map(en => (
                <label key={en.id} className="flex items-center gap-2 text-sm rounded-xl px-3 py-2 border cursor-pointer"
                  style={{ borderColor: enrollmentId === en.id ? 'var(--sage)' : 'var(--bd)' }}>
                  <input type="radio" name="enrollment" checked={enrollmentId === en.id} onChange={() => setEnrollmentId(en.id)} />
                  <span className="capitalize font-medium">{en.instrument}</span>
                  <span style={{ color: 'var(--txt4)' }}>
                    · {en.defaultDuration ?? 60} min{en.groupName ? ` · ${en.groupName}` : ''}
                  </span>
                </label>
              ))}
            </div>
          </div>
        )}

        {selectedEnrollment && (
          <div className="rounded-xl px-3.5 py-2.5 text-sm" style={{ background: 'var(--surf)', border: '1px solid var(--bd)', color: 'var(--txt3)' }}>
            Will book a <strong className="capitalize" style={{ color: 'var(--txt)' }}>
              {selectedEnrollment.defaultDuration ?? 60}-min {selectedEnrollment.instrument}
            </strong> lesson at the enrollment&rsquo;s usual rate and teacher.
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="ui-label">Date <span style={{ color: 'var(--coral)' }}>*</span></label>
            <input name="date" type="date" required defaultValue={defaultDate} className="ui-input" />
          </div>
          <div>
            <label className="ui-label">Time <span style={{ color: 'var(--coral)' }}>*</span></label>
            <input name="time" type="time" required defaultValue={defaultTime ?? '16:00'} className="ui-input" />
          </div>
        </div>

        <div className="flex gap-3 pt-1">
          <button type="submit" disabled={saving || !selectedEnrollment} className="ui-btn-primary">
            {saving ? 'Saving…' : 'Add lesson'}
          </button>
          <button type="button" onClick={onClose} className="ui-btn-ghost">Cancel</button>
        </div>
      </form>
    </Modal>
  );
}

// ─── Lesson detail modal ──────────────────────────────────────────────────────
const PRIVATE_ATTENDANCE = [
  { status: 'present',           label: 'Present', hint: 'Lesson happened as scheduled.' },
  { status: 'absent_makeup',     label: 'Cancelled ≥24h notice', hint: 'No charge — makeup credit issued, teacher not paid.' },
  { status: 'absent_no_makeup',  label: 'Cancelled <24h notice', hint: 'Family is charged, no credit given, teacher is still paid.' },
  { status: 'absent_no_pay',     label: 'Excused (no charge)', hint: 'No charge, no credit, teacher not paid — e.g. studio-approved exception.' },
  { status: 'cancelled_teacher', label: 'Teacher cancelled', hint: 'No charge to the family, teacher not paid for this slot.' },
] as const;
const GROUP_ATTENDANCE = [
  { status: 'present',           label: 'Present', hint: 'Lesson happened as scheduled.' },
  { status: 'absent_no_pay',     label: 'Absent', hint: 'No charge, no credit, teacher not paid.' },
  { status: 'cancelled_teacher', label: 'Cancelled', hint: 'No charge to the family, teacher not paid for this slot.' },
] as const;

const PAYMENT_LABEL: Record<string, { label: string; color: string }> = {
  paid:     { label: 'Paid',            color: 'var(--sage-dk)' },
  unpaid:   { label: 'Unpaid',          color: 'var(--coral)' },
  void:     { label: 'Voided invoice',  color: 'var(--txt4)' },
  unbilled: { label: 'Not yet billed',  color: 'var(--txt4)' },
};

function LessonDetailModal({ lesson, open, onClose, onUpdated, readOnly = false, canManage = false, staffOptions = [] }: {
  lesson: Lesson | null; open: boolean; onClose: () => void; onUpdated: () => void;
  // When a teacher is viewing another teacher's lesson from the whole-studio
  // calendar: the schedule is visible but attendance/reschedule/cancel are not
  // theirs to touch (the API would refuse anyway — this just hides dead buttons).
  readOnly?: boolean;
  // Admin/receptionist+ only — teachers can't reassign lessons, so the
  // substitute picker only renders for roles that can actually call it.
  canManage?: boolean;
  staffOptions?: StaffMember[];
}) {
  const [saving, setSaving] = useState(false);
  const [showReschedule, setShowReschedule] = useState(false);
  const [newDate, setNewDate] = useState('');
  const [newTime, setNewTime] = useState('');
  const [applyToSeries, setApplyToSeries] = useState(false);
  const [seriesFromMode, setSeriesFromMode] = useState<'now' | 'custom'>('now');
  const [seriesFromDate, setSeriesFromDate] = useState('');
  const [actionError, setActionError] = useState('');
  const [showSub, setShowSub] = useState(false);
  const [subTeacherId, setSubTeacherId] = useState('');
  const [showClone, setShowClone] = useState(false);
  const [cloneDate, setCloneDate] = useState('');
  const [cloneTime, setCloneTime] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [deleteSeries, setDeleteSeries] = useState(false);
  const [deleteScope, setDeleteScope] = useState<'all' | 'until'>('all');
  const [deleteUntilDate, setDeleteUntilDate] = useState('');
  const [sendingInvoice, setSendingInvoice] = useState(false);
  const [invoiceSent, setInvoiceSent] = useState(false);
  const tok = () => document.cookie.match(/access_token=([^;]+)/)?.[1];

  useEffect(() => {
    setShowReschedule(false); setActionError(''); setShowSub(false); setSubTeacherId(''); setShowClone(false);
    setApplyToSeries(false); setSeriesFromMode('now'); setSeriesFromDate('');
    setShowDelete(false); setDeleteSeries(false); setDeleteScope('all'); setDeleteUntilDate('');
    setInvoiceSent(false);
    if (lesson) {
      // Prefill date + time in the studio zone so they match what's shown elsewhere
      // and round-trip correctly (the backend interprets the naive value as studio-local).
      setNewDate(studioDayString(lesson.startsAt));
      setNewTime(fmtTime(lesson.startsAt));
      // Clone defaults to the same weekday/time, one week on.
      const nextWeek = new Date(lesson.startsAt);
      nextWeek.setDate(nextWeek.getDate() + 7);
      setCloneDate(studioDayString(nextWeek));
      setCloneTime(fmtTime(lesson.startsAt));
    }
  }, [lesson?.id]);

  if (!lesson) return null;

  async function markAttendance(status: string) {
    setSaving(true);
    try {
      await apiFetch(`/lessons/${lesson!.id}/attendance`, { method: 'POST', token: tok(), body: JSON.stringify({ status }) });
      onUpdated(); onClose();
    } catch (e) { console.error(e); } finally { setSaving(false); }
  }

  async function cancelLesson() {
    const who = lesson!.student ? `${lesson!.student.firstName} ${lesson!.student.lastName}'s` : 'this';
    if (!confirm(`Cancel ${who} lesson on ${fmtDate(lesson!.startsAt)} at ${fmtTime(lesson!.startsAt)}? This removes it from the calendar with no charge to the family and no pay to the teacher. It can't be undone from here — you'd need to book it again.`)) return;
    setSaving(true); setActionError('');
    try {
      await apiFetch(`/lessons/${lesson!.id}/cancel`, {
        method: 'POST', token: tok(), body: JSON.stringify({ reason: 'cancelled_teacher' }),
      });
      onUpdated(); onClose();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Could not cancel lesson');
    } finally { setSaving(false); }
  }

  async function sendInvoiceForLesson() {
    if (!lesson!.student) return;
    setSendingInvoice(true); setActionError('');
    try {
      const student = await apiFetch<{ familyId: string }>(`/students/${lesson!.student.id}`, { token: tok() });
      const day = studioDayString(lesson!.startsAt);
      const inv = await apiFetch<{ id: string }>('/invoices', {
        method: 'POST', token: tok(),
        body: JSON.stringify({ familyId: student.familyId, mode: 'per_lesson', itemizeLessons: true, periodStart: day, periodEnd: day }),
      });
      await apiFetch(`/invoices/${inv.id}/send`, { method: 'POST', token: tok() });
      setInvoiceSent(true);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Could not send invoice');
    } finally { setSendingInvoice(false); }
  }

  async function reinstateLesson() {
    setSaving(true); setActionError('');
    try {
      await apiFetch(`/lessons/${lesson!.id}/reinstate`, { method: 'POST', token: tok() });
      onUpdated(); onClose();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Could not reinstate lesson');
    } finally { setSaving(false); }
  }

  async function assignSubstitute() {
    if (!subTeacherId) return;
    setSaving(true); setActionError('');
    try {
      await apiFetch(`/lessons/${lesson!.id}`, {
        method: 'PATCH', token: tok(), body: JSON.stringify({ teacherId: subTeacherId }),
      });
      onUpdated(); onClose();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Could not assign substitute — check they\'re free at this time');
    } finally { setSaving(false); }
  }

  async function rescheduleLesson() {
    if (!newDate || !newTime) return;
    if (applyToSeries && seriesFromMode === 'custom' && !seriesFromDate) {
      setActionError('Pick a date for the change to take effect from, or choose "From now" instead.');
      return;
    }
    setSaving(true); setActionError('');
    try {
      if (applyToSeries && lesson!.enrollmentId) {
        // Same weekly-move mechanism as the student profile's "Reschedule"
        // action — the new date's weekday becomes the series' new weekday.
        const weekday = WEEKDAY_KEYS[(new Date(`${newDate}T12:00:00Z`).getUTCDay() + 6) % 7];
        await apiFetch(`/enrollments/${lesson!.enrollmentId}/reschedule-weekly`, {
          method: 'PATCH', token: tok(), body: JSON.stringify({
            weekday, startTime: newTime,
            effectiveFrom: seriesFromMode === 'custom' ? seriesFromDate : undefined,
          }),
        });
      } else {
        await apiFetch(`/lessons/${lesson!.id}/reschedule`, {
          method: 'POST', token: tok(), body: JSON.stringify({ startsAt: `${newDate}T${newTime}:00` }),
        });
      }
      onUpdated(); onClose();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Could not reschedule lesson');
    } finally { setSaving(false); }
  }

  async function cloneLessonToDate() {
    if (!cloneDate || !cloneTime) return;
    setSaving(true); setActionError('');
    try {
      await apiFetch(`/lessons/${lesson!.id}/clone`, {
        method: 'POST', token: tok(), body: JSON.stringify({ startsAt: `${cloneDate}T${cloneTime}:00` }),
      });
      onUpdated(); onClose();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Could not clone lesson');
    } finally { setSaving(false); }
  }

  async function deleteLessonHard() {
    const who = lesson!.student ? `${lesson!.student.firstName} ${lesson!.student.lastName}'s` : 'this';
    if (!confirm(`Permanently delete ${who} lesson on ${fmtDate(lesson!.startsAt)} at ${fmtTime(lesson!.startsAt)}? This removes it entirely — unlike Cancel, there's no record left and no undo.`)) return;
    setDeleting(true); setActionError('');
    try {
      await apiFetch(`/lessons/${lesson!.id}`, { method: 'DELETE', token: tok() });
      onUpdated(); onClose();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Could not delete lesson');
    } finally { setDeleting(false); }
  }

  async function deleteLessonSeriesAction() {
    if (deleteScope === 'until' && !deleteUntilDate) {
      setActionError('Pick an end date, or choose "All future lessons" instead.');
      return;
    }
    const who = lesson!.student ? `${lesson!.student.firstName} ${lesson!.student.lastName}'s` : 'this';
    const scopeLabel = deleteScope === 'all'
      ? 'this lesson and every future lesson in the series'
      : `this lesson and every future lesson in the series up to ${deleteUntilDate}`;
    if (!confirm(`Permanently delete ${scopeLabel} for ${who} enrolment? This also ends the recurring series there — no more lessons will be generated for it. There's no undo.`)) return;
    setDeleting(true); setActionError('');
    try {
      const qs = deleteScope === 'until' ? `?until=${deleteUntilDate}` : '';
      await apiFetch<{ deleted: number; skipped: number }>(`/lessons/${lesson!.id}/series${qs}`, { method: 'DELETE', token: tok() });
      onUpdated(); onClose();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Could not delete series');
    } finally { setDeleting(false); }
  }

  const instr = lesson.enrollment?.instrument;
  const isGrp = lesson.enrollment?.lessonType === 'group';
  const actions = isGrp ? GROUP_ATTENDANCE : PRIVATE_ATTENDANCE;
  const isSub = !!lesson.enrollment?.teacherId && !!lesson.teacher && lesson.enrollment.teacherId !== lesson.teacher.id;
  const normalTeacher = staffOptions.find(s => s.id === lesson.enrollment?.teacherId);
  const payment = lesson.paymentStatus ? PAYMENT_LABEL[lesson.paymentStatus] : null;
  const canSub = canManage && !readOnly && (lesson.status === 'scheduled' || lesson.status === 'makeup');

  return (
    <Modal open={open} onClose={onClose} title="Lesson details">
      <div className="space-y-4">
        {/* Quick actions — icon-only, tooltip on hover. Clone/Edit/Delete all
            work regardless of whether the lesson is in the past, today, or
            upcoming; Delete refuses server-side once anything (attendance, a
            bill) actually depends on the row. */}
        {!readOnly && (
          <div className="flex items-center gap-1 -mt-1 -mb-1">
            <button onClick={() => { setShowClone(false); setShowDelete(false); setShowReschedule(v => !v); }} disabled={saving || deleting}
              title="Edit date & time" aria-label="Edit date & time"
              className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors hover:bg-[var(--surf)] disabled:opacity-40"
              style={{ color: showReschedule ? 'var(--sage)' : 'var(--txt3)' }}>
              <Pencil size={15} />
            </button>
            <button onClick={() => { setShowReschedule(false); setShowDelete(false); setShowClone(v => !v); }} disabled={saving || deleting}
              title="Clone to another date" aria-label="Clone to another date"
              className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors hover:bg-[var(--surf)] disabled:opacity-40"
              style={{ color: showClone ? 'var(--sage)' : 'var(--txt3)' }}>
              <Copy size={15} />
            </button>
            <button onClick={() => { setShowReschedule(false); setShowClone(false); setShowDelete(v => !v); }} disabled={saving || deleting}
              title="Delete permanently" aria-label="Delete permanently"
              className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors hover:bg-[var(--coral-lt)] disabled:opacity-40"
              style={{ color: showDelete ? 'var(--coral)' : 'var(--txt3)' }}>
              <Trash2 size={15} />
            </button>
            {canManage && lesson.student && (
              <button onClick={sendInvoiceForLesson} disabled={saving || deleting || sendingInvoice || invoiceSent}
                title={invoiceSent ? 'Invoice sent' : 'Send invoice for this lesson'} aria-label="Send invoice for this lesson"
                className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors hover:bg-[var(--surf)] disabled:opacity-40"
                style={{ color: invoiceSent ? 'var(--sage)' : 'var(--txt3)' }}>
                {invoiceSent ? <Check size={15} /> : <Send size={15} />}
              </button>
            )}
          </div>
        )}

        {!readOnly && showReschedule && (
          <div className="rounded-xl p-3.5 space-y-3" style={{ background: 'var(--surf)', border: '1px solid var(--bd)' }}>
            <p className="text-sm font-semibold flex items-center gap-1.5" style={{ color: 'var(--txt2)' }}>
              Reschedule to
              <InfoTooltip text="We'll check the new time is free and inside the teacher's working hours — so you can't accidentally double-book a teacher, or pick a time they're unavailable." />
            </p>
            <div className="grid grid-cols-2 gap-3">
              <input type="date" value={newDate} onChange={e => setNewDate(e.target.value)} className="ui-input" />
              <input type="time" value={newTime} onChange={e => setNewTime(e.target.value)} className="ui-input" />
            </div>
            {lesson.enrollmentId && (
              <div className="space-y-2 pt-1 border-t" style={{ borderColor: 'var(--bd)' }}>
                <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--txt2)' }}>
                  <input type="checkbox" checked={applyToSeries} onChange={e => setApplyToSeries(e.target.checked)} />
                  Apply this day/time to all future lessons in this series too
                </label>
                {applyToSeries && (
                  <div className="pl-6 space-y-2">
                    <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--txt3)' }}>
                      <input type="radio" checked={seriesFromMode === 'now'} onChange={() => setSeriesFromMode('now')} />
                      From now
                    </label>
                    <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--txt3)' }}>
                      <input type="radio" checked={seriesFromMode === 'custom'} onChange={() => setSeriesFromMode('custom')} />
                      From a custom date
                    </label>
                    {seriesFromMode === 'custom' && (
                      <input type="date" value={seriesFromDate} onChange={e => setSeriesFromDate(e.target.value)} className="ui-input" style={{ width: 160 }} />
                    )}
                  </div>
                )}
              </div>
            )}
            <div className="flex gap-2">
              <button onClick={rescheduleLesson} disabled={saving} className="ui-btn-primary text-sm">
                {saving ? 'Saving…' : 'Confirm reschedule'}
              </button>
              <button onClick={() => setShowReschedule(false)} className="ui-btn-ghost text-sm">Cancel</button>
            </div>
          </div>
        )}

        {!readOnly && showClone && (
          <div className="rounded-xl p-3.5 space-y-3" style={{ background: 'var(--surf)', border: '1px solid var(--bd)' }}>
            <p className="text-sm font-semibold" style={{ color: 'var(--txt2)' }}>Clone to</p>
            <div className="grid grid-cols-2 gap-3">
              <input type="date" value={cloneDate} onChange={e => setCloneDate(e.target.value)} className="ui-input" />
              <input type="time" value={cloneTime} onChange={e => setCloneTime(e.target.value)} className="ui-input" />
            </div>
            <div className="flex gap-2">
              <button onClick={cloneLessonToDate} disabled={saving} className="ui-btn-primary text-sm">
                {saving ? 'Cloning…' : 'Create clone'}
              </button>
              <button onClick={() => setShowClone(false)} className="ui-btn-ghost text-sm">Cancel</button>
            </div>
            <p className="text-[11px]" style={{ color: 'var(--txt4)' }}>
              Creates a new lesson with the same student, teacher and duration — this one is untouched.
            </p>
          </div>
        )}

        {!readOnly && showDelete && (
          <div className="rounded-xl p-3.5 space-y-3" style={{ background: 'var(--coral-lt)', border: '1px solid #FCA5A5' }}>
            <p className="text-sm font-semibold" style={{ color: 'var(--txt2)' }}>Delete permanently</p>
            {lesson.enrollmentId && (
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--txt2)' }}>
                  <input type="checkbox" checked={deleteSeries} onChange={e => setDeleteSeries(e.target.checked)} />
                  Also delete future lessons in this series
                </label>
                {deleteSeries && (
                  <div className="pl-6 space-y-2">
                    <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--txt3)' }}>
                      <input type="radio" checked={deleteScope === 'all'} onChange={() => setDeleteScope('all')} />
                      All future lessons
                    </label>
                    <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--txt3)' }}>
                      <input type="radio" checked={deleteScope === 'until'} onChange={() => setDeleteScope('until')} />
                      Until a custom date
                    </label>
                    {deleteScope === 'until' && (
                      <input type="date" value={deleteUntilDate} onChange={e => setDeleteUntilDate(e.target.value)} className="ui-input" style={{ width: 160 }} />
                    )}
                    <p className="text-[11px]" style={{ color: 'var(--txt3)' }}>
                      This ends the recurring series {deleteScope === 'all' ? 'at this lesson' : 'on that date'} — it won&apos;t keep generating new lessons past that point.
                    </p>
                  </div>
                )}
              </div>
            )}
            <div className="flex gap-2">
              <button onClick={deleteSeries ? deleteLessonSeriesAction : deleteLessonHard} disabled={saving || deleting}
                className="text-sm rounded-[9px] px-3 py-2 font-semibold transition-colors disabled:opacity-50"
                style={{ border: '1.5px solid var(--coral)', color: '#fff', background: 'var(--coral)' }}>
                {deleting ? 'Deleting…' : deleteSeries ? 'Delete series' : 'Delete just this lesson'}
              </button>
              <button onClick={() => setShowDelete(false)} className="ui-btn-ghost text-sm">Cancel</button>
            </div>
          </div>
        )}

        {/* Detail block */}
        <div className="rounded-xl p-4 space-y-2.5 text-sm"
          style={{ background: 'var(--surf)', border: '1px solid var(--bd)' }}>
          <div className="flex justify-between items-start gap-4">
            <span className="shrink-0" style={{ color: 'var(--txt3)' }}>Date &amp; time</span>
            <span className="font-semibold text-right">
              {fmtDate(lesson.startsAt, { weekday: 'long', day: 'numeric', month: 'long' })}
              {', '}{fmtTime(lesson.startsAt)} – {fmtTimeEnd(lesson.startsAt, lesson.duration)}
            </span>
          </div>
          <div className="flex justify-between">
            <span style={{ color: 'var(--txt3)' }}>Duration</span>
            <span className="font-medium">{lesson.duration} min</span>
          </div>
          <div className="flex justify-between">
            <span style={{ color: 'var(--txt3)' }}>Student</span>
            <span className="font-medium">{lesson.student?.firstName} {lesson.student?.lastName}</span>
          </div>
          {instr && (
            <div className="flex justify-between items-center">
              <span style={{ color: 'var(--txt3)' }}>Instrument</span>
              <span className="flex items-center gap-2 font-medium capitalize">
                <span style={{ color: instrColor(instr) }}>{instr}</span>
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${isGrp ? 'bg-blue-100 text-blue-700' : 'bg-[var(--sage-lt)] text-[var(--sage)]'}`}>
                  {isGrp ? 'Group' : 'Private'}
                </span>
              </span>
            </div>
          )}
          {isGrp && lesson.enrollment?.groupName && (
            <div className="flex justify-between">
              <span style={{ color: 'var(--txt3)' }}>Group</span>
              <span className="font-medium">{lesson.enrollment.groupName}</span>
            </div>
          )}
          <div className="flex justify-between items-start gap-4">
            <span className="shrink-0" style={{ color: 'var(--txt3)' }}>Teacher</span>
            <span className="text-right">
              <span className="font-medium">{lesson.teacher ? `${lesson.teacher.firstName} ${lesson.teacher.lastName}` : '—'}</span>
              {isSub && (
                <span className="flex items-center justify-end gap-1 text-[11px] mt-0.5" style={{ color: 'var(--txt4)' }}>
                  <Shuffle size={11} /> covering for {normalTeacher ? `${normalTeacher.firstName} ${normalTeacher.lastName}` : 'usual teacher'}
                </span>
              )}
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span style={{ color: 'var(--txt3)' }}>Status</span>
            <Badge variant={lesson.status}>{lessonStatusLabel(lesson.status)}</Badge>
          </div>
          {payment && (
            <div className="flex justify-between items-center">
              <span style={{ color: 'var(--txt3)' }}>Payment</span>
              <span className="font-semibold flex items-center gap-1" style={{ color: payment.color }}>
                <PoundSterling size={12} /> {payment.label}
              </span>
            </div>
          )}
          {lesson.attendance && (
            <div className="flex justify-between items-center">
              <span style={{ color: 'var(--txt3)' }}>Attendance</span>
              <Badge variant={lesson.attendance.status}>{attendanceStatusLabel(lesson.attendance.status)}</Badge>
            </div>
          )}
        </div>

        {readOnly && (
          <p className="text-[12px] rounded-xl px-3.5 py-2.5" style={{ background: 'var(--surf)', color: 'var(--txt3)', border: '1px solid var(--bd)' }}>
            You&apos;re viewing another teacher&apos;s lesson. Only {lesson.teacher ? `${lesson.teacher.firstName} ${lesson.teacher.lastName}` : 'its teacher'} or the office can change it.
          </p>
        )}

        {!readOnly && lesson.status === 'scheduled' && (
          <div>
            <p className="text-sm font-semibold mb-2" style={{ color: 'var(--txt2)' }}>Mark attendance</p>
            <div className="grid grid-cols-1 gap-2">
              {actions.map(a => (
                <button key={a.status} onClick={() => markAttendance(a.status)} disabled={saving}
                  className="text-left text-sm rounded-[9px] px-3 py-2 transition-colors disabled:opacity-50"
                  style={{ border: '1.5px solid var(--bd2)', color: 'var(--txt2)', background: '#fff' }}
                  onMouseOver={e => (e.currentTarget.style.background = 'var(--surf)')}
                  onMouseOut={e => (e.currentTarget.style.background = '#fff')}>
                  <span className="font-medium block">{a.label}</span>
                  <span className="text-[11px] block mt-0.5" style={{ color: 'var(--txt4)' }}>{a.hint}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {canSub && (
          <div>
            {showSub ? (
              <div className="rounded-xl p-3.5 space-y-3" style={{ background: 'var(--surf)', border: '1px solid var(--bd)' }}>
                <p className="text-sm font-semibold" style={{ color: 'var(--txt2)' }}>Cover with a substitute teacher</p>
                <SearchableSelect
                  value={subTeacherId}
                  onChange={setSubTeacherId}
                  options={staffOptions.filter(s => s.id !== lesson.teacher?.id).map(s => ({ value: s.id, label: `${s.firstName} ${s.lastName}` }))}
                  placeholder="Choose a substitute…"
                />
                <div className="flex gap-2">
                  <button onClick={assignSubstitute} disabled={saving || !subTeacherId} className="ui-btn-primary text-sm">
                    {saving ? 'Saving…' : 'Assign substitute'}
                  </button>
                  <button onClick={() => setShowSub(false)} className="ui-btn-ghost text-sm">Cancel</button>
                </div>
                <p className="text-[11px]" style={{ color: 'var(--txt4)' }}>
                  This changes the teacher for just this one lesson — it won&apos;t affect the student&apos;s regular enrolment or future lessons.
                </p>
              </div>
            ) : (
              <button onClick={() => setShowSub(true)} disabled={saving}
                className="ui-btn-ghost text-sm w-full flex items-center justify-center gap-1.5 disabled:opacity-50">
                <Shuffle size={14} /> Assign a substitute teacher
              </button>
            )}
          </div>
        )}

        {actionError && (
          <div className="text-sm rounded-xl px-4 py-3"
            style={{ background: 'var(--coral-lt)', color: 'var(--coral)', border: '1px solid #FCA5A5' }}>
            {actionError}
          </div>
        )}

        {!readOnly && !showReschedule && !showClone && !showDelete && lesson.status === 'scheduled' && (
          <div className="flex gap-2">
            <button onClick={() => setShowReschedule(true)} disabled={saving}
              className="ui-btn-ghost text-sm flex-1 disabled:opacity-50">
              Reschedule
            </button>
            <button onClick={cancelLesson} disabled={saving}
              className="text-sm flex-1 rounded-[9px] px-3 py-2 font-semibold transition-colors disabled:opacity-50"
              style={{ border: '1.5px solid var(--coral)', color: 'var(--coral)', background: '#fff' }}>
              Cancel lesson
            </button>
          </div>
        )}

        {!readOnly && lesson.status.startsWith('cancelled_') && !lesson.attendance && (
          <div>
            <button onClick={reinstateLesson} disabled={saving}
              className="text-sm w-full rounded-[9px] px-3 py-2 font-semibold transition-colors disabled:opacity-50"
              style={{ border: '1.5px solid var(--sage-md)', color: 'var(--sage-dk)', background: 'var(--sage-lt)' }}>
              {saving ? 'Reinstating…' : 'Reinstate lesson'}
            </button>
            <p className="text-[11px] mt-1.5 text-center" style={{ color: 'var(--txt4)' }}>
              Puts this cancelled lesson back on the calendar (we&apos;ll re-check the slot is free).
            </p>
          </div>
        )}

        {lesson.notes && (
          <p className="text-sm italic rounded-xl p-3.5"
            style={{ color: 'var(--txt3)', background: 'var(--surf)', border: '1px solid var(--bd)' }}>
            &ldquo;{lesson.notes}&rdquo;
          </p>
        )}
      </div>
    </Modal>
  );
}

// ─── Main calendar page ───────────────────────────────────────────────────────
export default function CalendarPage() {
  const [view, setView] = useState<'week' | 'day' | 'month'>('week');
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const viewMenuRef = useRef<HTMLDivElement>(null);
  // Month view renders all 6 weeks and lets the browser scroll — with today
  // late in the month that means landing on the top row and scrolling down
  // every single time. Jump straight to today's row (still scrollable up to
  // see earlier weeks) whenever month view starts showing the current month.
  const todayCellRef = useRef<HTMLButtonElement>(null);
  const [anchorDate, setAnchorDate] = useState(() => new Date());
  const [showAdd, setShowAdd] = useState(false);
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [showAssign, setShowAssign] = useState(false);
  const [slotDate, setSlotDate] = useState<string | undefined>();
  const [slotTime, setSlotTime] = useState<string | undefined>();
  const [selectedLesson, setSelectedLesson] = useState<Lesson | null>(null);
  const tok = () => document.cookie.match(/access_token=([^;]+)/)?.[1];

  const weekStart = getWeekStart(anchorDate);
  const role = useRole();
  // "Assign students" / "Add student" are front-desk tasks — only management
  // roles get them. Teachers, and any parent/student who lands here, do not.
  const isManagement = role === 'admin';

  // Whole-studio view. Management always sees everyone; a teacher normally sees
  // only their own lessons but can opt in to the full schedule (read-only for
  // other teachers' lessons — see the `scope=all` handling on the API).
  const [wholeStudio, setWholeStudio] = useState(false);
  const teacherEveryone = role === 'teacher' && wholeStudio;
  // Filters, applied client-side so the dropdowns keep their full option lists
  // rather than collapsing to whatever is currently selected.
  const [filterTeacherId, setFilterTeacherId] = useState<string>('');
  const [filterStudentId, setFilterStudentId] = useState<string>('');
  const [filterInstrument, setFilterInstrument] = useState<string>('');
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const sortMenuRef = useRef<HTMLDivElement>(null);
  const orgInstruments = useInstruments();
  const pendingBadges = usePendingBadges();

  // The visible date range: week/day both page by week; month spans the whole
  // 6-week grid so lessons that fall on the leading/trailing days still show.
  const monthGrid = getMonthGrid(anchorDate);
  const monthShowsToday =
    monthGrid.monthStart.getFullYear() === new Date().getFullYear() &&
    monthGrid.monthStart.getMonth() === new Date().getMonth();
  // Depend on the month/year, not the monthGrid object (a fresh Date each
  // render) — otherwise this would re-fire on every lesson refetch and yank
  // the view back down while someone's mid-scroll reading an earlier week.
  useEffect(() => {
    if (view === 'month' && monthShowsToday) {
      todayCellRef.current?.scrollIntoView({ block: 'nearest' });
    }
  }, [view, monthShowsToday]);
  const lessonsQuery = (() => {
    const p = new URLSearchParams();
    if (view === 'month') {
      p.set('from', formatDate(monthGrid.gridStart));
      p.set('to', formatDate(monthGrid.gridEnd));
    } else {
      p.set('weekStart', formatDate(weekStart));
    }
    if (teacherEveryone) p.set('scope', 'all');
    return `/lessons?${p.toString()}`;
  })();

  // Cached reads — keyed by the query, so paging back to a week/month you've
  // already seen is instant. load() refreshes after a create/reschedule/cancel.
  const { data: lessonsRaw = [], mutate } = useApi<Lesson[]>(lessonsQuery);
  const load = () => mutate();

  // Half-term/holiday exception weeks don't block booking — students and
  // teachers sometimes arrange makeup lessons over a break — but the calendar
  // still marks them off visually (diagonal stripes + label) as a warning
  // that the studio doesn't normally run classes that week.
  const { data: allTerms = [] } = useApi<{ id: string; name: string; exceptionWeeks: { start: string; end: string }[] }[]>('/terms');
  function exceptionLabel(dStr: string): string | null {
    for (const t of allTerms) {
      for (const ex of t.exceptionWeeks ?? []) {
        if (dStr >= ex.start && dStr <= ex.end) return `${t.name} — half term break`;
      }
    }
    return null;
  }

  // Staff for colours + the teacher filter. Management gets the full record;
  // a teacher opting into the whole studio gets a names-only roster; otherwise
  // just themselves. `/staff/me` is fetched separately so we always know the
  // signed-in teacher's own id, which decides what they can edit vs only view.
  //
  // `role` is '' for one render after mount (useRole() is SSR-safe by design —
  // see its own comment). `role !== 'teacher'` was true during that window for
  // every viewer, so a teacher or receptionist's very first render fetched the
  // manager-only '/staff' and '/staff/availability/all' and got a 403 before
  // self-correcting one render later. Wait for role to resolve instead.
  const staffEndpoint = !role ? null : role !== 'teacher' ? '/staff' : wholeStudio ? '/staff/roster' : '/staff/me';
  const { data: staffRaw } = useApi<StaffMember | StaffMember[] | null>(staffEndpoint);
  const staff = Array.isArray(staffRaw) ? staffRaw : staffRaw ? [staffRaw] : [];
  const { data: meRaw } = useApi<StaffMember | null>(role === 'teacher' ? '/staff/me' : null);
  const myStaffId = meRaw?.id ?? null;
  const availabilityEndpoint = !role ? null : role === 'teacher' ? '/staff/me/availability' : '/staff/availability/all';
  const { data: availability = [] } = useApi<Availability[]>(availabilityEndpoint);

  // Full roster for the student filter — independent of whatever week/month is
  // currently loaded, so a student with no lessons in the visible range can
  // still be found (this is the whole point of the filter).
  const showFilters = isManagement || teacherEveryone;
  const { data: allStudents = [] } = useApi<Student[]>(showFilters ? '/students' : null);

  // When a student filter is picked, fetch THEIR lessons unbounded by date so
  // we can jump the calendar to wherever their lesson actually is, rather than
  // only ever finding them if they happen to have a lesson in the week/month
  // that's already on screen.
  const { data: filterStudentLessons } = useApi<Lesson[]>(
    filterStudentId ? `/lessons?studentId=${filterStudentId}` : null,
  );
  useEffect(() => {
    if (!filterStudentId || !filterStudentLessons || filterStudentLessons.length === 0) return;
    const todayMs = Date.now();
    const upcoming = filterStudentLessons
      .filter(l => l.status === 'scheduled' && new Date(l.startsAt).getTime() >= todayMs)
      .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())[0];
    const nearest = upcoming ?? [...filterStudentLessons].sort(
      (a, b) => new Date(b.startsAt).getTime() - new Date(a.startsAt).getTime(),
    )[0];
    if (!nearest) return;
    const nearestDate = new Date(nearest.startsAt);
    // Only jump if the found lesson actually falls outside what's currently
    // loaded — otherwise this would fight the user paging around normally.
    const inView = view === 'month'
      ? nearestDate >= monthGrid.gridStart && nearestDate <= monthGrid.gridEnd
      : nearestDate >= weekStart && nearestDate < new Date(weekStart.getTime() + 7 * 86400000);
    if (!inView) setAnchorDate(nearestDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterStudentId, filterStudentLessons]);

  // Apply the teacher/student/instrument filters once, up front — everything
  // downstream (day columns, week grid, month cells, counts) reads this
  // narrowed set.
  const lessons = lessonsRaw.filter(l =>
    (!filterTeacherId || (l.teacher?.id ?? '') === filterTeacherId) &&
    (!filterStudentId || (l.student?.id ?? '') === filterStudentId) &&
    (!filterInstrument || (l.enrollment?.instrument ?? '') === filterInstrument),
  );

  // Student options for the filter — the full roster, not just whoever has a
  // lesson in the currently loaded week/month, so a student can be found no
  // matter which day their lesson actually falls on.
  const studentOptions = allStudents
    .map(s => ({ id: s.id, name: `${s.firstName} ${s.lastName}` }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Recompute the per-teacher colour map whenever the staff set changes.
  // teacherColorMap itself is a plain module-level object (read by LessonBlock
  // and other non-hook helpers scattered through this file), so mutating it
  // alone doesn't trigger a re-render — the very first paint runs before
  // `staff` has loaded, shows every teacher via the id-hash fallback colour
  // (e.g. Dunni as red instead of her named brown), and stays wrong until some
  // unrelated state change happens to force a re-render. Bumping this counter
  // right after the mutation is what actually makes the correct colours paint.
  const staffIdsKey = staff.map(s => s.id).join(',');
  const [, forceColorRepaint] = useState(0);
  useEffect(() => {
    setTeacherColorMap(staff);
    forceColorRepaint(v => v + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staffIdsKey]);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      const target = e.target as Node;
      // The Teacher/Student/Instrument selects inside the Sort panel portal
      // their dropdown to document.body (see searchable-select.tsx), so a
      // click on one of their options lands OUTSIDE sortMenuRef's DOM
      // subtree even though it's visually inside the panel — without this
      // check the click closed (and unmounted) the whole Sort panel on
      // mousedown, before the option's onClick ever fired, so picking a
      // filter silently did nothing.
      if ((target as Element).closest?.('[data-searchable-select-menu]')) return;
      if (viewMenuRef.current && !viewMenuRef.current.contains(target)) setViewMenuOpen(false);
      if (sortMenuRef.current && !sortMenuRef.current.contains(target)) setSortMenuOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  function goToday() { setAnchorDate(new Date()); if (view === 'month') return; setView('day'); }
  function step(deltaDays: number) {
    const d = new Date(anchorDate);
    d.setDate(d.getDate() + deltaDays);
    setAnchorDate(d);
  }
  // Prev/next honours the current view: a day at a time, a week, or a month.
  function stepPeriod(dir: -1 | 1) {
    if (view === 'month') {
      const d = new Date(anchorDate);
      d.setMonth(d.getMonth() + dir, 1);
      setAnchorDate(d);
    } else {
      step(dir * (view === 'day' ? 1 : 7));
    }
  }

  function openSlot(dayIndex: number, hour: number) {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + dayIndex);
    setSlotDate(formatDate(d));
    setSlotTime(`${String(hour).padStart(2, '0')}:00`);
    setShowAdd(true);
  }
  function openSlotForDay(hour: number) {
    setSlotDate(formatDate(anchorDate));
    setSlotTime(`${String(hour).padStart(2, '0')}:00`);
    setShowAdd(true);
  }

  // Group lessons by day index (0=Mon … 6=Sun) — week view
  function dayLessons(dayIndex: number): Lesson[] {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + dayIndex);
    const dayStr = studioDayString(d);
    return lessons.filter(l => studioDayString(l.startsAt) === dayStr);
  }

  // Lessons for a specific teacher on the anchor day — day view
  function teacherDayLessons(teacherId: string | null): Lesson[] {
    const dayStr = studioDayString(anchorDate);
    return lessons.filter(l => studioDayString(l.startsAt) === dayStr && (l.teacher?.id ?? null) === teacherId);
  }

  // Week view: "someone is available" bands for a given weekday column —
  // merged across every teacher for the ambient/unfiltered view, but scoped
  // to just that one teacher's own windows once the teacher filter is set
  // (previously stayed merged even with one teacher picked, so filtering to
  // e.g. Dunni still showed everyone else's hours blended into hers).
  function weekAvailabilityBands(dayIndex: number): { top: number; height: number }[] {
    const key = WEEKDAY_KEYS[dayIndex];
    const wins = filterTeacherId
      ? availability.filter(a => a.staffId === filterTeacherId && a.weekday === key)
      : availability.filter(a => a.weekday === key);
    return mergeWindows(wins)
      .map(([s, e]) => elasticBandBox(s, e, weekHourHeights, weekOffsets))
      .filter((b): b is { top: number; height: number } => b !== null);
  }

  // Day view: a single teacher's availability windows for the anchor day's weekday.
  function teacherAvailabilityBands(teacherId: string | null): { top: number; height: number }[] {
    if (!teacherId) return [];
    // anchorDate.getDay() reads the BROWSER's local weekday, which can disagree
    // with the studio-zone day the rest of the day view is keyed by (formatDate/
    // studioDayString) — showing the wrong day's availability bands for a viewer
    // whose device isn't set to the studio's zone. Derive the weekday from the
    // studio-zone date string instead, same fix as the family booking picker.
    const key = WEEKDAY_KEYS[(new Date(`${formatDate(anchorDate)}T12:00:00Z`).getUTCDay() + 6) % 7];
    return availability
      .filter(a => a.staffId === teacherId && a.weekday === key)
      .map(a => elasticBandBox(hhmmToMin(a.startTime), hhmmToMin(a.endTime), dayHourHeights, dayOffsets))
      .filter((b): b is { top: number; height: number } => b !== null);
  }

  const weekLabel = `${formatDateLabel(weekStart, { day: 'numeric', month: 'short' })} – ${formatDateLabel(new Date(weekStart.getTime() + 6 * 86400000), { day: 'numeric', month: 'short', year: 'numeric' })}`;
  const dayLabel = formatDateLabel(anchorDate, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const monthLabel = formatDateLabel(monthGrid.monthStart, { month: 'long', year: 'numeric' });
  const todayStr = formatDate(new Date());
  const anchorStr = formatDate(anchorDate);
  const isAnchorToday = anchorStr === todayStr;

  // teacher columns for day view: assigned teachers + an "Unassigned" bucket if
  // needed. A teacher filter narrows to that one column.
  const dayLessonsToday = lessons.filter(l => studioDayString(l.startsAt) === studioDayString(anchorDate));
  const hasUnassigned = !filterTeacherId && dayLessonsToday.some(l => !l.teacher);
  const teacherCols: { id: string | null; name: string }[] = [
    ...staff
      .filter(s => !filterTeacherId || s.id === filterTeacherId)
      .map(s => ({ id: s.id, name: `${s.firstName} ${s.lastName}` })),
    ...(hasUnassigned ? [{ id: null, name: 'Unassigned' }] : []),
  ];

  // Elastic per-hour heights, shared by every column in the view so their hour
  // gridlines still line up — a busy hour in any one column grows the whole
  // row, rather than that column's content silently overflowing past hours
  // that stayed a fixed height.
  const weekHourHeights = view === 'week' ? computeElasticHourHeights(DAYS.map((_, di) => dayLessons(di))) : BASELINE_HOURS;
  const weekOffsets = cumulativeOffsets(weekHourHeights);
  const weekTotalH = elasticTotalHeight(weekHourHeights);
  const dayHourHeights = view === 'day' ? computeElasticHourHeights(teacherCols.map(col => teacherDayLessons(col.id))) : BASELINE_HOURS;
  const dayOffsets = cumulativeOffsets(dayHourHeights);
  const dayTotalH = elasticTotalHeight(dayHourHeights);

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Clicking a specific grid cell pre-fills that day (slotDate); the
          generic toolbar button has no such intent, so it should default to
          today — not whatever day/week happens to be scrolled into view,
          which could be any date the calendar was last navigated to. */}
      <AddLessonModal
        open={showAdd}
        onClose={() => { setShowAdd(false); setSlotDate(undefined); setSlotTime(undefined); }}
        onCreated={load}
        defaultDate={slotDate ?? todayStr}
        defaultTime={slotTime}
      />
      <NewDefaultLessonModal
        open={showQuickAdd}
        onClose={() => setShowQuickAdd(false)}
        onCreated={load}
        defaultDate={todayStr}
      />
      <LessonDetailModal
        lesson={selectedLesson}
        open={!!selectedLesson}
        onClose={() => setSelectedLesson(null)}
        onUpdated={load}
        readOnly={role === 'teacher' && !!myStaffId && !!selectedLesson?.teacher && selectedLesson.teacher.id !== myStaffId}
        canManage={isManagement}
        staffOptions={staff}
      />
      <AssignStudentsModal open={showAssign} onClose={() => setShowAssign(false)} teachers={staff} onChanged={load} />

      {/* Attendance and Requests no longer have their own sidebar entries — reached from here instead */}
      <div className="shrink-0 px-4 md:px-7 pt-4 md:pt-3">
        <SectionTabs items={[
          { label: 'Calendar', href: '/app/calendar' },
          { label: 'Attendance', href: '/app/attendance', badge: pendingBadges.unmarkedToday },
          { label: 'Requests', href: '/app/lesson-requests', badge: pendingBadges.pendingRequests },
        ]} />
      </div>

      {/* Toolbar */}
      <div className="flex items-center justify-between mb-4 shrink-0 flex-wrap gap-2 px-4 md:px-7 pt-1">
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => stepPeriod(-1)} className="ui-btn-ghost px-2.5 py-1.5">
            <ChevronLeft size={16} />
          </button>

          {/* Today button + view switcher: label reflects the active view
              (Day/Week/Month), not a static "Today", and the chevron opens
              the same pill's dropdown to change it. */}
          <div ref={viewMenuRef} className="relative flex">
            <button onClick={goToday} className="ui-btn-ghost text-sm px-3 py-1.5 rounded-r-none border-r-0" title="Jump to today">
              {view === 'day' ? 'Today' : view === 'week' ? 'Week' : 'Month'}
            </button>
            <button onClick={() => setViewMenuOpen(o => !o)}
              className="ui-btn-ghost text-sm px-1.5 py-1.5 rounded-l-none" title="Change view" aria-label="Change view">
              <ChevronDown size={13} />
            </button>
            {viewMenuOpen && (
              <div className="absolute top-full left-0 mt-1 w-36 rounded-xl border border-[var(--bd)] bg-white shadow-lg overflow-hidden z-30">
                {(['day', 'week', 'month'] as const).map(v => (
                  <button key={v} onClick={() => { setView(v); setViewMenuOpen(false); }}
                    className="w-full text-left px-3.5 py-2 text-sm capitalize transition-colors hover:bg-[var(--sage-lt)]"
                    style={{ color: view === v ? 'var(--sage-dk)' : 'var(--txt2)', fontWeight: view === v ? 600 : 400 }}>
                    {v} view
                  </button>
                ))}
              </div>
            )}
          </div>

          <button onClick={() => stepPeriod(1)} className="ui-btn-ghost px-2.5 py-1.5">
            <ChevronRight size={16} />
          </button>
          <span className="font-bold text-sm ml-1" style={{ color: 'var(--txt)' }}>
            {view === 'day' ? dayLabel : view === 'month' ? monthLabel : weekLabel}
          </span>
          <span className="text-[11px] font-medium ml-1" style={{ color: 'var(--txt4)' }}>
            · {(view === 'day' ? dayLessonsToday.length : lessons.length)} lesson{(view === 'day' ? dayLessonsToday.length : lessons.length) !== 1 ? 's' : ''}
            {view === 'day' && ' · all teachers'}
          </span>

          {/* Whole-studio toggle — a teacher's opt-in to everyone's schedule.
              Management already sees everyone, so it's only shown to teachers. */}
          {role === 'teacher' && (
            <button
              onClick={() => { setWholeStudio(v => !v); setFilterTeacherId(''); }}
              className="ui-btn-ghost text-xs px-2.5 py-1.5 ml-1"
              style={wholeStudio ? { background: 'var(--sage-lt)', color: 'var(--sage-dk)', borderColor: 'var(--sage-md)' } : undefined}
              title={wholeStudio ? 'Showing every teacher — click for just your own lessons' : 'Showing your lessons — click to see the whole studio'}
            >
              {wholeStudio ? 'Whole studio' : 'My lessons'}
            </button>
          )}

          {/* Sort/filter — one button covering teacher, student and instrument,
              each independently combinable. Was two always-visible dropdowns
              (teacher, student); consolidated behind one trigger so the
              toolbar doesn't grow every time another filter dimension is
              added, and to make room for the new instrument filter. */}
          {showFilters && (() => {
            const activeCount = [filterTeacherId, filterStudentId, filterInstrument].filter(Boolean).length;
            return (
              <div ref={sortMenuRef} className="relative ml-1">
                <button onClick={() => setSortMenuOpen(o => !o)}
                  className="ui-btn-ghost text-sm px-3 py-1.5 flex items-center gap-1.5"
                  style={activeCount ? { background: 'var(--sage-lt)', color: 'var(--sage-dk)', borderColor: 'var(--sage-md)' } : undefined}>
                  <ListFilter size={14} /> Sort
                  {activeCount > 0 && (
                    <span className="text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center"
                      style={{ background: 'var(--sage)', color: '#fff' }}>
                      {activeCount}
                    </span>
                  )}
                  <ChevronDown size={13} />
                </button>
                {sortMenuOpen && (
                  <div className="absolute top-full left-0 mt-1 w-56 rounded-xl border border-[var(--bd)] bg-white shadow-lg p-3 space-y-3 z-30">
                    <div>
                      <label className="ui-label">Teacher</label>
                      <SearchableSelect
                        value={filterTeacherId} onChange={setFilterTeacherId}
                        emptyLabel="All teachers" placeholder="All teachers"
                        options={staff.map(s => ({ value: s.id, label: `${s.firstName} ${s.lastName}` }))}
                      />
                    </div>
                    <div>
                      <label className="ui-label">Student</label>
                      <SearchableSelect
                        value={filterStudentId} onChange={setFilterStudentId}
                        emptyLabel="All students" placeholder="All students"
                        options={studentOptions.map(s => ({ value: s.id, label: s.name }))}
                      />
                    </div>
                    <div>
                      <label className="ui-label">Instrument</label>
                      <SearchableSelect
                        value={filterInstrument} onChange={setFilterInstrument}
                        emptyLabel="All instruments" placeholder="All instruments"
                        options={orgInstruments.all.map(i => ({ value: i, label: i.charAt(0).toUpperCase() + i.slice(1) }))}
                      />
                    </div>
                    {activeCount > 0 && (
                      <button onClick={() => { setFilterTeacherId(''); setFilterStudentId(''); setFilterInstrument(''); }}
                        className="ui-btn-ghost text-xs w-full">
                        Clear all
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })()}
        </div>
        <div className="flex items-center gap-2">
          {isManagement && (
            <button onClick={() => setShowAssign(true)} className="ui-btn-ghost">
              <Users size={15} /> Assign students
            </button>
          )}
          <button onClick={() => setShowAdd(true)} className="ui-btn-primary">+ Add lesson</button>
          <InfoTooltip text="You don't have to add each week's lesson by hand — tick 'Repeat weekly' when booking and the studio creates the whole run of lessons for you. Families are also reminded 24 hours before every lesson automatically." />
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-3 mb-3 shrink-0 flex-wrap px-4 md:px-7">
        <span className="text-[11px] text-[var(--txt4)] font-semibold uppercase tracking-wide">Type:</span>
        <span className="flex items-center gap-1 text-[11px] text-[var(--sage)] font-semibold">
          <span className="w-3 h-3 rounded-sm border-l-2 border-[var(--sage)] bg-[var(--sage-lt)] inline-block" />
          Private (P)
        </span>
        <span className="flex items-center gap-1 text-[11px] text-blue-600 font-semibold">
          <span className="w-3 h-3 rounded-sm border-l-2 border-blue-400 bg-blue-50 inline-block" />
          Group (G)
        </span>
        <span className="flex items-center gap-1 text-[11px] font-semibold" style={{ color: 'var(--sage-dk)' }}>
          <span className="w-3 h-3 rounded-sm inline-block" style={{ background: hexToRgba('#3D7A55', 0.14), borderLeft: '2px solid rgba(61,122,85,0.4)' }} />
          Available
        </span>
      </div>

      {/* ── Week view ── */}
      {view === 'week' && (
        <div className="flex-1 min-h-0 overflow-auto bg-white border-t border-r border-[var(--bd)] select-none">
          {/* Sticky header row */}
          <div className="sticky top-0 z-20 bg-white border-b border-[var(--bd)] grid"
            style={{ gridTemplateColumns: 'repeat(7, 1fr)' }}>
            {DAYS.map((day, i) => {
              const d = new Date(weekStart);
              d.setDate(d.getDate() + i);
              const dStr = formatDate(d);
              const isToday = dStr === todayStr;
              const count = dayLessons(i).length;
              const exception = exceptionLabel(dStr);
              return (
                <div key={day}
                  className={`border-r border-[var(--bd)] px-2 py-2.5 text-center ${i === 6 ? 'border-r-0' : ''} ${exception ? '' : 'bg-[var(--surf)]'}`}
                  style={exception ? { background: 'repeating-linear-gradient(135deg, rgba(148,138,120,0.14) 0px, rgba(148,138,120,0.14) 6px, var(--surf) 6px, var(--surf) 12px)' } : undefined}>
                  <div className={`text-[11px] font-bold uppercase tracking-wider ${isToday ? 'text-[var(--sage)]' : 'text-[var(--txt4)]'}`}>{day}</div>
                  {/* dStr (studio-zone) is what dayLessons(i)/isToday are keyed by
                      below — d.getDate() reads the browser-local day-of-month,
                      which can show a different number than the studio-zone day
                      this column's lessons belong to. */}
                  <div className={`text-xl font-bold mt-0.5 ${isToday ? 'text-[var(--sage)]' : 'text-[var(--txt)]'}`}>{Number(dStr.slice(8, 10))}</div>
                  {exception && (
                    <div className="text-[9px] font-bold mt-0.5 uppercase tracking-wide" style={{ color: 'var(--txt4)' }}>Half term</div>
                  )}
                  {count > 0 && (
                    <div className="text-[9px] font-bold mt-0.5" style={{ color: 'var(--txt4)' }}>
                      {count} lesson{count !== 1 ? 's' : ''}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Body: 7 day columns (no separate time-axis column — each lesson block
              shows its own start/end time, and the leftmost column carries a faint
              hour marker so the hour grid is still readable at a glance) */}
          <div className="grid" style={{ gridTemplateColumns: 'repeat(7, 1fr)', minWidth: 700 }}>

            {/* Day columns */}
            {DAYS.map((_, di) => {
              const d = new Date(weekStart);
              d.setDate(d.getDate() + di);
              const dStr = formatDate(d);
              const isToday = dStr === todayStr;
              const layout = computeLayout(dayLessons(di), weekHourHeights);
              const exception = exceptionLabel(dStr);

              return (
                <div key={di}
                  className={`relative border-r border-[var(--bd)] ${di === 6 ? 'border-r-0' : ''} ${isToday ? 'bg-[var(--sage-lt)]/20' : ''}`}
                  style={{ height: weekTotalH }}>

                  {/* Hour guide lines + faint hour marker (leftmost column only) */}
                  {HOURS.map((h, hi) => (
                    <div key={h} className="absolute inset-x-0 border-t border-[var(--bd)]"
                      style={{ top: weekOffsets[hi] }}>
                      {di === 0 && (
                        <span className="absolute left-1 top-0.5 text-[9px] font-semibold text-[var(--txt4)] leading-none tabular-nums pointer-events-none opacity-70">
                          {String(h).padStart(2, '0')}:00
                        </span>
                      )}
                    </div>
                  ))}

                  {/* Availability bands — shaded hours a teacher is free to teach.
                      Admin only sees these once a specific teacher is filtered
                      (otherwise every teacher's hours would blend together);
                      a teacher always sees their own windows. */}
                  {(role === 'teacher' || !!filterTeacherId) && weekAvailabilityBands(di).map((b, bi) => (
                    <div key={`av${bi}`} className="absolute inset-x-0 pointer-events-none"
                      style={{ top: b.top, height: b.height, background: hexToRgba('#3D7A55', 0.09), borderLeft: '2px solid rgba(61,122,85,0.35)' }} />
                  ))}

                  {/* Half-hour guide lines (lighter) */}
                  {HOURS.map((h, hi) => (
                    <div key={`h${h}`} className="absolute inset-x-0 border-t border-dashed"
                      style={{ top: weekOffsets[hi]! + weekHourHeights[hi]! / 2, borderColor: '#E2E8F0' }} />
                  ))}

                  {/* Clickable hour slots (behind lessons) — still bookable during a
                      half-term/holiday week, since makeup lessons sometimes get
                      arranged then. The stripe overlay below is only a visual
                      warning that the studio doesn't normally run classes. */}
                  {HOURS.map((h, hi) => (
                    <div key={`slot${h}`}
                      className="absolute inset-x-0 hover:bg-[var(--sage-lt)]/30 transition-colors cursor-pointer group"
                      style={{ top: weekOffsets[hi], height: weekHourHeights[hi] }}
                      onClick={() => openSlot(di, h)}>
                      <span className="absolute right-1 top-1 text-[9px] text-[var(--sage)] opacity-0 group-hover:opacity-100 font-bold pointer-events-none">+</span>
                    </div>
                  ))}

                  {/* Lesson blocks */}
                  {layout.map(l => (
                    <LessonBlock key={l.id} lesson={l} onClick={() => setSelectedLesson(l)} />
                  ))}

                  {exception && (
                    <div className="absolute inset-0 pointer-events-none flex items-start justify-center pt-1"
                      style={{
                        background: 'repeating-linear-gradient(135deg, rgba(148,138,120,0.08) 0px, rgba(148,138,120,0.08) 8px, transparent 8px, transparent 16px)',
                      }}>
                      <span className="text-[9px] font-bold uppercase tracking-wide leading-tight px-1.5 py-0.5 rounded"
                        style={{ color: 'var(--txt4)', background: 'rgba(255,255,255,0.85)' }}>
                        {exception}
                      </span>
                    </div>
                  )}

                  {/* "Now" line for today */}
                  {isToday && (() => {
                    const nowMins = (new Date().getHours() - DAY_START) * 60 + new Date().getMinutes();
                    if (nowMins < 0 || nowMins > HOURS.length * 60) return null;
                    return (
                      <div className="absolute inset-x-0 z-20 pointer-events-none flex items-center"
                        style={{ top: elasticY(nowMins, weekHourHeights, weekOffsets) }}>
                        <div className="w-2 h-2 rounded-full bg-[var(--coral)] ml-0.5 shrink-0" />
                        <div className="flex-1 h-px bg-[var(--coral)]" />
                      </div>
                    );
                  })()}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Day view: all teachers' schedules for the selected day ── */}
      {view === 'day' && (
        <div className="flex-1 min-h-0 overflow-auto bg-white border-t border-r border-[var(--bd)] select-none">
          {teacherCols.length === 0 ? (
            <p className="p-8 text-center text-sm" style={{ color: 'var(--txt4)' }}>No teaching staff found.</p>
          ) : (
            <>
              {/* Sticky header row */}
              <div className="sticky top-0 z-20 bg-white border-b border-[var(--bd)] grid"
                style={{ gridTemplateColumns: `repeat(${teacherCols.length}, minmax(140px, 1fr))` }}>
                {teacherCols.map(col => {
                  const count = teacherDayLessons(col.id).length;
                  const exception = exceptionLabel(anchorStr);
                  return (
                    <div key={col.id ?? 'unassigned'}
                      className="border-r border-[var(--bd)] last:border-r-0 px-2 py-2.5 text-center bg-[var(--surf)]">
                      <div className="text-[12px] font-bold truncate" style={{ color: 'var(--txt)' }}>{col.name}</div>
                      {exception && (
                        <div className="text-[9px] font-bold mt-0.5 uppercase tracking-wide" style={{ color: 'var(--txt4)' }}>Half term</div>
                      )}
                      {count > 0 && (
                        <div className="text-[9px] font-bold mt-0.5" style={{ color: 'var(--txt4)' }}>
                          {count} lesson{count !== 1 ? 's' : ''}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Body (no separate time-axis column — leftmost teacher column carries a faint hour marker) */}
              <div className="grid" style={{ gridTemplateColumns: `repeat(${teacherCols.length}, minmax(140px, 1fr))`, minWidth: 700 }}>
                {/* Teacher columns */}
                {teacherCols.map((col, ci) => {
                  const layout = computeLayout(teacherDayLessons(col.id), dayHourHeights);
                  const exception = exceptionLabel(anchorStr);
                  return (
                    <div key={col.id ?? 'unassigned'}
                      className={`relative border-r border-[var(--bd)] ${ci === teacherCols.length - 1 ? 'border-r-0' : ''} ${isAnchorToday ? 'bg-[var(--sage-lt)]/20' : ''}`}
                      style={{ height: dayTotalH }}>

                      {HOURS.map((h, hi) => (
                        <div key={h} className="absolute inset-x-0 border-t border-[var(--bd)]"
                          style={{ top: dayOffsets[hi] }}>
                          {ci === 0 && (
                            <span className="absolute left-1 top-0.5 text-[9px] font-semibold text-[var(--txt4)] leading-none tabular-nums pointer-events-none opacity-70">
                              {String(h).padStart(2, '0')}:00
                            </span>
                          )}
                        </div>
                      ))}

                      {HOURS.map((h, hi) => (
                        <div key={`h${h}`} className="absolute inset-x-0 border-t border-dashed"
                          style={{ top: dayOffsets[hi]! + dayHourHeights[hi]! / 2, borderColor: '#E2E8F0' }} />
                      ))}
                      {/* Availability bands — this teacher's free-to-teach hours, in their
                          colour. Admin only sees these once a specific teacher is
                          filtered; a teacher always sees their own. */}
                      {(role === 'teacher' || !!filterTeacherId) && teacherAvailabilityBands(col.id).map((b, bi) => (
                        <div key={`av${bi}`} className="absolute inset-x-0 pointer-events-none"
                          style={{ top: b.top, height: b.height, background: hexToRgba(teacherColor(col.id), 0.1), borderLeft: `2px solid ${hexToRgba(teacherColor(col.id), 0.4)}` }}>
                          <span className="absolute left-1.5 top-1 text-[8px] font-bold uppercase tracking-wide pointer-events-none"
                            style={{ color: teacherColor(col.id), opacity: 0.55 }}>Available</span>
                        </div>
                      ))}

                      {/* Clickable hour slots — still bookable during a half-term/
                          holiday week; the stripe overlay below is a visual warning
                          only, since makeup lessons sometimes get arranged then. */}
                      {HOURS.map((h, hi) => (
                        <div key={`slot${h}`}
                          className="absolute inset-x-0 hover:bg-[var(--sage-lt)]/30 transition-colors cursor-pointer group"
                          style={{ top: dayOffsets[hi], height: dayHourHeights[hi] }}
                          onClick={() => openSlotForDay(h)}>
                          <span className="absolute right-1 top-1 text-[9px] text-[var(--sage)] opacity-0 group-hover:opacity-100 font-bold pointer-events-none">+</span>
                        </div>
                      ))}

                      {layout.map(l => (
                        <LessonBlock key={l.id} lesson={l} onClick={() => setSelectedLesson(l)} />
                      ))}

                      {exception && (
                        <div className="absolute inset-0 pointer-events-none flex items-start justify-center pt-1"
                          style={{ background: 'repeating-linear-gradient(135deg, rgba(148,138,120,0.08) 0px, rgba(148,138,120,0.08) 8px, transparent 8px, transparent 16px)' }}>
                          {ci === 0 && (
                            <span className="text-[9px] font-bold uppercase tracking-wide leading-tight px-1.5 py-0.5 rounded"
                              style={{ color: 'var(--txt4)', background: 'rgba(255,255,255,0.85)' }}>
                              {exception}
                            </span>
                          )}
                        </div>
                      )}

                      {isAnchorToday && (() => {
                        const nowMins = (new Date().getHours() - DAY_START) * 60 + new Date().getMinutes();
                        if (nowMins < 0 || nowMins > HOURS.length * 60) return null;
                        return (
                          <div className="absolute inset-x-0 z-20 pointer-events-none flex items-center"
                            style={{ top: elasticY(nowMins, dayHourHeights, dayOffsets) }}>
                            <div className="w-2 h-2 rounded-full bg-[var(--coral)] ml-0.5 shrink-0" />
                            <div className="flex-1 h-px bg-[var(--coral)]" />
                          </div>
                        );
                      })()}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Month view: a traditional 6-week grid, chips per lesson ── */}
      {view === 'month' && (
        <div className="flex-1 min-h-0 overflow-auto bg-white border-t border-r border-[var(--bd)]">
          {/* Weekday header */}
          <div className="sticky top-0 z-10 grid bg-[var(--surf)] border-b border-[var(--bd)]"
            style={{ gridTemplateColumns: 'repeat(7, 1fr)' }}>
            {DAYS.map(d => (
              <div key={d} className="px-2 py-2 text-center text-[11px] font-bold uppercase tracking-wider border-r border-[var(--bd)] last:border-r-0"
                style={{ color: 'var(--txt4)' }}>{d}</div>
            ))}
          </div>

          {/* 6 rows × 7 days */}
          <div className="grid" style={{ gridTemplateColumns: 'repeat(7, 1fr)', minWidth: 700 }}>
            {Array.from({ length: 42 }, (_, i) => {
              const d = new Date(monthGrid.gridStart);
              d.setDate(d.getDate() + i);
              const dStr = formatDate(d);
              const inMonth = d.getMonth() === monthGrid.monthStart.getMonth();
              const isToday = dStr === todayStr;
              const dayStr = studioDayString(d);
              const dayList = lessons
                .filter(l => studioDayString(l.startsAt) === dayStr)
                .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
              const exception = exceptionLabel(dayStr);
              return (
                <button
                  key={i}
                  ref={isToday ? todayCellRef : undefined}
                  onClick={() => { setAnchorDate(d); setView('day'); }}
                  className="text-left border-r border-b border-[var(--bd)] last:border-r-0 p-1.5 transition-colors hover:bg-[var(--sage-lt)]/20"
                  // A <button> centers its content by default in some browsers
                  // once it's stretched taller than its content (which every
                  // cell shorter than the row's tallest neighbour is, since
                  // the grid stretches every cell to match) — the date number
                  // and lesson chips floated to the middle of the cell instead
                  // of sitting at the top where the row's date numbers line
                  // up. Force block layout, top-anchored explicitly.
                  style={{
                    minHeight: 148,
                    background: exception
                      ? 'repeating-linear-gradient(135deg, rgba(148,138,120,0.14) 0px, rgba(148,138,120,0.14) 6px, #fff 6px, #fff 12px)'
                      : inMonth ? '#fff' : 'var(--surf)',
                    display: 'flex', flexDirection: 'column', alignItems: 'stretch', justifyContent: 'flex-start',
                  }}
                  title={exception ? `${exception} — booking still allowed` : 'Open this day'}
                >
                  <div className="flex items-center justify-between mb-1">
                    {/* dayStr (studio-zone) is what dayList is filtered by —
                        d.getDate() reads the browser-local day-of-month, which
                        can show a different number than the cell's actual data. */}
                    <span className={`text-xs font-bold ${isToday ? 'text-white bg-[var(--sage)] rounded-full w-5 h-5 flex items-center justify-center' : inMonth ? 'text-[var(--txt2)]' : 'text-[var(--txt4)]'}`}>
                      {Number(dayStr.slice(8, 10))}
                    </span>
                    <span className="flex items-center gap-1">
                      {exception && (
                        <span className="text-[8px] font-bold uppercase tracking-wide" style={{ color: 'var(--txt4)' }}>Half term</span>
                      )}
                      {dayList.length > 0 && (
                        <span className="text-[9px] font-bold" style={{ color: 'var(--txt4)' }}>{dayList.length}</span>
                      )}
                    </span>
                  </div>
                  {/* Chips match the week view's lesson blocks exactly: left rail
                      (attendance + paid stacked), two-line content. Every lesson
                      renders — no "+N more" truncation — so the cell just grows. */}
                  <div className="space-y-1">
                    {dayList.map(l => {
                      const c = teacherColor(l.teacher?.id);
                      const instr = l.enrollment?.instrument;
                      const iColor = instrColor(instr);
                      const cancelled = l.status.startsWith('cancelled');
                      const present = attendanceIcon(l.status);
                      const paid = paymentIcon(l);
                      const secondaryLabel = l.enrollment?.lessonType === 'group' && l.enrollment?.groupName ? l.enrollment.groupName : instr;
                      return (
                        <div
                          key={l.id}
                          onClick={(e) => { e.stopPropagation(); setSelectedLesson(l); }}
                          className="rounded-md border cursor-pointer overflow-hidden hover:brightness-95 flex items-stretch gap-0.5 px-1 py-0.5"
                          style={{
                            background: hexToRgba(c, cancelled ? 0.06 : 0.14),
                            borderColor: hexToRgba(c, cancelled ? 0.3 : 0.55),
                            opacity: cancelled ? 0.65 : 1,
                          }}
                        >
                          {(present || paid) && (
                            <span className="flex flex-col items-center justify-center shrink-0 w-3 gap-0.5">
                              {present && (
                                <span title={present.title}>
                                  <present.Icon size={9} style={{ color: present.color }} />
                                </span>
                              )}
                              {paid && <span title={paid.title}><PoundSterling size={8} style={{ color: paid.color }} /></span>}
                            </span>
                          )}
                          <span className="flex-1 min-w-0 flex flex-col gap-0.5">
                            <span className="flex items-baseline gap-1 min-w-0">
                              <span className="text-[8px] font-bold leading-none tabular-nums shrink-0" style={{ color: c, opacity: 0.7 }}>{fmtTime(l.startsAt)}</span>
                              <span className="text-[10px] font-bold leading-tight truncate" style={{ color: c, textDecoration: cancelled ? 'line-through' : undefined }}>
                                {l.student?.firstName} {l.student?.lastName}
                              </span>
                            </span>
                            <span className="flex items-center gap-1 min-w-0">
                              {secondaryLabel && (
                                <span className="text-[8px] font-semibold capitalize truncate" style={{ color: iColor }}>{secondaryLabel}</span>
                              )}
                              {l.teacher && (
                                <span className="text-[8px] leading-tight truncate" style={{ color: c, opacity: 0.7 }}>
                                  · {l.teacher.firstName} {l.teacher.lastName}
                                </span>
                              )}
                            </span>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
