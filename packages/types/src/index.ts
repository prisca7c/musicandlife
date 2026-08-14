// Four roles, four portals. system_admin/manager/receptionist/technician were
// separate tiers below admin that no real staff member ever used (only admin
// and teacher did) — admin already passed every one of their @Roles() checks
// via the hierarchy below, so collapsing them removes dead distinctions
// without changing what any real account can do.
export type BaseRole =
  | 'admin'
  | 'teacher'
  | 'guardian'
  | 'student';

/**
 * Privilege level for each role. Higher = more access. Used both by the
 * RolesGuard (does the caller meet the required level?) and by login/refresh
 * (when a user has several active memberships, the highest-privilege one wins
 * so an admin is never handed a downgraded token role).
 */
export const ROLE_LEVEL: Record<BaseRole, number> = {
  admin: 90,
  teacher: 30,
  guardian: 20,
  student: 10,
};

export type MembershipStatus = 'active' | 'suspended' | 'removed';
export type UserStatus = 'active' | 'suspended' | 'deleted';
export type StudentStatus = 'trial' | 'active' | 'paused' | 'withdrawn';
export type EnrollmentStatus = 'trial' | 'active' | 'paused' | 'withdrawn';
export type LessonType = 'private' | 'group';
export type TermStatus = 'planned' | 'active' | 'closed';
export type InvoiceMode = 'monthly_statement' | 'per_lesson';

// ─── Lesson rates (2025-26 T&Cs §1) ─────────────────────────────────────────
export const LESSON_RATES: Record<string, Record<number, number>> = {
  // pence per session
  private: { 30: 3500, 45: 5250, 60: 7000 },
  group:   { 60: 2500 },
};

/** Returns the standard rate in pence for a given lesson type and duration */
export function lessonRate(lessonType: 'private' | 'group', durationMin: number): number {
  return LESSON_RATES[lessonType]?.[durationMin] ?? LESSON_RATES[lessonType]?.[60] ?? 0;
}

/** Returns the term total in pence (lessons × rate), with optional 5% advance-payment discount */
export function termTotal(ratePerSession: number, lessonCount: number, discount5pct = false): number {
  const total = ratePerSession * lessonCount;
  return discount5pct ? Math.round(total * 0.95) : total;
}

export const PRIVATE_INSTRUMENTS = [
  'guitar',
  'piano',
  'violin',
  'drums',
  'bass guitar',
  'cello',
  'viola',
  'vocal',
] as const;

export const GROUP_INSTRUMENTS = [
  'guitar',
  'ukulele',
  'suzuki violin',
  'ensemble',
] as const;

export const ALL_INSTRUMENTS = [
  ...new Set([...PRIVATE_INSTRUMENTS, ...GROUP_INSTRUMENTS]),
] as const;

export type PrivateInstrument = (typeof PRIVATE_INSTRUMENTS)[number];
export type GroupInstrument = (typeof GROUP_INSTRUMENTS)[number];

export const WEEKDAYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export interface ScheduleRule {
  weekday: Weekday;
  startTime: string; // "HH:MM" 24h
}

export interface JwtPayload {
  sub: string;
  sessionId: string;
  orgId: string;
  membershipId: string;
  role: BaseRole;
  iat: number;
  exp: number;
}

export interface RequestUser {
  userId: string;
  sessionId: string;
  orgId: string;
  membershipId: string;
  role: BaseRole;
}

// Fine-grained staff privileges
export interface StaffPrivileges {
  administrator: boolean;
  'payments.record': boolean;
  'lessons.edit_own': boolean;
  'payroll.view_own': boolean;
  'mileage.manage': boolean;
  'teachers.view_contact': boolean;
  'teachers.manage_students_lessons': boolean;
  'teachers.view_lessons': boolean;
  'family.view_address_phone': boolean;
  'family.view_email': boolean;
  'attachments.view_download': boolean;
  'invoices.manage': boolean;
  'expenses.manage': boolean;
  'resources.manage': boolean;
  'website.edit': boolean;
  'reports.manage': boolean;
}

export const PRIVILEGE_LABELS: Record<keyof StaffPrivileges, string> = {
  administrator: 'Administrator (all permissions)',
  'payments.record': 'Record payments',
  'lessons.edit_own': 'Edit own lessons',
  'payroll.view_own': 'View own payroll',
  'mileage.manage': 'Manage mileage',
  'teachers.view_contact': "View other teachers' contact info",
  'teachers.manage_students_lessons': "Manage other teachers' lessons",
  'teachers.view_lessons': "View other teachers' lessons",
  'family.view_address_phone': 'View family address & phone',
  'family.view_email': 'View family email',
  'attachments.view_download': 'View & download attachments',
  'invoices.manage': 'Manage invoices',
  'expenses.manage': 'Manage expenses',
  'resources.manage': 'Manage resources',
  'website.edit': 'Edit website',
  'reports.manage': 'Manage reports',
};

export const DEFAULT_TEACHER_PRIVILEGES: StaffPrivileges = {
  administrator: false,
  'payments.record': false,
  'lessons.edit_own': true,
  'payroll.view_own': true,
  'mileage.manage': false,
  'teachers.view_contact': false,
  'teachers.manage_students_lessons': false,
  'teachers.view_lessons': false,
  'family.view_address_phone': false,
  'family.view_email': false,
  'attachments.view_download': true,
  'invoices.manage': false,
  'expenses.manage': false,
  'resources.manage': false,
  'website.edit': false,
  'reports.manage': false,
};

export const ADMIN_PRIVILEGES: StaffPrivileges = {
  administrator: true,
  'payments.record': true,
  'lessons.edit_own': true,
  'payroll.view_own': true,
  'mileage.manage': true,
  'teachers.view_contact': true,
  'teachers.manage_students_lessons': true,
  'teachers.view_lessons': true,
  'family.view_address_phone': true,
  'family.view_email': true,
  'attachments.view_download': true,
  'invoices.manage': true,
  'expenses.manage': true,
  'resources.manage': true,
  'website.edit': true,
  'reports.manage': true,
};
