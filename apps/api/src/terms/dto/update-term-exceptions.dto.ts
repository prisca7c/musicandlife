import { IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { TermExceptionDto } from './term-exception.dto';

export class UpdateTermExceptionsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TermExceptionDto)
  exceptionWeeks!: TermExceptionDto[];
}
