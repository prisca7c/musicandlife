import { IsUUID, IsIn, IsInt, Min, IsOptional, IsString } from 'class-validator';

export class RecordPaymentDto {
  @IsUUID()
  familyId!: string;

  @IsOptional()
  @IsUUID()
  invoiceId?: string;

  @IsIn(['bank_transfer', 'cash', 'card', 'gocardless', 'revolut', 'other'])
  method!: 'bank_transfer' | 'cash' | 'card' | 'gocardless' | 'revolut' | 'other';

  @IsInt()
  @Min(1)
  amount!: number;

  @IsOptional()
  @IsString()
  providerRef?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
