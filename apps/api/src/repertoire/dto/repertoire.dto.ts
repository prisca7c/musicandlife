import { IsUUID, IsString, IsOptional, IsIn, MinLength, MaxLength } from 'class-validator';

export const REPERTOIRE_STATUSES = ['learning', 'polishing', 'performance_ready', 'completed'] as const;

export class CreatePieceDto {
  @IsUUID() studentId!: string;

  @IsString() @MinLength(1) @MaxLength(200)
  title!: string;

  @IsOptional() @IsString() @MaxLength(200) composer?: string;
  @IsOptional() @IsString() @MaxLength(60) instrument?: string;
  @IsOptional() @IsIn(REPERTOIRE_STATUSES) status?: (typeof REPERTOIRE_STATUSES)[number];
  @IsOptional() @IsString() @MaxLength(2_000) notes?: string;
}

export class UpdatePieceDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(200) title?: string;
  @IsOptional() @IsString() @MaxLength(200) composer?: string;
  @IsOptional() @IsString() @MaxLength(60) instrument?: string;
  @IsOptional() @IsIn(REPERTOIRE_STATUSES) status?: (typeof REPERTOIRE_STATUSES)[number];
  @IsOptional() @IsString() @MaxLength(2_000) notes?: string;
}
