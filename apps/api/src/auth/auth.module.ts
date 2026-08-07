import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET,
      // Short-lived (900s / 15min by .env.example) with a rotating, reuse-
      // detected refresh token carrying the real 30-day session — see
      // AuthService.refresh(). The fallback here MUST match that documented
      // default, not the refresh token's magnitude: if JWT_ACCESS_TTL is ever
      // missing in some environment (a fresh deploy, a misconfigured preview
      // env), falling back to 30 days would silently mint month-long access
      // tokens with none of the revocation/rotation protection the refresh
      // token has — a suspended or removed user's token would stay valid for
      // up to 30 days instead of ~15 minutes, invisibly.
      signOptions: { expiresIn: parseInt(process.env.JWT_ACCESS_TTL ?? '900', 10) },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard, RolesGuard],
  exports: [JwtModule, JwtAuthGuard, RolesGuard, AuthService],
})
export class AuthModule {}
