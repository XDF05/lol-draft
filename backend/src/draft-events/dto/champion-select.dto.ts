import { IsOptional, IsString } from 'class-validator';

/**
 * Payload for `ban.select` / `pick.select`.
 *
 * `championId` may be explicitly null to clear a pending selection
 * (R-009: the player may change their selection until it is locked).
 */
export class ChampionSelectDto {
  @IsOptional()
  @IsString()
  championId?: string | null;
}
