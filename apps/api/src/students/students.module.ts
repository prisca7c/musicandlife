import { Module } from '@nestjs/common';
import { StudentsController } from './students.controller';
import { StudentsService } from './students.service';
import { EnrollmentsModule } from '../enrollments/enrollments.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule, EnrollmentsModule],
  controllers: [StudentsController],
  providers: [StudentsService],
  exports: [StudentsService],
})
export class StudentsModule {}
