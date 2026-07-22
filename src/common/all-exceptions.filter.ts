import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

/**
 * Global catch-all (pattern from ovlox_v3_backend): one stable error shape,
 * pg SQLSTATE codes mapped to sane HTTP statuses (no ORM does it for us),
 * internals hidden in production.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly log = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    // SSE streams have already flushed headers — nothing sane to send.
    if (res.headersSent) return;

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: unknown = 'Something went wrong';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      message = typeof body === 'string' ? body : ((body as { message?: unknown }).message ?? body);
    } else if (isPgError(exception)) {
      [status, message] = mapPgError(exception.code);
    } else if (process.env.NODE_ENV !== 'production') {
      message = (exception as Error)?.message ?? String(exception);
    }

    const raw = (exception as Error)?.message ?? String(exception);
    this.log.error(`[${status}] ${req.method} ${req.url} -> ${raw}`);

    res.status(status).json({
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: req.url,
      error: message,
    });
  }
}

function isPgError(e: unknown): e is { code: string } {
  return typeof (e as { code?: unknown })?.code === 'string' && !(e instanceof HttpException);
}

function mapPgError(code: string): [number, string] {
  switch (code) {
    case '23505':
      return [HttpStatus.CONFLICT, 'That already exists'];
    case '23503':
      return [HttpStatus.CONFLICT, 'Referenced record not found'];
    case '23502':
    case '22P02':
      return [HttpStatus.BAD_REQUEST, 'Invalid data'];
    default:
      return [HttpStatus.INTERNAL_SERVER_ERROR, 'Something went wrong'];
  }
}
