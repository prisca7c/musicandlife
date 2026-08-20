import { IsString, IsDateString, IsOptional, IsIn, IsInt, IsArray, ValidateNested, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { TermExceptionDto } from './term-exception.dto';

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

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TermExceptionDto)
  exceptionWeeks?: TermExceptionDto[];
}
