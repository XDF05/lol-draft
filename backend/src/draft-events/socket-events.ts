/**
 * Socket.IO event contract for the draft board (server-side source of truth).
 *
 * Client → Server events are handled by `DraftEventsGateway` via
 * `@SubscribeMessage` decorators (the @MessagePattern equivalent for
 * WebSocket gateways in @nestjs/websockets).
 *
 * Every handler returns an acknowledgement payload (`{ ok: true, ... }`) to
 * the emitting socket and throws a `WsException` on failure, which the client
 * receives on its `exception` event as `{ status: 'error', message }`.
 */

export type Team = 'BLUE' | 'RED';

export type DraftPhase =
  'BANNING_P1' | 'PICKING_P1' | 'BANNING_P2' | 'PICKING_P2' | 'FINALIZATION';

/** User identity attached to every authenticated socket (`client.data.user`). */
export interface SocketUser {
  id: number;
  username: string;
}

// ---------------------------------------------------------------------------
// Client → Server
// ---------------------------------------------------------------------------

export interface DraftJoinPayload {
  code: string;
  /** Optional claimed side; must match the player's assigned side. */
  team?: Team;
}

/**
 * Payload for `public.join` (T-015): unauthenticated spectators join the
 * draft broadcast room with the shared draft code.
 */
export interface PublicJoinPayload {
  draftCode: string;
}

export interface ChampionSelectPayload {
  /** Champion id from Data Dragon, or null to clear the pending selection. */
  championId?: string | null;
}

/** Finalization team-internal swap: exchange two of the caller's own picks. */
export interface PickSwapPayload {
  /** First pick (Pick row id) to exchange. */
  fromPickId: number;
  /** Second pick (Pick row id) to exchange. */
  toPickId: number;
}

export interface HealthPingPayload {
  /** `Date.now()` on the client when the ping was sent, for latency math. */
  sentAt?: number;
}

// ---------------------------------------------------------------------------
// Server → Client
// ---------------------------------------------------------------------------

/** One confirmed ban (mirrors a `Ban` row, persisted in T-009). */
export interface BanConfirmedEntry {
  championId: string;
  team: Team;
  phase: 1 | 2;
  locked: boolean;
}

/** One confirmed pick (mirrors a `Pick` row, persisted on lock in T-010). */
export interface PickConfirmedEntry {
  /** Pick row id — the stable handle for Finalization swaps. */
  id: number;
  championId: string;
  team: Team;
  locked: boolean;
}

/**
 * Turn information broadcast on `turn.start` (derived from the turn schedule).
 * `remainingSeconds` is set when a client (re)joins mid-turn so it can tick
 * from the true countdown instead of restarting at `timerSeconds`.
 */
export interface TurnStartPayload {
  turnNumber: number;
  phase: DraftPhase;
  actionType: 'BAN' | 'PICK' | 'FINALIZATION';
  expectedTeam: Team | null;
  timerSeconds: number;
  remainingSeconds?: number;
}

export interface BanConfirmedPayload {
  championId: string;
  team: Team;
  phase: 1 | 2;
  bans: BanConfirmedEntry[];
}

/** Countdown expiry notice (`timer.expired`): what was auto-locked, if any. */
export interface TimerExpiredPayload {
  autoLockedChampionId: string | null;
}

export interface PickConfirmedPayload {
  championId: string;
  team: Team;
  picks: PickConfirmedEntry[];
}

/** Broadcast after a team-internal swap so both clients re-render the order. */
export interface PickReorderedPayload {
  picks: PickConfirmedEntry[];
}

/**
 * Finalization finished: the draft is locked and COMPLETE (R-014). Carries
 * the final pick order so a reconnecting/public client can render results
 * without an extra fetch.
 */
export interface DraftCompletedPayload {
  draftId: number;
  code: string;
  completedAt: string;
  picks: PickConfirmedEntry[];
  bans: BanConfirmedEntry[];
}

/**
 * Broadcast when an in-progress draft expires (R-013 / EC-001): a player
 * stayed disconnected longer than the reconnection grace period.
 */
export interface DraftExpiredPayload {
  reason: string;
}

/** Acknowledgement returned by `public.join`. */
export interface PublicJoinAck {
  ok: true;
  draftId: number;
  code: string;
  status: string;
}

/**
 * Sanitize a broadcast payload for the public spectator room (T-015).
 * `draft.update` snapshots carry the participants' staged selections, which
 * must never reach spectators.
 */
export function publicBroadcastPayload(
  event: string,
  payload: unknown,
): unknown {
  if (event !== 'draft.update' || !payload || typeof payload !== 'object') {
    return payload;
  }
  return { ...(payload as Record<string, unknown>), pending: {} };
}

/** Room name helpers. */
export function draftRoom(draftId: number): string {
  return `draft:${draftId}`;
}

/**
 * Read-only spectator room (T-015). Kept separate from the participant room
 * so private state (staged/pending selections) is never broadcast to public
 * viewers.
 */
export function publicDraftRoom(draftId: number): string {
  return `draft:${draftId}:public`;
}

export function userRoom(userId: number): string {
  return `user:${userId}`;
}
