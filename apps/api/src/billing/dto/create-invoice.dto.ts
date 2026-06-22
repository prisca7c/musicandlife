import { IsUUID, IsIn, IsOptional, IsString, IsDateString } from 'class-validator';

export class CreateInvoiceDto {
  @IsUUID()
  familyId!: string;

  @IsIn(['monthly_statement', 'per_lesson'])
  mode!: 'monthly_statement' | 'per_lesson';

  @IsOptional()
  @IsUUID()
  termId?: string;

  @IsOptional()
  @IsDateString()
  periodStart?: string;

  @IsOptional()
  @IsDateString()
  periodEnd?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
