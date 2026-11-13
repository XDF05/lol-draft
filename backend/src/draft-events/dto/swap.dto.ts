import { IsNotEmpty, IsString } from 'class-validator';

/** Payload for the `swap.request` event (Finalization phase only, R-007). */
export class SwapRequestDto {
  /** Opponent's locked pick the requester wants. */
  @IsString()
  @IsNotEmpty()
  targetChampionId!: string;

  /** Requester's own locked pick offered in exchange. */
  @IsString()
  @IsNotEmpty()
  proposedSwapWith!: string;
}

/** Payload for `swap.approve` / `swap.reject`. */
export class SwapDecisionDto {
  @IsString()
  @IsNotEmpty()
  requestId!: string;
}
