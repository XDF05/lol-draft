import { ConflictException } from '@nestjs/common';

/**
 * Thrown when a champion cannot be selected because it is already banned or
 * picked (R-003 / R-004 / R-005 / R-006 champion pool rules).
 */
export class ChampionUnavailableException extends ConflictException {
  readonly code = 'CHAMPION_UNAVAILABLE';
  constructor(message = 'This champion is already banned or picked.') {
    super({ code: 'CHAMPION_UNAVAILABLE', message });
  }
}
