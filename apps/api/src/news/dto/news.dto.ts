import { IsString, IsOptional, IsDateString, MaxLength, MinLength } from 'class-validator';

export class CreateNewsDto {
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  title!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(20_000)
  body!: string;

  @IsOptional()
  @IsDateString()
  publishedAt?: string;
}

export class UpdateNewsDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  title?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(20_000)
  body?: string;

  @IsOptional()
  @IsDateString()
  publishedAt?: string;
}
