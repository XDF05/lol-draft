import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { DraftService } from './draft.service';
import { CreateDraftDto } from './dto/create-draft.dto';
import { FearlessToggleDto } from './dto/fearless-toggle.dto';
import { JoinDraftDto } from './dto/join-draft.dto';

interface AuthenticatedRequest {
  user: { id: number; username: string };
}

/**
 * Draft room creation flow endpoints (T-008). All routes require a bearer
 * token (DS-NF-003: authentication required for draft participation).
 */
@Controller('draft')
@UseGuards(JwtAuthGuard)
export class DraftCreationController {
  constructor(private readonly draftService: DraftService) {}

  /** Create a waiting draft; the creator claims a side immediately. */
  @Post('create')
  create(@Req() req: AuthenticatedRequest, @Body() dto: CreateDraftDto) {
    return this.draftService.create(req.user.id, dto);
  }

  /** Draft lookup for the room page (participants, status). */
  @Get(':code')
  getByCode(@Param('code') code: string) {
    return this.draftService.getByCode(code);
  }

  /** Claim the free side (first-come first-served) / start the draft. */
  @Post(':code/join')
  join(
    @Req() req: AuthenticatedRequest,
    @Param('code') code: string,
    @Body() dto: JoinDraftDto,
  ) {
    return this.draftService.join(req.user.id, code, dto);
  }

  /**
   * Toggle Fearless Drafting mode before the draft starts (T-013). Locked
   * once the draft reaches IN_PROGRESS.
   */
  @Post(':code/fearless-toggle')
  toggleFearless(
    @Req() req: AuthenticatedRequest,
    @Param('code') code: string,
    @Body() dto: FearlessToggleDto,
  ) {
    return this.draftService.setFearless(req.user.id, code, dto.fearless);
  }
}
