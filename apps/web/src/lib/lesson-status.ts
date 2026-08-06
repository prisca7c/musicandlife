// Plain-English labels for lesson/attendance status codes. Centralized so a
// status doesn't read as polished copy on one page (e.g. Reports) and as raw
// snake_case on another (e.g. the calendar's lesson-detail modal).

export const LESSON_STATUS_LABELS: Record<string, string> = {
  scheduled: 'Scheduled', completed: 'Completed',
  cancelled_makeup: 'Cancelled — rebook', cancelled_no_makeup: 'Late cancel',
  cancelled_no_pay: 'No charge', cancelled_teacher: 'Teacher cancelled', makeup: 'Makeup lesson',
};

export const ATTENDANCE_STATUS_LABELS: Record<string, string> = {
  present: 'Present',
  absent_makeup: 'Cancelled ≥24h — no charge',
  absent_no_makeup: 'Cancelled <24h — charged',
  absent_no_pay: 'Absent — no charge',
  cancelled_teacher: 'Teacher cancelled',
};

export function lessonStatusLabel(status: string): string {
  return LESSON_STATUS_LABELS[status] ?? status.replace(/_/g, ' ');
}

export function attendanceStatusLabel(status: string): string {
  return ATTENDANCE_STATUS_LABELS[status] ?? status.replace(/_/g, ' ');
}
