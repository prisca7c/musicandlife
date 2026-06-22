import { IsUUID, IsOptional, IsIn } from 'class-validator';

export class AssignStudentDto {
  @IsUUID()
  studentId!: string;

  @IsOptional()
  @IsIn(['primary', 'secondary'])
  role?: 'primary' | 'secondary';
}
