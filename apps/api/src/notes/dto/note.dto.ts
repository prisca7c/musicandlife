import { IsUUID, IsOptional, IsString, IsIn, IsArray, MaxLength, MinLength } from 'class-validator';

// Attachments are shape-checked/sanitised by cleanAttachments() in the controller,
// so the DTO only needs to confirm it's an array (kept loose to avoid a second
// source of truth for the attachment shape).
export class CreateNoteDto {
  @IsUUID()
  studentId!: string;

  @IsOptional()
  @IsUUID()
  lessonId?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(10_000)
  body!: string;

  @IsOptional()
  @IsIn(['internal', 'family'])
  visibility?: 'internal' | 'family';

  @IsOptional()
  @IsArray()
  attachments?: unknown[];
}

export class UpdateNoteDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(10_000)
  body?: string;

  @IsOptional()
  @IsIn(['internal', 'family'])
  visibility?: 'internal' | 'family';

  @IsOptional()
  @IsArray()
  attachments?: unknown[];
}
