import { IsArray, IsUUID, IsOptional, IsBoolean, IsIn, IsDateString, IsInt, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class InvoicingSettingsDto {
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

  @IsOptional()
  @IsBoolean()
  autoInvoice?: boolean;

  @IsOptional()
  @IsIn(['monthly_statement', 'per_lesson', 'custom'])
  invoiceMode?: 'monthly_statement' | 'per_lesson' | 'custom';

  @IsOptional()
  @IsInt()
  customIntervalValue?: number;

  @IsOptional()
  @IsIn(['day', 'week', 'month', 'year'])
  customIntervalUnit?: 'day' | 'week' | 'month' | 'year';
}

export class BulkInvoicingSettingsDto {
  @IsArray()
  @IsUUID('4', { each: true })
  familyIds!: string[];

  @ValidateNested()
  @Type(() => InvoicingSettingsDto)
  settings!: InvoicingSettingsDto;
}
