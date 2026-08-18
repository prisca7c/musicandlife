import { IsString, MaxLength } from 'class-validator';

export class ResetPasswordDto {
  @IsString()
  token!: string;

  @IsString()
  @MaxLength(128)
  password!: string;
}
