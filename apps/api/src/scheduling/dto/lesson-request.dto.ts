import { IsArray, ArrayMinSize, ArrayMaxSize, IsDateString, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

export class CreateLessonRequestDto {
  @IsUUID()
  studentId!: string;

  @IsUUID()
  teacherId!: string;

  @IsOptional()
  @IsUUID()
  enrollmentId?: string;

  @IsOptional()
  @IsInt()
  @Min(15)
  @Max(240)
  duration?: number;

  // 1st choice (required) + optional 2nd / 3rd ranked times. The teacher confirms one.
  @IsDateString()
  proposedStartsAt!: string;

  @IsOptional()
  @IsDateString()
  proposedStartsAt2?: string;

  @IsOptional()
  @IsDateString()
  proposedStartsAt3?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class DecideLessonRequestDto {
  @IsOptional()
  @IsString()
  reason?: string;

  // Which ranked time the teacher confirms. Must match one of the proposed times;
  // defaults to the 1st choice when omitted.
  @IsOptional()
  @IsDateString()
  chosenStartsAt?: string;
}

/**
 * The teacher's own suggested times, offered when none of the front desk's
 * proposals work. Up to three, validated against the teacher's availability and
 * existing lessons before they're stored.
 */
export class CounterProposeLessonRequestDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(3)
  @IsDateString({}, { each: true })
  times!: string[];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
