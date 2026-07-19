import { IsArray, IsOptional, IsUUID, ArrayMaxSize } from 'class-validator';

export class MarkPresentBulkDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  lessonIds?: string[];
}
