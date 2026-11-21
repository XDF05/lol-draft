import { NotFoundException } from '@nestjs/common';

/**
 * Thrown when a draft code resolves to no draft or to an expired draft
 * (EC-004: no information is leaked about whether the draft ever existed).
 */
export class DraftNotFoundError extends NotFoundException {
  readonly code = 'DRAFT_NOT_FOUND';
  constructor(message = 'This draft has expired or does not exist') {
    super({ code: 'DRAFT_NOT_FOUND', message });
  }
}
