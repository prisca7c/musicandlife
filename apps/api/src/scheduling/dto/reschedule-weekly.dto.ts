import { IsIn, IsString, Matches, IsOptional, IsDateString } from 'class-validator';

export class RescheduleWeeklyDto {
  @IsIn(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'])
  weekday!: string;

  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  startTime!: string;

  // When to start applying the new day/time. Omitted = right away, cancelling
  // every future lesson and regenerating from now. A future date leaves
  // lessons before it on the OLD day/time untouched and only moves the series
  // from that date onward — e.g. "keep Tuesdays until half-term, then Thursdays".
  @IsOptional()
  @IsDateString()
  effectiveFrom?: string;
}
