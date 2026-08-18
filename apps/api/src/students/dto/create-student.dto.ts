import { IsString, IsOptional, IsEmail, IsUUID, IsIn, IsDateString } from 'class-validator';
import { IsRealisticDob } from '../../common/validators/is-realistic-dob';

export class CreateStudentDto {
  @IsUUID()
  familyId!: string;

  @IsString()
  firstName!: string;

  @IsString()
  lastName!: string;

  @IsOptional()
  @IsDateString()
  @IsRealisticDob()
  dob?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsIn(['waiting', 'trial', 'active', 'paused', 'withdrawn'])
  status?: 'trial' | 'active' | 'paused' | 'withdrawn';

  @IsOptional()
  @IsString()
  notes?: string;
}
