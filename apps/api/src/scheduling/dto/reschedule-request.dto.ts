import { IsDateString, IsOptional, IsUUID } from 'class-validator';

export class CreateRescheduleRequestDto {
  @IsUUID()
  lessonId!: string;

  @IsDateString()
  proposedStartsAt!: string;

  @IsOptional()
  @IsUUID()
  proposedRoomId?: string;
}

export class DecideRescheduleDto {
  @IsOptional()
  reason?: string;
}
