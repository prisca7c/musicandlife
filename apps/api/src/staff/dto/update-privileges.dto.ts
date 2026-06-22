import { IsObject } from 'class-validator';

export class UpdatePrivilegesDto {
  @IsObject()
  privileges!: Record<string, boolean>;
}
