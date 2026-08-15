import { IsString, IsOptional, IsEmail, IsArray, IsInt, Min, Max, MaxLength, IsIn } from 'class-validator';

export class CreateStaffDto {
  @IsString()
  @MaxLength(100)
  firstName!: string;

  @IsString()
  @MaxLength(100)
  lastName!: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  instruments?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  groupTags?: string[];

  // Pence. Carried-over running balance — see schema comment on payrollBalance.
  // Nullable: null means "paid outside payroll", not "£0".
  @IsOptional()
  @IsInt()
  @Min(-100_000_000)
  @Max(100_000_000)
  payrollBalance?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(600) // minutes
  defaultDuration?: number;

  // Pence/hour. Upper bound keeps an overflow value from 500'ing the int column.
  // Nullable: null means "paid outside payroll", not "£0/hr".
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000, { message: 'Hourly rate must not exceed £10,000.' }) // £10,000/hr
  hourlyRate?: number | null;

  @IsOptional()
  @IsIn(['active', 'inactive'])
  status?: 'active' | 'inactive';
}
