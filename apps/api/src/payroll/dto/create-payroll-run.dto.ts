import { IsUUID, IsDateString } from 'class-validator';

export class CreatePayrollRunDto {
  @IsUUID()
  staffId!: string;

  @IsDateString()
  periodStart!: string;

  @IsDateString()
  periodEnd!: string;
}
