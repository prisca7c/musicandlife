import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import type { Request, Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const message =
      exception instanceof HttpException
        ? (exception.getResponse() as { message?: string | string[] }).message ??
          exception.message
        : 'Internal server error';

    const requestId = (req.headers['x-request-id'] as string) ?? '';

    if (status >= 500) {
      this.logger.error(
        `${req.method} ${req.url} → ${status}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
      // Only real (5xx) failures go to Sentry — routine 4xx responses (bad
      // input, missing auth, not found) aren't errors in the app and would
      // just burn the event quota with noise.
      Sentry.captureException(exception);
    }

    res.status(status).json({
      error: {
        code: status,
        message,
        requestId,
      },
    });
  }
}
