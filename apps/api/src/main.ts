// IMPORTANT: instrument.ts must be imported before anything else so Sentry can
// patch Node's http/db clients before they're first required.
import './instrument';

import { config as dotenvConfig } from 'dotenv';
import { resolve } from 'path';
// Load .env before any NestJS module initializes (so JWT_SECRET etc. are set at module load time)
dotenvConfig({ path: resolve(__dirname, '../../../.env') });

import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe, VersioningType } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { RequestIdInterceptor } from './common/interceptors/request-id.interceptor';

// Last-resort process-level guards. Without these, an unhandled promise
// rejection or a stray throw outside the request cycle can crash the process
// silently (or leave it in a bad state). Logging them gives visibility in the
// platform logs; on an uncaught exception we exit so the platform restarts a
// clean process rather than serving from a corrupted one.
const processLogger = new Logger('Process');
process.on('unhandledRejection', (reason) => {
  processLogger.error(`Unhandled promise rejection: ${reason instanceof Error ? reason.stack : String(reason)}`);
});
process.on('uncaughtException', (err) => {
  processLogger.error(`Uncaught exception: ${err.stack ?? err.message}`);
  process.exit(1);
});

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log', 'verbose'],
  });

  app.use(cookieParser(process.env.COOKIE_SECRET));

  // Render (and most PaaS) terminate TLS at a proxy and forward via X-Forwarded-For.
  // Trust the first hop so req.ip is the real client IP — the rate limiter keys on
  // it, otherwise every user shares the proxy's IP and gets throttled collectively.
  app.getHttpAdapter().getInstance().set('trust proxy', 1);

  // Baseline security headers. This is a JSON API (no HTML), so a full CSP isn't
  // needed, but these close clickjacking / MIME-sniff / referrer-leak vectors and
  // stop advertising the framework. (Web-app HTML headers live in the Next config.)
  app.getHttpAdapter().getInstance().disable('x-powered-by');
  app.use((_req: unknown, res: { setHeader: (k: string, v: string) => void }, next: () => void) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
    next();
  });

  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new RequestIdInterceptor());

  // WEB_URL supports a comma-separated list, so multiple frontend domains
  // (e.g. a vercel.app URL and a custom domain) can be allowed at once.
  const webUrls = (process.env.WEB_URL ?? 'http://localhost:3000')
    .split(',')
    .map((url) => url.trim())
    .filter(Boolean);

  app.enableCors({
    origin: webUrls,
    credentials: true,
  });

  // Drain in-flight requests and run shutdown hooks on SIGTERM/SIGINT (Render
  // sends SIGTERM on deploy/spin-down) instead of dropping live connections.
  app.enableShutdownHooks();

  const port = parseInt(process.env.API_PORT ?? '3001', 10);
  await app.listen(port);
  console.log(`API listening on port ${port} (path: /api/v1)`);
}

bootstrap().catch(console.error);
