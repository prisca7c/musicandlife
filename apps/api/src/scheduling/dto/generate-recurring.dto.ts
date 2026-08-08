import { IsUUID, IsOptional, IsInt, Min, Max, IsDateString } from 'class-validator';

export class GenerateRecurringDto {
  @IsUUID()
  enrollmentId!: string;

  // Optional override of how many weeks ahead to materialise up front. The
  // series itself never stops on its own — MaterializeAllRecurring (the daily
  // worker) keeps topping it up forever as long as the enrolment stays active
  // with a weekly scheduleRule — so this only sizes the initial visible batch.
  // Bounded well above any real request purely as a sanity rail against a
  // typo'd value looping the insert an absurd number of times.
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(520)
  weeks?: number;

  // Optional start date; occurrences begin from this instant instead of now
  // (used when booking a recurring lesson that starts on a chosen future date).
  @IsOptional()
  @IsDateString()
  startFrom?: string;
}
