import { IsIn } from 'class-validator';

export class PayAtLessonDto {
  // Money handed over at the lesson is almost always cash or card; the other two
  // are accepted for completeness (a parent who tapped their phone, say).
  @IsIn(['cash', 'card', 'bank_transfer', 'other'])
  method!: 'cash' | 'card' | 'bank_transfer' | 'other';
}
