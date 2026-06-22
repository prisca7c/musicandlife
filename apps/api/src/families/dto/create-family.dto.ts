import { IsString, IsOptional, IsEmail, IsBoolean, IsIn } from 'class-validator';

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
}
