import { BadRequestException } from '@nestjs/common';

/**
 * Thrown when a player attempts a ban/pick action outside their turn
 * (R-003 / R-004 / R-005 / R-006 turn sequencing).
 */
export class InvalidTurnException extends BadRequestException {
  readonly code = 'INVALID_TURN';
  constructor(message = 'It is not your turn to act.') {
    super({ code: 'INVALID_TURN', message });
  }
}
