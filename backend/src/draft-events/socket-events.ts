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
  | 'BANNING_P1'
  | 'PICKING_P1'
  | 'BANNING_P2'
  | 'PICKING_P2'
  | 'FINALIZATION';

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

export interface ChampionSelectPayload {
  /** Champion id from Data Dragon, or null to clear the pending selection. */
  championId?: string | null;
}

export interface SwapRequestPayload {
  /** Opponent's locked pick the requester wants. */
  targetChampionId: string;
  /** Requester's own locked pick offered in exchange. */
  proposedSwapWith: string;
}

export interface SwapDecisionPayload {
  requestId: string;
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

/** One confirmed pick (mirrors a `Pick` row, persisted in T-009). */
export interface PickConfirmedEntry {
  championId: string;
  team: Team;
  locked: boolean;
}

/** Turn information broadcast on `turn.start` (derived from the turn schedule). */
export interface TurnStartPayload {
  turnNumber: number;
  phase: DraftPhase;
  actionType: 'BAN' | 'PICK' | 'FINALIZATION';
  expectedTeam: Team | null;
  timerSeconds: number;
}

export interface BanConfirmedPayload {
  championId: string;
  team: Team;
  phase: 1 | 2;
  bans: BanConfirmedEntry[];
}

export interface PickConfirmedPayload {
  championId: string;
  team: Team;
  picks: PickConfirmedEntry[];
}

export interface SwapRequestEntry {
  id: string;
  requestedBy: number;
  requesterTeam: Team;
  offerChampionId: string;
  targetChampionId: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
}

export interface SwapResolvedPayload {
  request: SwapRequestEntry;
  approved: boolean;
}

/** Room name helpers. */
export function draftRoom(draftId: number): string {
  return `draft:${draftId}`;
}

export function userRoom(userId: number): string {
  return `user:${userId}`;
}
