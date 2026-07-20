import { IsUUID, IsIn, IsInt, Min, Max, IsOptional, IsString } from 'class-validator';

export class RecordPaymentDto {
  @IsUUID()
  familyId!: string;

  @IsOptional()
  @IsUUID()
  invoiceId?: string;

  @IsIn(['bank_transfer', 'cash', 'card', 'other'])
  method!: 'bank_transfer' | 'cash' | 'card' | 'other';

  // Pence. Upper bound keeps an out-of-range value from overflowing the integer
  // column (and the cached balance) and surfacing as an unhandled 500.
  @IsInt()
  @Min(1)
  @Max(100_000_000) // £1,000,000
  amount!: number;

  @IsOptional()
  @IsString()
  providerRef?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  // Client-supplied de-duplication key. Send a stable value per logical payment
  // (e.g. a UUID generated when the "Record payment" form is opened) so a
  // double-click / retry records the payment exactly once. Cash/card payments
  // have no provider reference, so without this a double-submit would otherwise
  // create two payments and double-count the balance.
  @IsOptional()
  @IsString()
  idempotencyKey?: string;
}
