import { SetMetadata } from '@nestjs/common';
import type { BaseRole } from '@music-life/types';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: BaseRole[]) => SetMetadata(ROLES_KEY, roles);
