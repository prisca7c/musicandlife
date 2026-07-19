import { IsString, IsOptional, IsUUID, IsIn, IsInt, Min, Max, MaxLength, IsBoolean, IsObject } from 'class-validator';

export class CreateEnrollmentDto {
  @IsOptional()
  @IsUUID()
  termId?: string;

  @IsString()
  @MaxLength(80)
  instrument!: string;

  @IsIn(['private', 'group'])
  lessonType!: 'private' | 'group';

  @IsOptional()
  @IsString()
  @MaxLength(120)
  groupName?: string;

  @IsOptional()
  @IsUUID()
  teacherId?: string;

  // Pence per lesson. Upper bound keeps an overflow value from 500'ing the int column.
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000) // £10,000
  rate?: number;

  // The UI sends the chosen lesson length as `duration`; it's persisted on the
  // enrollment as `defaultDuration` (the column name) by the service.
  @IsOptional()
  @IsInt()
  @Min(15)
  @Max(600)
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
