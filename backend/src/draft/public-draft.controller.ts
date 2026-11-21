import { Controller, Get, Param } from '@nestjs/common';
import { DraftService } from './draft.service';
import type { PublicDraftView } from './draft.types';

/**
 * Public spectator access (T-015).
 *
 * Deliberately unauthenticated: the draft code in the URL is the shared
 * secret, and the response exposes only public draft state (participants,
 * status, locked bans/picks, current turn). No pending selections are
 * included.
 */
@Controller('public/draft')
export class PublicDraftController {
  constructor(private readonly draftService: DraftService) {}

  @Get(':code')
  getByCode(@Param('code') code: string): Promise<PublicDraftView> {
    return this.draftService.getPublicByCode(code.trim().toUpperCase());
  }
}
