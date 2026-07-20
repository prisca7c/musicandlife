import { IsDateString, IsOptional, IsUUID } from 'class-validator';

export class CreateRescheduleRequestDto {
  @IsUUID()
  lessonId!: string;

  // 1st choice (required)
  @IsDateString()
  proposedStartsAt!: string;

  // Optional 2nd / 3rd preferred times, so staff can pick whichever slots best.
  @IsOptional()
  @IsDateString()
  proposedStartsAt2?: string;

  @IsOptional()
  @IsDateString()
  proposedStartsAt3?: string;
}

export class DecideRescheduleDto {
  @IsOptional()
  reason?: string;

  // Which of the family's ranked times to approve. Must match one of the
  // request's proposed times; defaults to the 1st choice when omitted.
  @IsOptional()
  @IsDateString()
  chosenStartsAt?: string;
}
