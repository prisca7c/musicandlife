import { IsIn, IsOptional, IsString } from 'class-validator';

export class CancelLessonDto {
  // cancelled_no_makeup  = student gave <24h notice (late), teacher paid, no credit
  // cancelled_no_pay     = student gave ≥24h + chose no lesson, or teacher cancelled
  // cancelled_teacher    = teacher cancelled
  @IsIn(['cancelled_no_makeup', 'cancelled_no_pay', 'cancelled_teacher'])
  reason!: 'cancelled_no_makeup' | 'cancelled_no_pay' | 'cancelled_teacher';

  @IsOptional()
  @IsString()
  notes?: string;
}
