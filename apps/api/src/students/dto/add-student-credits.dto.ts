import { IsInt, IsIn, IsOptional, Min, Max } from 'class-validator';

export class AddStudentCreditsDto {
  @IsInt()
  @Min(1)
  @Max(100)
  count!: number;

  @IsOptional()
  @IsIn(['prepaid', 'makeup'])
  type?: 'prepaid' | 'makeup';
}
