import { IsInt, IsOptional, IsUUID, Min, Max } from 'class-validator';

export class CreateRateChangeDto {
  // Optional: only honoured for management callers submitting on behalf of a
  // staff member. Teacher callers are always scoped to their own record in the
  // service, regardless of what they send here.
  @IsOptional()
  @IsUUID()
  staffId?: string;

  // Hourly rate in pence. Bounded so an unvalidated float/negative/overflow
  // can't 500 the insert or land an absurd rate awaiting approval.
  @IsInt()
  @Min(0)
  @Max(1_000_000) // £10,000/hr
  requestedRate!: number;
}
