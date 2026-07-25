import { IsString, IsOptional, IsIn, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

export class CreateLeadDto {
  // Trim BEFORE MinLength(1) so a whitespace-only name ("   ") collapses to ""
  // and is rejected rather than stored as a blank-looking lead row. (QA H15)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  contact?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  instrumentInterest?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  source?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class UpdateLeadDto {
  @IsOptional()
  @IsIn(['new', 'contacted', 'converted', 'lost'])
  status?: 'new' | 'contacted' | 'converted' | 'lost';

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  contact?: string;
}
