import { IsString, IsIn, IsOptional, IsUUID, IsUrl } from 'class-validator';

export class CreateResourceDto {
  @IsString()
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsIn(['file', 'link', 'note'])
  type!: 'file' | 'link' | 'note';

  @IsOptional()
  @IsUUID()
  fileId?: string;

  @IsOptional()
  @IsString()
  url?: string;

  // File resources only: 'download' (sheet music, downloadable) or 'view_only'
  // (video, streamed inline with no download link). Omitted → derived from the
  // file's mime type (video → view_only, everything else → download).
  @IsOptional()
  @IsIn(['download', 'view_only'])
  delivery?: 'download' | 'view_only';

  @IsIn(['studio', 'teacher', 'family', 'student'])
  scope!: 'studio' | 'teacher' | 'family' | 'student';

  // ─── Filter/search tags (independent of `scope`) ───────────────────────────
  @IsOptional()
  @IsString()
  instrument?: string;

  @IsOptional()
  @IsUUID()
  teacherId?: string;

  @IsOptional()
  @IsUUID()
  studentId?: string;
}
