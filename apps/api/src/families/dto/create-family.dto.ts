import { IsString, IsOptional, IsEmail, IsBoolean, IsIn, IsDateString, IsInt } from 'class-validator';

export class CreateFamilyDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  contactName?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsBoolean()
  autoInvoice?: boolean;

  @IsOptional()
  @IsIn(['monthly_statement', 'per_lesson'])
  invoiceMode?: 'monthly_statement' | 'per_lesson';

  // ─── Auto-invoicing settings ──────────────────────────────────────────────
  @IsOptional()
  @IsDateString()
  billingStartDate?: string;

  @IsOptional()
  @IsIn(['prepaid', 'postpaid'])
  billingMode?: 'prepaid' | 'postpaid';

  @IsOptional()
  @IsInt()
  invoiceDateOffsetDays?: number;

  @IsOptional()
  @IsInt()
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
  invoiceFooterNote?: string;

  // ─── Resource-access subscription (separate from lesson billing) ─────────
  @IsOptional()
  @IsDateString()
  resourceAccessPaidUntil?: string;
}
