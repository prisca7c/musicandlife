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
      // 30 days by default. The web app and API live on different domains, so
      // the silent cross-domain refresh is unreliable (Safari/Chrome block the
      // third-party cookie). A long-lived access token means people stay signed
      // in until they explicitly log out, which clears the cookie and revokes
      // the refresh token server-side. Override with JWT_ACCESS_TTL (seconds).
      signOptions: { expiresIn: parseInt(process.env.JWT_ACCESS_TTL ?? '2592000', 10) },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard, RolesGuard],
  exports: [JwtModule, JwtAuthGuard, RolesGuard, AuthService],
})
export class AuthModule {}
