import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { JwtPayload, RequestUser } from '@music-life/types';
import type { Request } from 'express';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request & { user: RequestUser }>();

    const token = this.extractToken(req);
    if (!token) throw new UnauthorizedException('Missing token');

    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }

    req.user = {
      userId: payload.sub,
      sessionId: payload.sessionId,
      orgId: payload.orgId,
      membershipId: payload.membershipId,
      role: payload.role,
    };

    return true;
  }

  private extractToken(req: Request): string | undefined {
    const auth = req.headers.authorization;
    if (auth?.startsWith('Bearer ')) return auth.slice(7);
    return undefined;
  }
}
