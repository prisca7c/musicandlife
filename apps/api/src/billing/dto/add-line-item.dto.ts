import { IsInt, IsOptional, IsString, IsUUID, Min, Max, MaxLength, MinLength } from 'class-validator';

// Manual line item added to an existing invoice. Amounts are in pennies and
// MUST be whole integers — the DB column is an integer, so a float (e.g. 12.999)
// or an out-of-range value used to reach the database and surface as an
// unhandled 500. Negative amounts stay allowed on purpose so staff can add a
// discount/credit line, but the magnitude is bounded well inside the 32-bit
// integer range to prevent overflow.
export class AddLineItemDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  description!: string;

  @IsInt()
  @Min(-10_000_000) // -£100,000
  @Max(10_000_000) // +£100,000
  amount!: number;

  @IsOptional()
  @IsUUID()
  lessonId?: string;
}
