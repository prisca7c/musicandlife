import { IsString, IsInt, Min, Max, MaxLength, MinLength, IsDateString, IsOptional, IsUUID } from 'class-validator';

export class CreateExpenseDto {
  // Optional: only honoured for management callers filing on behalf of a staff
  // member. Teacher callers are scoped to their own record in the service.
  @IsOptional()
  @IsUUID()
  staffId?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  category!: string;

  // Pence. Upper bound blocks an overflow value from 500'ing the integer column.
  @IsInt()
  @Min(1)
  @Max(1_000_000) // £10,000
  amount!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100_000)
  mileageKm?: number;

  @IsDateString()
  date!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsUUID()
  receiptFileId?: string;
}
