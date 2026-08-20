import { IsDateString } from 'class-validator';

// No staffId — a teacher may only ever request a run for themselves,
// resolved server-side from the caller's own user id.
export class RequestMyPayrollRunDto {
  @IsDateString()
  periodStart!: string;

  @IsDateString()
  periodEnd!: string;
}
