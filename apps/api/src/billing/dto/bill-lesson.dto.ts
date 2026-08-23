import { IsIn, IsOptional } from 'class-validator';

export class BillLessonDto {
  // Omitted = send the invoice by email only, still unpaid. Set this to
  // immediately record the payment too — for a family that pays in person and
  // never opens the portal at all.
  @IsOptional()
  @IsIn(['cash', 'bank_transfer'])
  settleMethod?: 'cash' | 'bank_transfer';
}
