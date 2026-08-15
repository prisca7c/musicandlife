import { IsString, IsOptional, IsEmail, IsBoolean, IsIn, IsDateString, IsInt, Min, Max, MaxLength } from 'class-validator';

// Length caps mirror SubmitRegistrationDto's (the public equivalent of this
// form) — this endpoint is staff-only, not public, but had no caps at all,
// letting an authenticated caller store an unbounded string in a `text`
// column with no DB-level limit.
export class CreateFamilyDto {
  @IsString()
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  contactName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  email?: string;

  @IsOptional()
  @IsBoolean()
  autoInvoice?: boolean;

  @IsOptional()
  @IsIn(['monthly_statement', 'per_lesson', 'custom'])
  invoiceMode?: 'monthly_statement' | 'per_lesson' | 'custom';

  // Only meaningful when invoiceMode = 'custom' — how often to invoice.
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  customIntervalValue?: number;

  @IsOptional()
  @IsIn(['day', 'week', 'month', 'year'])
  customIntervalUnit?: 'day' | 'week' | 'month' | 'year';

  // ─── Auto-invoicing settings ──────────────────────────────────────────────
  @IsOptional()
  @IsDateString()
  billingStartDate?: string;

  @IsOptional()
  @IsIn(['prepaid', 'postpaid'])
  billingMode?: 'prepaid' | 'postpaid';

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(90)
  invoiceDateOffsetDays?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(90)
  dueDateOffsetDays?: number;

  @IsOptional()
  @IsIn(['condensed', 'normal', 'expanded'])
  invoiceFormat?: 'condensed' | 'normal' | 'expanded';

  @IsOptional()
  @IsBoolean()
  includePreviousBalance?: boolean;

  @IsOptional()
  @IsBoolean()
  autoEmailInvoice?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  invoiceFooterNote?: string;

  // ─── Resource-access subscription (separate from lesson billing) ─────────
  @IsOptional()
  @IsDateString()
  resourceAccessPaidUntil?: string;
}
