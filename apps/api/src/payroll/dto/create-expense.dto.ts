import { IsString, IsInt, Min, IsDateString, IsOptional, IsUUID } from 'class-validator';

export class CreateExpenseDto {
  @IsOptional()
  @IsUUID()
  staffId?: string;

  @IsString()
  category!: string;

  @IsInt()
  @Min(1)
  amount!: number;

  @IsOptional()
  @IsInt()
  mileageKm?: number;

  @IsDateString()
  date!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsUUID()
  receiptFileId?: string;
}
