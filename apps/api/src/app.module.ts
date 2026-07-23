import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { HealthModule } from './health/health.module';
import { DbModule } from './db/db.module';
import { EmailModule } from './email/email.module';
import { AuthModule } from './auth/auth.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { UsersModule } from './users/users.module';
import { FamiliesModule } from './families/families.module';
import { StudentsModule } from './students/students.module';
import { StaffModule } from './staff/staff.module';
import { EnrollmentsModule } from './enrollments/enrollments.module';
import { TermsModule } from './terms/terms.module';
import { SchedulingModule } from './scheduling/scheduling.module';
import { AttendanceModule } from './attendance/attendance.module';
import { BillingModule } from './billing/billing.module';
import { PayrollModule } from './payroll/payroll.module';
import { NotificationsModule } from './notifications/notifications.module';
import { MessagingModule } from './messaging/messaging.module';
import { RegistrationModule } from './registration/registration.module';
import { LeadsModule } from './leads/leads.module';
import { FilesModule } from './files/files.module';
import { ResourcesModule } from './resources/resources.module';
import { ReportsModule } from './reports/reports.module';
import { NotesModule } from './notes/notes.module';
import { RepertoireModule } from './repertoire/repertoire.module';
import { NewsModule } from './news/news.module';
import { BroadcastModule } from './broadcasts/broadcast.module';
import { FamilyPortalModule } from './family-portal/family-portal.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '../../.env' }),
    // In-process cron for the periodic maintenance jobs (recurrence generation,
    // reminders, auto-invoicing, attendance auto-complete). Each job guards
    // itself with a Postgres advisory lock so it stays single-run if the app is
    // ever scaled past one instance — no external queue/Redis needed.
    ScheduleModule.forRoot(),
    // Rate limiting with the built-in in-memory counter. The API runs as a
    // single instance, so a per-process counter is authoritative; this keeps the
    // app off any external Redis.
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 120 }]),
    DbModule, EmailModule,
    // @Global modules first
    NotificationsModule, FilesModule,
    AuthModule, OrganizationsModule, UsersModule,
    // PayrollModule before StaffModule so /staff/payroll beats /staff/:id
    PayrollModule, BillingModule,
    FamiliesModule, StudentsModule, StaffModule, EnrollmentsModule, TermsModule,
    SchedulingModule, AttendanceModule,
    MessagingModule, RegistrationModule, LeadsModule,
    ResourcesModule, ReportsModule,
    NotesModule, RepertoireModule, NewsModule, BroadcastModule, FamilyPortalModule,
    HealthModule,
  ],
  providers: [
    // Register the ThrottlerGuard globally so the @Throttle policies already
    // declared on the auth routes (login 5/min, register 3/min, reset 3/hr, …)
    // and the default 120/min limit are actually enforced. Without this the
    // ThrottlerModule is loaded but no request is ever rate-limited.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
