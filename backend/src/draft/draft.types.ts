import type {
  BanConfirmedEntry,
  PickConfirmedEntry,
  TurnStartPayload,
} from '../draft-events/socket-events';
import type { DraftSide } from './dto/create-draft.dto';

/**
 * HTTP response contracts for the draft creation flow (T-008).
 * Keep in sync with `frontend/lib/draft-api.ts`.
 */

/** A draft participant as exposed over the HTTP API. */
export interface DraftParticipant {
  id: number;
  username: string;
}

/** Draft row + participants, returned by GET /draft/:code and by joins. */
export interface DraftView {
  id: number;
  code: string;
  status: string;
  currentTurn: number;
  bluePlayer: DraftParticipant | null;
  redPlayer: DraftParticipant | null;
  createdAt: string;
}

/**
 * Public (unauthenticated) spectator snapshot returned by
 * GET /public/draft/:code (T-015).
 *
 * The draft code itself is the access token. The response exposes the same
 * public draft state participants see (players, status, locked bans/picks,
 * current turn) but never the participants' pending selections.
 */
export interface PublicDraftView extends DraftView {
  completedAt: string | null;
  bans: BanConfirmedEntry[];
  picks: PickConfirmedEntry[];
  turn: TurnStartPayload;
}

/** POST /draft/create response. */
export interface CreateDraftResponse {
  code: string;
  status: string;
  message: string;
}

/** POST /draft/:code/join response. */
export interface JoinDraftResponse {
  draft: DraftView;
  /** Side assigned to the caller by this join. */
  team: DraftSide;
  /** True when this join claimed the last free side and started the draft. */
  started: boolean;
}
