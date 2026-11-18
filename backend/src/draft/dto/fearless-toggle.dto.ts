import { IsBoolean } from 'class-validator';

/** Body for POST /draft/:code/fearless-toggle (T-013). */
export class FearlessToggleDto {
  /** Whether Fearless Drafting mode should be enabled. */
  @IsBoolean()
  fearless!: boolean;
}
