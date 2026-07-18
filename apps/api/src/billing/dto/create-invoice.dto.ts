import { IsUUID, IsIn, IsOptional, IsString, IsDateString, IsBoolean } from 'class-validator';

export class CreateInvoiceDto {
  @IsUUID()
  familyId!: string;

  @IsIn(['monthly_statement', 'per_lesson'])
  mode!: 'monthly_statement' | 'per_lesson';

  // When false, the invoice is created empty for manual line items only (the
  // "custom amount" flow). Defaults to itemising the period's lessons.
  @IsOptional()
  @IsBoolean()
  itemizeLessons?: boolean;

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
