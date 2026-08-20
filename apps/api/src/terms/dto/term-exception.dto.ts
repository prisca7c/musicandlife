import { IsDateString } from 'class-validator';

export class TermExceptionDto {
  @IsDateString()
  start!: string;

  @IsDateString()
  end!: string;
}
