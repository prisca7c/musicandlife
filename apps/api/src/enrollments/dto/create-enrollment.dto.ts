import { IsString, IsOptional, IsUUID, IsIn, IsInt, Min, Max, MaxLength, IsBoolean, ValidateNested, Matches } from 'class-validator';
import { Type } from 'class-transformer';

// The weekly recurrence rule that drives lesson generation. Previously the
// enrollment DTO accepted this as a bare @IsObject(), so a malformed weekday or
// an out-of-range startTime (e.g. "25:00") was persisted and later produced
// lessons at the wrong instant. Validate the shape the recurrence worker expects.
export class ScheduleRuleDto {
  @IsIn(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'])
  weekday!: string;

  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  startTime!: string;
}

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
  @ValidateNested()
  @Type(() => ScheduleRuleDto)
  scheduleRule?: ScheduleRuleDto;

  @IsOptional()
  @IsBoolean()
  autoRenew?: boolean;

  @IsOptional()
  @IsIn(['trial', 'active', 'paused', 'withdrawn'])
  status?: 'trial' | 'active' | 'paused' | 'withdrawn';
}
