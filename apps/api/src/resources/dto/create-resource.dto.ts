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

  @IsIn(['studio', 'teacher', 'family', 'student'])
  scope!: 'studio' | 'teacher' | 'family' | 'student';
}
