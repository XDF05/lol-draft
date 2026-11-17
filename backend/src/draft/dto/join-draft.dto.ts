import { IsIn, IsOptional } from 'class-validator';
import type { DraftSide } from './create-draft.dto';

export class JoinDraftDto {
  /**
   * Requested side. Must be the free side: claiming an occupied side is a
   * 409 conflict. Defaults to the only free side.
   */
  @IsOptional()
  @IsIn(['BLUE', 'RED'])
  side?: DraftSide;
}
