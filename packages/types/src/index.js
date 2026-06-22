"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ADMIN_PRIVILEGES = exports.DEFAULT_TEACHER_PRIVILEGES = exports.PRIVILEGE_LABELS = exports.WEEKDAYS = exports.ALL_INSTRUMENTS = exports.GROUP_INSTRUMENTS = exports.PRIVATE_INSTRUMENTS = exports.LESSON_RATES = void 0;
exports.lessonRate = lessonRate;
exports.termTotal = termTotal;
// ─── Lesson rates (2025-26 T&Cs §1) ─────────────────────────────────────────
exports.LESSON_RATES = {
    // pence per session
    private: { 30: 3500, 45: 5250, 60: 7000 },
    group: { 60: 2500 },
};
/** Returns the standard rate in pence for a given lesson type and duration */
function lessonRate(lessonType, durationMin) {
    return exports.LESSON_RATES[lessonType]?.[durationMin] ?? exports.LESSON_RATES[lessonType]?.[60] ?? 0;
}
/** Returns the term total in pence (lessons × rate), with optional 5% advance-payment discount */
function termTotal(ratePerSession, lessonCount, discount5pct = false) {
    const total = ratePerSession * lessonCount;
    return discount5pct ? Math.round(total * 0.95) : total;
}
exports.PRIVATE_INSTRUMENTS = [
    'guitar',
    'piano',
    'violin',
    'drums',
    'bass',
    'cello',
    'viola',
    'vocal',
];
exports.GROUP_INSTRUMENTS = [
    'guitar',
    'ukulele',
    'suzuki violin',
    'ensemble',
];
exports.ALL_INSTRUMENTS = [
    ...new Set([...exports.PRIVATE_INSTRUMENTS, ...exports.GROUP_INSTRUMENTS]),
];
exports.WEEKDAYS = [
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday',
    'sunday',
];
exports.PRIVILEGE_LABELS = {
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
exports.DEFAULT_TEACHER_PRIVILEGES = {
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
exports.ADMIN_PRIVILEGES = {
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
//# sourceMappingURL=index.js.map