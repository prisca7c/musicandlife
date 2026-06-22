import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import type { BaseRole, RequestUser } from '@music-life/types';
import type { Request } from 'express';

const ROLE_HIERARCHY: Record<BaseRole, number> = {
  system_admin: 100,
  admin: 90,
  manager: 70,
  receptionist: 50,
  technician: 40,
  teacher: 30,
  guardian: 20,
  student: 10,
};

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

    const userLevel = ROLE_HIERARCHY[user.role] ?? 0;
    const hasRole = required.some((r) => userLevel >= ROLE_HIERARCHY[r]);

    if (!hasRole) throw new ForbiddenException('Insufficient role');
    return true;
  }
}
