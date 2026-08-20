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
      // Matches the refresh token's own 30-day lifetime (JWT_REFRESH_TTL) —
      // deliberately, not a fallback that drifted out of sync. Access tokens
      // used to expire every 15 minutes, silently refreshed in the
      // background via a rotating, reuse-detected refresh token (see
      // AuthService.refresh()). That refresh round-trip was the actual
      // source of a real production bug: a slow network moment (a cold
      // start, a backgrounded tab) could make the client miss the refresh
      // response and retry with an already-used token, which read
      // identically to a stolen token being replayed and killed the whole
      // session — every list on every page silently went blank until a full
      // log-out/log-in. Matching the access token to the refresh token's own
      // lifetime means that refresh round-trip almost never has to happen
      // during normal use, which removes the bug's actual trigger rather
      // than only mitigating it.
      //
      // The trade-off: JwtAuthGuard verifies a token's signature and expiry
      // only, no per-request DB lookup — so deactivating a user, removing
      // their org membership, or an admin-triggered logout doesn't
      // invalidate an access token already out in the wild until it expires
      // on its own. That gap existed before this change too (a 15-minute
      // token already outlives an admin action taken 30 seconds earlier);
      // this widens it from ~15 minutes to up to 30 days. Accepted
      // deliberately for this deployment (small, trusted user base) — revisit
      // if that ever changes.
      signOptions: { expiresIn: parseInt(process.env.JWT_ACCESS_TTL ?? '2592000', 10) },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard, RolesGuard],
  exports: [JwtModule, JwtAuthGuard, RolesGuard, AuthService],
})
export class AuthModule {}
