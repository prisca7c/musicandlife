import { IsUUID, IsDateString, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class CreateLessonDto {
  @IsUUID()
  studentId!: string;

  @IsDateString()
  startsAt!: string;

  @IsOptional()
  @IsInt()
  @Min(15)
  duration?: number;

  @IsOptional()
  @IsUUID()
  teacherId?: string;

  @IsOptional()
  @IsUUID()
  roomId?: string;

  @IsOptional()
  @IsUUID()
  enrollmentId?: string;

  @IsOptional()
  @IsUUID()
  termId?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
