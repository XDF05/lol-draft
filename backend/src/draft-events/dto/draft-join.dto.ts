import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

/** Payload for the `draft.join` event (room management entry point). */
export class DraftJoinDto {
  @IsString()
  @IsNotEmpty()
  code!: string;

  /** Optional claimed side; must match the player's assigned side in the draft. */
  @IsOptional()
  @IsIn(['BLUE', 'RED'])
  team?: 'BLUE' | 'RED';
}
