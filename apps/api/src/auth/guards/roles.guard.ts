import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { ROLE_LEVEL } from '@music-life/types';
import type { BaseRole, RequestUser } from '@music-life/types';
import type { Request } from 'express';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<BaseRole[]>(ROLES_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);

    if (!required?.length) return true;

    const { user } = ctx.switchToHttp().getRequest<Request & { user: RequestUser }>();
    if (!user) throw new ForbiddenException();

    const userLevel = ROLE_LEVEL[user.role] ?? 0;
    const hasRole = required.some((r) => userLevel >= ROLE_LEVEL[r]);

    if (!hasRole) throw new ForbiddenException('Insufficient role');
    return true;
  }
}
