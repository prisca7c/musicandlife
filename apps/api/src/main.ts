import { config as dotenvConfig } from 'dotenv';
import { resolve } from 'path';
// Load .env before any NestJS module initializes (so JWT_SECRET etc. are set at module load time)
dotenvConfig({ path: resolve(__dirname, '../../../.env') });

import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { RequestIdInterceptor } from './common/interceptors/request-id.interceptor';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log', 'verbose'],
    rawBody: true, // required for GoCardless/Revolut HMAC signature verification
  });

  app.use(cookieParser(process.env.COOKIE_SECRET));

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

  app.enableCors({
    origin: process.env.WEB_URL ?? 'http://localhost:3000',
    credentials: true,
  });

  const port = parseInt(process.env.API_PORT ?? '3001', 10);
  await app.listen(port);
  console.log(`API running on http://localhost:${port}/api/v1`);
}

bootstrap().catch(console.error);
