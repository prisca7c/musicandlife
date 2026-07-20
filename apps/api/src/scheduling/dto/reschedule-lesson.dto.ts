import { IsDateString } from 'class-validator';

// Direct (staff) reschedule of an existing lesson. startsAt is a naive
// studio-local wall-clock string (parsed to the org timezone server-side), so
// @IsDateString accepts it while rejecting garbage that previously 500'd.
export class RescheduleLessonDto {
  @IsDateString()
  startsAt!: string;
}
