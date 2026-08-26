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

  // Scope itemisation to one class (enrolment) instead of every student in the family.
  @IsOptional()
  @IsUUID()
  enrollmentId?: string;

  // Also itemise lessons that haven't happened yet ('scheduled'/'makeup'), not just
  // 'completed' ones — for invoicing a family ahead of time. Safe against double
  // charging: the ledger debit is always posted separately by attendance when the
  // lesson is actually marked present, regardless of when it was invoiced.
  @IsOptional()
  @IsBoolean()
  includeFuture?: boolean;
}
