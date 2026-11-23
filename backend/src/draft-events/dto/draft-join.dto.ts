import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

/** Payload for the `draft.join` event (room management entry point). */
export class DraftJoinDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  code!: string;

  /** Optional claimed side; must match the player's assigned side in the draft. */
  @IsOptional()
  @IsIn(['BLUE', 'RED'])
  team?: 'BLUE' | 'RED';
}
