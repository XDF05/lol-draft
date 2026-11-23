import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { redactRequestPath } from '../security/redact';

/**
 * Global HTTP exception filter for draft-specific errors.
 *
 * Every error is rendered as a structured body the frontend can consume
 * without guessing:
 *
 *   { statusCode, code, message, timestamp, path }
 *
 * Draft-specific exceptions carry their own `code` (e.g. `DRAFT_NOT_FOUND`,
 * `INVALID_TURN`, `CHAMPION_UNAVAILABLE`). All other exceptions fall back to
 * a status-derived code and log the server error so operators can see what
 * went wrong.
 */
@Catch(HttpException)
export class DraftHttpExceptionFilter implements ExceptionFilter<HttpException> {
  private readonly logger = new Logger(DraftHttpExceptionFilter.name);

  catch(exception: HttpException, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();

    const status = exception.getStatus();
    const exceptionResponse = exception.getResponse();
    const safePath = redactRequestPath(request.url);

    let code: string;
    let message: string;

    if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
      const body = exceptionResponse as {
        code?: string;
        message?: string | string[];
      };
      code = body.code ?? this.defaultCode(status);
      if (Array.isArray(body.message)) {
        message = body.message.join('; ');
      } else {
        message = body.message ?? exception.message;
      }
    } else {
      code = this.defaultCode(status);
      message =
        typeof exceptionResponse === 'string'
          ? exceptionResponse
          : this.defaultMessage(status);
    }

    const logLine = `${request.method} ${safePath} -> ${code}: ${message}`;
    if (status >= 500) {
      this.logger.error(logLine, exception.stack);
    } else {
      // Expected client errors do not need stack traces, and a stack can
      // contain implementation details that should not reach normal logs.
      this.logger.warn(logLine);
    }

    response.status(status).json({
      statusCode: status,
      code,
      message,
      timestamp: new Date().toISOString(),
      path: safePath,
    });
  }

  private defaultCode(status: number): string {
    switch (status) {
      case HttpStatus.BAD_REQUEST:
        return 'VALIDATION_ERROR';
      case HttpStatus.UNAUTHORIZED:
        return 'UNAUTHORIZED';
      case HttpStatus.FORBIDDEN:
        return 'FORBIDDEN';
      case HttpStatus.NOT_FOUND:
        return 'NOT_FOUND';
      case HttpStatus.CONFLICT:
        return 'CONFLICT';
      case HttpStatus.TOO_MANY_REQUESTS:
        return 'RATE_LIMITED';
      default:
        return status >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR';
    }
  }

  private defaultMessage(status: number): string {
    return status >= 500 ? 'Internal server error' : 'Request failed';
  }
}
