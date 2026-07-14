import { IsString, IsOptional, IsUUID, IsIn, IsInt, Min, IsBoolean, IsObject } from 'class-validator';

export class CreateEnrollmentDto {
  @IsOptional()
  @IsUUID()
  termId?: string;

  @IsString()
  instrument!: string;

  @IsIn(['private', 'group'])
  lessonType!: 'private' | 'group';

  @IsOptional()
  @IsString()
  groupName?: string;

  @IsOptional()
  @IsUUID()
  teacherId?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  rate?: number;

  // The UI sends the chosen lesson length as `duration`; it's persisted on the
  // enrollment as `defaultDuration` (the column name) by the service.
  @IsOptional()
  @IsInt()
  @Min(15)
  duration?: number;

  @IsOptional()
  @IsObject()
  scheduleRule?: { weekday: string; startTime: string };

  @IsOptional()
  @IsBoolean()
  autoRenew?: boolean;

  @IsOptional()
  @IsIn(['trial', 'active', 'paused', 'withdrawn'])
  status?: 'trial' | 'active' | 'paused' | 'withdrawn';
}
