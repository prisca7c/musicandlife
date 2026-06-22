import { IsString, IsArray, IsUUID, IsOptional } from 'class-validator';

export class CreateThreadDto {
  @IsString()
  subject!: string;

  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  participantIds?: string[];

  @IsString()
  body!: string;
}
