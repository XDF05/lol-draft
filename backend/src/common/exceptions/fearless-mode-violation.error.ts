import { ForbiddenException } from '@nestjs/common';

/**
 * Thrown when a Fearless Mode rule is violated — e.g. banning a champion
 * that was picked in Phase 1 while Fearless Mode is active (R-008).
 */
export class FearlessModeViolationException extends ForbiddenException {
  readonly code = 'FEARLESS_MODE_VIOLATION';
  constructor(
    message = 'This action is not allowed while Fearless Mode is active.',
  ) {
    super({ code: 'FEARLESS_MODE_VIOLATION', message });
  }
}
