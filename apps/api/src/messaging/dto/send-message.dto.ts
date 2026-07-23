import { IsString, MinLength, MaxLength, IsOptional, IsArray, ValidateNested, ArrayMaxSize } from 'class-validator';
import { Type } from 'class-transformer';
import { MessageAttachmentDto } from './attachment.dto';

export class SendMessageDto {
  // A message carrying only an attachment is legitimate — "here's the
  // recording" with no words. The body may be empty when files are present;
  // the service enforces that one or the other is there.
  @IsString()
  @MinLength(0)
  @MaxLength(10_000)
  body!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => MessageAttachmentDto)
  attachments?: MessageAttachmentDto[];
}
