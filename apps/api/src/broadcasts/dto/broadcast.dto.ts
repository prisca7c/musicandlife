import {
  IsIn, IsString, MaxLength, MinLength, Equals, IsBoolean, IsOptional, IsUUID, ValidateNested,
  IsArray, ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';

export type BroadcastAudience = 'families' | 'teachers' | 'students' | 'everyone';

/**
 * Narrows a broadcast to a subgroup defined by what people actually study.
 * Every field is ANDed, so instrument=piano + lessonType=group reaches only the
 * group piano class. All empty means "the whole audience" and the original
 * membership-based path is used.
 */
export class BroadcastFilterDto {
  @IsOptional() @IsString() @MaxLength(80)
  instrument?: string;

  @IsOptional() @IsIn(['private', 'group'])
  lessonType?: 'private' | 'group';

  @IsOptional() @IsString() @MaxLength(200)
  groupName?: string;

  @IsOptional() @IsUUID()
  teacherId?: string;
}

export class BroadcastTestDto {
  @IsString() @MinLength(1) @MaxLength(200)
  subject!: string;

  @IsString() @MinLength(1) @MaxLength(20000)
  body!: string;
}

export class BroadcastPreviewDto {
  // Multiple audiences can be picked together (e.g. families + teachers but
  // not students) — 'everyone' is still accepted as shorthand for all three.
  @IsArray() @ArrayMinSize(1) @IsIn(['families', 'teachers', 'students', 'everyone'], { each: true })
  audience!: BroadcastAudience[];

  @IsOptional() @ValidateNested() @Type(() => BroadcastFilterDto)
  filter?: BroadcastFilterDto;
}

export class BroadcastSendDto extends BroadcastTestDto {
  @IsArray() @ArrayMinSize(1) @IsIn(['families', 'teachers', 'students', 'everyone'], { each: true })
  audience!: BroadcastAudience[];

  @IsOptional() @ValidateNested() @Type(() => BroadcastFilterDto)
  filter?: BroadcastFilterDto;

  // Belt-and-braces: the client must send an explicit confirm so a stray POST
  // can never fan an email out to the whole studio by accident.
  @IsBoolean() @Equals(true)
  confirm!: boolean;
}
