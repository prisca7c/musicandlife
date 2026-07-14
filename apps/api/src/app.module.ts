import { Logger, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import Redis from 'ioredis';
import { getRedisConnection } from './common/redis-connection';
import { RedisThrottlerStorage } from './common/redis-throttler.storage';
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
    // Rate limiting. Counters live in Redis (shared across instances + survive
    // restarts) when REDIS_URL is set; otherwise the built-in in-memory store is
    // used (local dev, where REDIS_URL is intentionally blank).
    ThrottlerModule.forRootAsync({
      useFactory: () => {
        const throttlers = [{ name: 'default', ttl: 60_000, limit: 120 }];
        const conn = getRedisConnection();
        if (!conn) return { throttlers };
        const redis = new Redis({ ...conn, maxRetriesPerRequest: null, enableOfflineQueue: false, lazyConnect: true });
        redis.on('error', (e) => new Logger('ThrottlerRedis').warn(`Redis error: ${e.message}`));
        redis.connect().catch((e) => new Logger('ThrottlerRedis').warn(`Redis connect failed: ${e.message}`));
        return { throttlers, storage: new RedisThrottlerStorage(redis) };
      },
    }),
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
  providers: [
    // Register the ThrottlerGuard globally so the @Throttle policies already
    // declared on the auth routes (login 5/min, register 3/min, reset 3/hr, …)
    // and the default 120/min limit are actually enforced. Without this the
    // ThrottlerModule is loaded but no request is ever rate-limited.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
