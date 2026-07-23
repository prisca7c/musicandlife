import { IsString, IsUUID, IsInt, IsOptional, Min, Max, MaxLength } from 'class-validator';

/**
 * A file already uploaded via /files/sign-upload, being attached to a message.
 * Only the id is trusted — name/mime/size are display metadata and are
 * re-checked against the files table before the attachment is stored.
 */
export class MessageAttachmentDto {
  @IsUUID() fileId!: string;
  @IsOptional() @IsString() @MaxLength(255) name?: string;
  @IsOptional() @IsString() @MaxLength(255) mime?: string;
  @IsOptional() @IsInt() @Min(0) @Max(200 * 1024 * 1024) size?: number;
}
