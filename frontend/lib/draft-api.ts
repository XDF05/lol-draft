import api from './api';
import type {
  BanConfirmedEntry,
  PickConfirmedEntry,
  TurnStartPayload,
} from './socket';

/**
 * HTTP wrappers for the draft creation flow (T-008).
 *
 * Types mirror backend/src/draft/draft.types.ts — keep in sync.
 */

export type DraftSide = 'BLUE' | 'RED';

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
 * Public spectator snapshot (T-015) returned by GET /public/draft/:code.
 * Contains only public draft state — never pending selections.
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

/** Create a waiting draft; the creator claims `side` (default BLUE). */
export async function createDraft(side: DraftSide): Promise<CreateDraftResponse> {
  const { data } = await api.post<CreateDraftResponse>('/draft/create', { side });
  return data;
}

/** Draft lookup for the room page (participants, status). */
export async function fetchDraftByCode(code: string): Promise<DraftView> {
  const { data } = await api.get<DraftView>(`/draft/${encodeURIComponent(code)}`);
  return data;
}

/** Claim the free side (first-come first-served) / start the draft. */
export async function joinDraftByCode(
  code: string,
  side?: DraftSide,
): Promise<JoinDraftResponse> {
  const { data } = await api.post<JoinDraftResponse>(
    `/draft/${encodeURIComponent(code)}/join`,
    side ? { side } : {},
  );
  return data;
}

/** Public spectator snapshot — no authentication required (T-015). */
export async function fetchPublicDraftByCode(
  code: string,
): Promise<PublicDraftView> {
  const { data } = await api.get<PublicDraftView>(
    `/public/draft/${encodeURIComponent(code)}`,
  );
  return data;
}

/** Relative public viewing path for a draft code (`/d/:code`). */
export function spectatorPath(code: string): string {
  return `/d/${encodeURIComponent(code)}`;
}

/**
 * Absolute spectator link for sharing. Falls back to the relative path
 * during SSR; call this from an event handler to get the current origin.
 */
export function buildSpectatorUrl(code: string): string {
  const path = spectatorPath(code);
  if (typeof window === 'undefined') {
    return path;
  }
  return `${window.location.origin}${path}`;
}
