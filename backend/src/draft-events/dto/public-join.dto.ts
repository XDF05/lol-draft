import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/**
 * Payload for the `public.join` event (T-015 spectator entry point).
 *
 * Public viewers are not authenticated; the draft code is the shared secret
 * that grants read-only access to the broadcast room.
 */
export class PublicJoinDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  draftCode!: string;
}
