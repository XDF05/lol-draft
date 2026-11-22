import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';

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
export class DraftHttpExceptionFilter
  implements ExceptionFilter<HttpException>
{
  private readonly logger = new Logger(DraftHttpExceptionFilter.name);

  catch(exception: HttpException, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();

    const status = exception.getStatus();
    const exceptionResponse = exception.getResponse();

    let code: string;
    let message: string;

    if (
      typeof exceptionResponse === 'object' &&
      exceptionResponse !== null &&
      'code' in exceptionResponse
    ) {
      const body = exceptionResponse as {
        code?: string;
        message?: string;
      };
      code = body.code ?? this.defaultCode(status);
      message =
        typeof body.message === 'string'
          ? body.message
          : exception.message;
    } else {
      code = this.defaultCode(status);
      message =
        typeof exceptionResponse === 'string'
          ? exceptionResponse
          : 'A system error occurred';
    }

    this.logger.error(
      `${request.method} ${request.url} -> ${code}: ${message}`,
      exception.stack,
    );

    response.status(status).json({
      statusCode: status,
      code,
      message,
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }

  private defaultCode(status: number): string {
    switch (status) {
      case HttpStatus.NOT_FOUND:
        return 'DRAFT_NOT_FOUND';
      case HttpStatus.FORBIDDEN:
        return 'UNAUTHORIZED';
      case HttpStatus.CONFLICT:
        return 'CHAMPION_UNAVAILABLE';
      case HttpStatus.BAD_REQUEST:
        return 'INVALID_TURN';
      default:
        return 'INTERNAL_ERROR';
    }
  }
}
