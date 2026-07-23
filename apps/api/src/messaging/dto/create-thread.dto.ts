import { IsString, IsArray, IsUUID, IsOptional, ValidateNested, ArrayMaxSize } from 'class-validator';
import { Type } from 'class-transformer';
import { MessageAttachmentDto } from './attachment.dto';

export class CreateThreadDto {
  @IsString()
  subject!: string;

  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  participantIds?: string[];

  @IsString()
  body!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => MessageAttachmentDto)
  attachments?: MessageAttachmentDto[];
}
