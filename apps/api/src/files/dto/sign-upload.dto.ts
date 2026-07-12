import { IsBoolean, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

// 100 MB — generous for lesson materials / documents while capping abuse.
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

export class SignUploadDto {
  // Must be a well-formed "type/subtype" mime — rejects empty/garbage that a raw
  // @IsString() would let through (an empty string is still a valid string).
  @IsString()
  @MaxLength(255)
  @Matches(/^[a-zA-Z0-9][\w.+-]*\/[a-zA-Z0-9][\w.+-]*$/, { message: 'mime must be a valid MIME type' })
  mime!: string;

  // Positive, and bounded well below int4 overflow (which previously 500'd the request).
  @IsInt()
  @Min(1)
  @Max(MAX_UPLOAD_BYTES)
  size!: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  originalName?: string;

  @IsOptional()
  @IsBoolean()
  expiring?: boolean;
}
