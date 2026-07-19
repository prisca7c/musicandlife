import { IsObject, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateOrgDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name?: string;

  // Studio settings blob (bank details, invoice notes, feature flags, …). Kept
  // as an open object — admin-only and intentionally extensible — but bounded to
  // an object so a stray non-object value can't reach the jsonb column.
  @IsOptional()
  @IsObject()
  settings?: Record<string, unknown>;
}
