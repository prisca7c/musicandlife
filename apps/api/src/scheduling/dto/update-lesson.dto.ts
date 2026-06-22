import { IsOptional, IsDateString, IsInt, IsUUID, IsString, Min, IsIn } from 'class-validator';

export class UpdateLessonDto {
  @IsOptional()
  @IsDateString()
  startsAt?: string;

  @IsOptional()
  @IsInt()
  @Min(15)
  duration?: number;

  @IsOptional()
  @IsUUID()
  teacherId?: string;

  @IsOptional()
  @IsUUID()
  roomId?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
