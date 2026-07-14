import { IsUUID, IsOptional, IsInt, Min, Max, IsDateString } from 'class-validator';

export class GenerateRecurringDto {
  @IsUUID()
  enrollmentId!: string;

  // Optional override of how many weeks ahead to materialise (1..52).
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(52)
  weeks?: number;

  // Optional start date; occurrences begin from this instant instead of now
  // (used when booking a recurring lesson that starts on a chosen future date).
  @IsOptional()
  @IsDateString()
  startFrom?: string;
}
