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
  fearlessMode: boolean;
  currentTurn: number;
  bluePlayer: DraftParticipant | null;
  redPlayer: DraftParticipant | null;
  createdAt: string;
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
