import { IsIn, IsOptional, IsDateString } from 'class-validator';

export class MarkAttendanceDto {
  // present            → lesson happened, teacher paid, 1 credit consumed
  // absent_makeup      → student gave ≥24h + wants to rebook; teacher NOT paid; no charge, no credit consumed or issued
  // absent_no_makeup   → student gave <24h (late cancel); teacher IS paid; 1 credit consumed, no makeup
  // absent_no_pay      → student gave ≥24h + chose no lesson, or teacher cancelled; no charge, no pay
  // cancelled_teacher  → teacher cancelled; no charge, no pay
  @IsIn(['present', 'absent_makeup', 'absent_no_makeup', 'absent_no_pay', 'cancelled_teacher'])
  status!: 'present' | 'absent_makeup' | 'absent_no_makeup' | 'absent_no_pay' | 'cancelled_teacher';

  @IsOptional()
  @IsDateString()
  actualStartedAt?: string;

  @IsOptional()
  @IsDateString()
  actualEndedAt?: string;
}
