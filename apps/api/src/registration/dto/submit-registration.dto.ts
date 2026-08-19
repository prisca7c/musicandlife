import { IsString, IsEmail, IsOptional, IsDateString, IsArray, IsIn, ValidateNested, IsBoolean, MaxLength, MinLength, ArrayMaxSize } from 'class-validator';
import { IsRealisticDob } from '../../common/validators/is-realistic-dob';
import { Type } from 'class-transformer';

export class InstrumentSelectionDto {
  @IsString()
  @MaxLength(80)
  instrument!: string;

  @IsIn(['private', 'group'])
  lessonType!: 'private' | 'group';
}

// This DTO is submitted from a PUBLIC, unauthenticated endpoint, so every field
// is length-capped: without caps a caller could post multi-hundred-KB strings
// that exceed the DB column limits and surface as an unhandled 500, and sit in
// the staff intake queue as a storage-abuse / stored-payload vector.
export class SubmitRegistrationDto {
  // Student
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  studentFirstName!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  studentLastName!: string;

  @IsOptional()
  @IsDateString()
  @IsRealisticDob()
  studentDob?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  studentEmail?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  studentPhone?: string;

  // Family
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  familyName!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  contactName!: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  contactEmail?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  contactPhone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;

  // Instruments
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => InstrumentSelectionDto)
  instruments!: InstrumentSelectionDto[];

  // Preferences
  @IsOptional()
  @IsBoolean()
  emailReminders?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  // Idempotency
  @IsOptional()
  @IsString()
  @MaxLength(200)
  idempotencyKey?: string;
}
