import { IsIn, IsOptional } from 'class-validator';

export type DraftSide = 'BLUE' | 'RED';

export class CreateDraftDto {
  /**
   * Side the creator claims for themselves (R-002, first-come
   * first-served). Defaults to BLUE — the first-pick advantage side.
   */
  @IsOptional()
  @IsIn(['BLUE', 'RED'])
  side?: DraftSide;
}
