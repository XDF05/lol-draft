import { Type } from 'class-transformer';
import { IsInt, Min } from 'class-validator';

/**
 * Payload for `pick.swap` (Finalization phase only, R-007). Both ids address
 * Pick rows that belong to the caller's own team.
 */
export class PickSwapDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  fromPickId!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  toPickId!: number;
}
