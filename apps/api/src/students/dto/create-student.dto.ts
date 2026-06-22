import { IsString, IsOptional, IsEmail, IsUUID, IsIn, IsDateString } from 'class-validator';

export class CreateStudentDto {
  @IsUUID()
  familyId!: string;

  @IsString()
  firstName!: string;

  @IsString()
  lastName!: string;

  @IsOptional()
  @IsDateString()
  dob?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsIn(['trial', 'active', 'paused', 'withdrawn'])
  status?: 'trial' | 'active' | 'paused' | 'withdrawn';

  @IsOptional()
  @IsString()
  notes?: string;
}
