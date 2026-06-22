export type BaseRole = 'system_admin' | 'admin' | 'manager' | 'receptionist' | 'technician' | 'teacher' | 'guardian' | 'student';
export type MembershipStatus = 'active' | 'suspended' | 'removed';
export type UserStatus = 'active' | 'suspended' | 'deleted';
export type StudentStatus = 'trial' | 'active' | 'paused' | 'withdrawn';
export type EnrollmentStatus = 'trial' | 'active' | 'paused' | 'withdrawn';
export type LessonType = 'private' | 'group';
export type TermStatus = 'planned' | 'active' | 'closed';
export type InvoiceMode = 'monthly_statement' | 'per_lesson';
export declare const LESSON_RATES: Record<string, Record<number, number>>;
/** Returns the standard rate in pence for a given lesson type and duration */
export declare function lessonRate(lessonType: 'private' | 'group', durationMin: number): number;
/** Returns the term total in pence (lessons × rate), with optional 5% advance-payment discount */
export declare function termTotal(ratePerSession: number, lessonCount: number, discount5pct?: boolean): number;
export declare const PRIVATE_INSTRUMENTS: readonly ["guitar", "piano", "violin", "drums", "bass", "cello", "viola", "vocal"];
export declare const GROUP_INSTRUMENTS: readonly ["guitar", "ukulele", "suzuki violin", "ensemble"];
export declare const ALL_INSTRUMENTS: readonly ("guitar" | "piano" | "violin" | "drums" | "bass" | "cello" | "viola" | "vocal" | "ukulele" | "suzuki violin" | "ensemble")[];
export type PrivateInstrument = (typeof PRIVATE_INSTRUMENTS)[number];
export type GroupInstrument = (typeof GROUP_INSTRUMENTS)[number];
export declare const WEEKDAYS: readonly ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
export type Weekday = (typeof WEEKDAYS)[number];
export interface ScheduleRule {
    weekday: Weekday;
    startTime: string;
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
export declare const PRIVILEGE_LABELS: Record<keyof StaffPrivileges, string>;
export declare const DEFAULT_TEACHER_PRIVILEGES: StaffPrivileges;
export declare const ADMIN_PRIVILEGES: StaffPrivileges;
//# sourceMappingURL=index.d.ts.map