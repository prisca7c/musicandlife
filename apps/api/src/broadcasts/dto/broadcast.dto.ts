import { IsIn, IsString, MaxLength, MinLength, Equals, IsBoolean } from 'class-validator';

export type BroadcastAudience = 'families' | 'teachers' | 'students' | 'everyone';

export class BroadcastTestDto {
  @IsString() @MinLength(1) @MaxLength(200)
  subject!: string;

  @IsString() @MinLength(1) @MaxLength(20000)
  body!: string;
}

export class BroadcastSendDto extends BroadcastTestDto {
  @IsIn(['families', 'teachers', 'students', 'everyone'])
  audience!: BroadcastAudience;

  // Belt-and-braces: the client must send an explicit confirm so a stray POST
  // can never fan an email out to the whole studio by accident.
  @IsBoolean() @Equals(true)
  confirm!: boolean;
}
