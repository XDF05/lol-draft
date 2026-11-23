import { ArgumentsHost, BadRequestException, Catch } from '@nestjs/common';
import { BaseWsExceptionFilter } from '@nestjs/websockets';

/**
 * WebSocket exception filter used as the gateway's event validation error
 * surface.
 *
 * The default `BaseWsExceptionFilter` renders `BadRequestException` (what the
 * class-validator `ValidationPipe` throws) as a generic
 * `{ status: 'error', message: 'Internal server error' }` because its response
 * body is an object. Clients need the actual validation messages, so this
 * filter flattens them into a single string on the `exception` event:
 *
 *   { status: 'error', message: 'property junk should not exist; ...' }
 *
 * All other exceptions (including `WsException` from gateway handlers) fall
 * through to the default rendering.
 */
@Catch()
export class WsValidationExceptionFilter extends BaseWsExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    if (exception instanceof BadRequestException) {
      const client = host.switchToWs().getClient();
      client.emit('exception', {
        status: 'error',
        message: this.validationMessage(exception),
      });
      return;
    }
    super.catch(exception, host);
  }

  private validationMessage(exception: BadRequestException): string {
    const response = exception.getResponse() as
      string | { message?: string | string[] } | undefined;

    if (typeof response === 'string') {
      return response;
    }
    const messages = response?.message;
    if (Array.isArray(messages)) {
      return messages.join('; ');
    }
    return messages ?? exception.message ?? 'Validation failed';
  }
}
