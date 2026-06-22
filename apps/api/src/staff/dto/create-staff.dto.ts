import { IsString, IsOptional, IsEmail, IsArray, IsInt, Min, IsIn } from 'class-validator';

export class CreateStaffDto {
  @IsString()
  firstName!: string;

  @IsString()
  lastName!: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  instruments?: string[];

  @IsOptional()
  @IsInt()
  @Min(1)
  defaultDuration?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  hourlyRate?: number;

  @IsOptional()
  @IsIn(['active', 'inactive'])
  status?: 'active' | 'inactive';
}
