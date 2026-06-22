import { IsString, IsDateString, IsOptional, IsIn, IsInt, Min } from 'class-validator';

export class CreateTermDto {
  @IsString()
  name!: string;

  @IsDateString()
  startsOn!: string;

  @IsDateString()
  endsOn!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  weekCount?: number;

  @IsOptional()
  @IsIn(['planned', 'active', 'closed'])
  status?: 'planned' | 'active' | 'closed';
}
