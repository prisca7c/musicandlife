import { IsUUID, IsIn, IsInt, Min, IsOptional, IsString } from 'class-validator';

export class RecordPaymentDto {
  @IsUUID()
  familyId!: string;

  @IsOptional()
  @IsUUID()
  invoiceId?: string;

  @IsIn(['bank_transfer', 'cash', 'card', 'other'])
  method!: 'bank_transfer' | 'cash' | 'card' | 'other';

  @IsInt()
  @Min(1)
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
