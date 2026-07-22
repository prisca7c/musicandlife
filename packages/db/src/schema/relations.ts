import { relations } from 'drizzle-orm';
import { organizations, users, memberships } from './auth';
import {
  terms, families, guardians, students,
  staffMembers, staffPrivileges, teacherAssignments, enrollments,
  notes, staffAvailability,
} from './domain';
import { lessons, attendance, rescheduleRequests, lessonRequests, availability, blockedTime } from './scheduling';
import { invoices, invoiceLineItems, ledgerEntries, payments, paymentClaims, bankTransactions, payrollRuns, payrollItems, expenses, rateChangeRequests, lessonCredits } from './billing';
import { threads, threadParticipants, messages, notificationRules, notificationLog, registrations, leads, newsPosts } from './comms';
import { files, resources, repertoirePieces } from './media';

export const organizationsRelations = relations(organizations, ({ many }) => ({
  memberships: many(memberships),
  families: many(families),
  students: many(students),
  staffMembers: many(staffMembers),
  terms: many(terms),
}));

export const usersRelations = relations(users, ({ many }) => ({
  memberships: many(memberships),
  guardians: many(guardians),
}));

export const membershipsRelations = relations(memberships, ({ one }) => ({
  user: one(users, { fields: [memberships.userId], references: [users.id] }),
  organization: one(organizations, { fields: [memberships.organizationId], references: [organizations.id] }),
}));

export const familiesRelations = relations(families, ({ many }) => ({
  students: many(students),
  guardians: many(guardians),
}));

export const guardiansRelations = relations(guardians, ({ one }) => ({
  family: one(families, { fields: [guardians.familyId], references: [families.id] }),
  user: one(users, { fields: [guardians.userId], references: [users.id] }),
}));

export const studentsRelations = relations(students, ({ one, many }) => ({
  family: one(families, { fields: [students.familyId], references: [families.id] }),
  enrollments: many(enrollments),
  assignments: many(teacherAssignments),
  lessonCredits: many(lessonCredits),
}));

export const staffMembersRelations = relations(staffMembers, ({ one, many }) => ({
  user: one(users, { fields: [staffMembers.userId], references: [users.id] }),
  privileges: one(staffPrivileges, { fields: [staffMembers.id], references: [staffPrivileges.staffId] }),
  assignments: many(teacherAssignments),
  enrollments: many(enrollments),
}));

export const staffPrivilegesRelations = relations(staffPrivileges, ({ one }) => ({
  staff: one(staffMembers, { fields: [staffPrivileges.staffId], references: [staffMembers.id] }),
}));

export const teacherAssignmentsRelations = relations(teacherAssignments, ({ one }) => ({
  staff: one(staffMembers, { fields: [teacherAssignments.staffId], references: [staffMembers.id] }),
  student: one(students, { fields: [teacherAssignments.studentId], references: [students.id] }),
}));

export const enrollmentsRelations = relations(enrollments, ({ one }) => ({
  student: one(students, { fields: [enrollments.studentId], references: [students.id] }),
  teacher: one(staffMembers, { fields: [enrollments.teacherId], references: [staffMembers.id] }),
  term: one(terms, { fields: [enrollments.termId], references: [terms.id] }),
}));

export const termsRelations = relations(terms, ({ many }) => ({
  enrollments: many(enrollments),
}));

export const lessonsRelations = relations(lessons, ({ one, many }) => ({
  student: one(students, { fields: [lessons.studentId], references: [students.id] }),
  teacher: one(staffMembers, { fields: [lessons.teacherId], references: [staffMembers.id] }),
  term: one(terms, { fields: [lessons.termId], references: [terms.id] }),
  enrollment: one(enrollments, { fields: [lessons.enrollmentId], references: [enrollments.id] }),
  attendance: one(attendance, { fields: [lessons.id], references: [attendance.lessonId] }),
  creditsUsed: many(lessonCredits, { relationName: 'usedInLesson' }),
}));

export const attendanceRelations = relations(attendance, ({ one }) => ({
  lesson: one(lessons, { fields: [attendance.lessonId], references: [lessons.id] }),
  markedByUser: one(users, { fields: [attendance.markedBy], references: [users.id] }),
}));

export const lessonCreditsRelations = relations(lessonCredits, ({ one }) => ({
  student: one(students, { fields: [lessonCredits.studentId], references: [students.id] }),
  enrollment: one(enrollments, { fields: [lessonCredits.enrollmentId], references: [enrollments.id] }),
  sourceLesson: one(lessons, { fields: [lessonCredits.sourceLessonId], references: [lessons.id] }),
  usedInLesson: one(lessons, { fields: [lessonCredits.usedInLessonId], references: [lessons.id] }),
  sourcePayment: one(payments, { fields: [lessonCredits.sourcePaymentId], references: [payments.id] }),
}));

export const rescheduleRequestsRelations = relations(rescheduleRequests, ({ one }) => ({
  lesson: one(lessons, { fields: [rescheduleRequests.lessonId], references: [lessons.id] }),
  requestedByUser: one(users, { fields: [rescheduleRequests.requestedBy], references: [users.id] }),
  decidedByUser: one(users, { fields: [rescheduleRequests.decidedBy], references: [users.id] }),
}));

export const lessonRequestsRelations = relations(lessonRequests, ({ one }) => ({
  student: one(students, { fields: [lessonRequests.studentId], references: [students.id] }),
  teacher: one(staffMembers, { fields: [lessonRequests.teacherId], references: [staffMembers.id] }),
  enrollment: one(enrollments, { fields: [lessonRequests.enrollmentId], references: [enrollments.id] }),
  requestedByUser: one(users, { fields: [lessonRequests.requestedBy], references: [users.id] }),
  createdLesson: one(lessons, { fields: [lessonRequests.createdLessonId], references: [lessons.id] }),
}));

export const availabilityRelations = relations(availability, ({ one }) => ({
  staff: one(staffMembers, { fields: [availability.staffId], references: [staffMembers.id] }),
}));

export const blockedTimeRelations = relations(blockedTime, ({ one }) => ({
  staff: one(staffMembers, { fields: [blockedTime.staffId], references: [staffMembers.id] }),
}));

export const invoicesRelations = relations(invoices, ({ one, many }) => ({
  family: one(families, { fields: [invoices.familyId], references: [families.id] }),
  lineItems: many(invoiceLineItems),
  ledgerEntries: many(ledgerEntries),
}));

export const invoiceLineItemsRelations = relations(invoiceLineItems, ({ one }) => ({
  invoice: one(invoices, { fields: [invoiceLineItems.invoiceId], references: [invoices.id] }),
  lesson: one(lessons, { fields: [invoiceLineItems.lessonId], references: [lessons.id] }),
}));

export const ledgerEntriesRelations = relations(ledgerEntries, ({ one }) => ({
  family: one(families, { fields: [ledgerEntries.familyId], references: [families.id] }),
  invoice: one(invoices, { fields: [ledgerEntries.invoiceId], references: [invoices.id] }),
}));

export const paymentsRelations = relations(payments, ({ one }) => ({
  family: one(families, { fields: [payments.familyId], references: [families.id] }),
  invoice: one(invoices, { fields: [payments.invoiceId], references: [invoices.id] }),
}));

export const paymentClaimsRelations = relations(paymentClaims, ({ one }) => ({
  family: one(families, { fields: [paymentClaims.familyId], references: [families.id] }),
  invoice: one(invoices, { fields: [paymentClaims.invoiceId], references: [invoices.id] }),
  payment: one(payments, { fields: [paymentClaims.paymentId], references: [payments.id] }),
}));

export const bankTransactionsRelations = relations(bankTransactions, ({ one }) => ({
  matchedFamily: one(families, { fields: [bankTransactions.matchedFamilyId], references: [families.id] }),
  claim: one(paymentClaims, { fields: [bankTransactions.matchedClaimId], references: [paymentClaims.id] }),
}));

export const payrollRunsRelations = relations(payrollRuns, ({ one, many }) => ({
  staff: one(staffMembers, { fields: [payrollRuns.staffId], references: [staffMembers.id] }),
  items: many(payrollItems),
}));

export const payrollItemsRelations = relations(payrollItems, ({ one }) => ({
  run: one(payrollRuns, { fields: [payrollItems.payrollRunId], references: [payrollRuns.id] }),
  lesson: one(lessons, { fields: [payrollItems.lessonId], references: [lessons.id] }),
}));

export const expensesRelations = relations(expenses, ({ one }) => ({
  staff: one(staffMembers, { fields: [expenses.staffId], references: [staffMembers.id] }),
  receiptFile: one(files, { fields: [expenses.receiptFileId], references: [files.id] }),
}));

export const rateChangeRequestsRelations = relations(rateChangeRequests, ({ one }) => ({
  staff: one(staffMembers, { fields: [rateChangeRequests.staffId], references: [staffMembers.id] }),
}));

export const threadsRelations = relations(threads, ({ one, many }) => ({
  createdByUser: one(users, { fields: [threads.createdBy], references: [users.id] }),
  participants: many(threadParticipants),
  messages: many(messages),
}));

export const threadParticipantsRelations = relations(threadParticipants, ({ one }) => ({
  thread: one(threads, { fields: [threadParticipants.threadId], references: [threads.id] }),
  user: one(users, { fields: [threadParticipants.userId], references: [users.id] }),
}));

export const messagesRelations = relations(messages, ({ one }) => ({
  thread: one(threads, { fields: [messages.threadId], references: [threads.id] }),
  sender: one(users, { fields: [messages.senderId], references: [users.id] }),
}));

export const notificationRulesRelations = relations(notificationRules, ({ many }) => ({
  logs: many(notificationLog),
}));

export const registrationsRelations = relations(registrations, ({ one }) => ({
  decidedByUser: one(users, { fields: [registrations.decidedBy], references: [users.id] }),
}));

export const newsPostsRelations = relations(newsPosts, ({ one }) => ({
  author: one(users, { fields: [newsPosts.authorId], references: [users.id] }),
}));

export const notesRelations = relations(notes, ({ one }) => ({
  student: one(students, { fields: [notes.studentId], references: [students.id] }),
  author: one(users, { fields: [notes.authorId], references: [users.id] }),
}));

export const staffAvailabilityRelations = relations(staffAvailability, ({ one }) => ({
  staff: one(staffMembers, { fields: [staffAvailability.staffId], references: [staffMembers.id] }),
}));

export const resourcesRelations = relations(resources, ({ one }) => ({
  file: one(files, { fields: [resources.fileId], references: [files.id] }),
  owner: one(users, { fields: [resources.ownerId], references: [users.id] }),
  teacher: one(staffMembers, { fields: [resources.teacherId], references: [staffMembers.id] }),
  student: one(students, { fields: [resources.studentId], references: [students.id] }),
}));

export const repertoirePiecesRelations = relations(repertoirePieces, ({ one }) => ({
  student: one(students, { fields: [repertoirePieces.studentId], references: [students.id] }),
  teacher: one(staffMembers, { fields: [repertoirePieces.teacherId], references: [staffMembers.id] }),
}));
