import { IsIn } from 'class-validator';

export class UpdateTermStatusDto {
  @IsIn(['planned', 'active', 'closed'])
  status!: 'planned' | 'active' | 'closed';
}
