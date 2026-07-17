import { IsDateString } from 'class-validator';

export class BatchPayrollRunDto {
  @IsDateString()
  periodStart!: string;

  @IsDateString()
  periodEnd!: string;
}
