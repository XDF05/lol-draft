import { isAxiosError } from 'axios';

export interface DraftError {
  /** Machine-readable error code (e.g. `DRAFT_NOT_FOUND`, `SERVICE_UNAVAILABLE`). */
  code: string;
  /** Human-readable message safe to render in the UI. */
  message: string;
  /** HTTP status code, or null when there was no response (offline, timeout). */
  status: number | null;
}

/**
 * Normalize an API error into a { code, message, status } the UI can render.
 *
 * The NestJS API (T-017) returns structured bodies for draft-specific errors:
 *   { statusCode, code, message, timestamp, path }
 *
 * Status-code fallbacks let the UI distinguish a missing/expired draft (404)
 * from a temporarily unavailable service (503) without leaking internals.
 */
export function extractDraftError(err: unknown): DraftError {
  const status = isAxiosError(err) ? (err.response?.status ?? null) : null;
  const backend = isAxiosError(err) ? err.response?.data : null;

  if (backend && typeof backend === 'object' && 'code' in backend) {
    const body = backend as { code?: string; message?: string };
    return {
      code: body.code ?? 'UNKNOWN_ERROR',
      message:
        typeof body.message === 'string' && body.message.length > 0
          ? body.message
          : defaultMessage(status),
      status,
    };
  }

  switch (status) {
    case 404:
      return {
        code: 'DRAFT_NOT_FOUND',
        message: 'This draft has expired or does not exist.',
        status: 404,
      };
    case 503:
      return {
        code: 'SERVICE_UNAVAILABLE',
        message:
          'The draft service is temporarily unavailable. Please try again.',
        status: 503,
      };
    case 500:
      return {
        code: 'INTERNAL_ERROR',
        message: 'A system error occurred.',
        status: 500,
      };
    default:
      return {
        code: 'UNKNOWN_ERROR',
        message: defaultMessage(status),
        status,
      };
  }
}

function defaultMessage(status: number | null): string {
  if (status === null) {
    return 'Unable to reach the draft service. Check your connection.';
  }
  return `Request failed (HTTP ${status}).`;
}
