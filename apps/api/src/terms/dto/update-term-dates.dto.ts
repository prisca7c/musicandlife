import { IsDateString } from 'class-validator';

export class UpdateTermDatesDto {
  @IsDateString()
  startsOn!: string;

  @IsDateString()
  endsOn!: string;
}
