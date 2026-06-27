import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
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
import { RoomsModule } from './rooms/rooms.module';
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
import { NewsModule } from './news/news.module';
import { FamilyPortalModule } from './family-portal/family-portal.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '../../.env' }),
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 120 }]),
    DbModule, EmailModule,
    // @Global modules first
    NotificationsModule, FilesModule,
    AuthModule, OrganizationsModule, UsersModule,
    // PayrollModule before StaffModule so /staff/payroll beats /staff/:id
    PayrollModule, BillingModule,
    FamiliesModule, StudentsModule, StaffModule, EnrollmentsModule, RoomsModule, TermsModule,
    SchedulingModule, AttendanceModule,
    MessagingModule, RegistrationModule, LeadsModule,
    ResourcesModule, ReportsModule,
    NotesModule, NewsModule, FamilyPortalModule,
    HealthModule,
  ],
})
export class AppModule {}
