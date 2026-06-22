import { IsString, IsEmail, IsOptional, IsDateString, IsArray, IsIn, ValidateNested, IsBoolean } from 'class-validator';
import { Type } from 'class-transformer';

export class InstrumentSelectionDto {
  @IsString()
  instrument!: string;

  @IsIn(['private', 'group'])
  lessonType!: 'private' | 'group';
}

export class SubmitRegistrationDto {
  // Student
  @IsString()
  studentFirstName!: string;

  @IsString()
  studentLastName!: string;

  @IsOptional()
  @IsDateString()
  studentDob?: string;

  @IsOptional()
  @IsEmail()
  studentEmail?: string;

  // Family
  @IsString()
  familyName!: string;

  @IsString()
  contactName!: string;

  @IsOptional()
  @IsEmail()
  contactEmail?: string;

  @IsOptional()
  @IsString()
  contactPhone?: string;

  @IsOptional()
  @IsString()
  address?: string;

  // Instruments
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InstrumentSelectionDto)
  instruments!: InstrumentSelectionDto[];

  // Preferences
  @IsOptional()
  @IsBoolean()
  emailReminders?: boolean;

  @IsOptional()
  @IsBoolean()
  smsReminders?: boolean;

  @IsOptional()
  @IsString()
  notes?: string;

  // Idempotency
  @IsOptional()
  @IsString()
  idempotencyKey?: string;
}
