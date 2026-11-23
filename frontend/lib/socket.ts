import { io, Socket } from 'socket.io-client';
import { authStorage } from './api';

/**
 * Socket.IO client for the draft events gateway (T-007).
 *
 * Event and payload types mirror the server-side contract in
 * backend/src/draft-events/socket-events.ts — keep them in sync, the same
 * way lib/types.ts mirrors the champion entity.
 *
 * Handler failures (WsException / DTO validation) do NOT arrive through the
 * emit acknowledgement; the gateway emits them on the `exception` event as
 * `{ status: 'error', message }`. Acks therefore resolve only for successful
 * handler returns, and `socket.timeout(...)` fires on failures after the
 * timeout — see emitAck() and the store's `lastError`.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

// ---------------------------------------------------------------------------
// Mirrored contract types (backend/src/draft-events/socket-events.ts)
// ---------------------------------------------------------------------------

export type Team = 'BLUE' | 'RED';

export type DraftPhase =
  'BANNING_P1' | 'PICKING_P1' | 'BANNING_P2' | 'PICKING_P2' | 'FINALIZATION';

/** Turn snapshot broadcast on `turn.start` (also used by timer events). */
export interface TurnStartPayload {
  turnNumber: number;
  phase: DraftPhase;
  actionType: 'BAN' | 'PICK' | 'FINALIZATION';
  expectedTeam: Team | null;
  timerSeconds: number;
  /** Set when (re)joining mid-turn: true seconds left, for accurate ticking. */
  remainingSeconds?: number;
}

export interface BanConfirmedEntry {
  championId: string;
  team: Team;
  phase: 1 | 2;
  locked: boolean;
}

export interface PickConfirmedEntry {
  /** Pick row id — the stable handle for Finalization swaps. */
  id: number;
  championId: string;
  team: Team;
  locked: boolean;
}

export interface PendingSelection {
  type: 'BAN' | 'PICK';
  championId: string | null;
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

/** Broadcast after a team-internal Finalization swap (R-007). */
export interface PickReorderedPayload {
  picks: PickConfirmedEntry[];
}

/**
 * Finalization finished: the draft is COMPLETE (R-014). Carries the final
 * pick order so both clients can render results immediately.
 */
export interface DraftCompletedPayload {
  draftId: number;
  code: string;
  completedAt: string;
  picks: PickConfirmedEntry[];
  bans: BanConfirmedEntry[];
}

/**
 * Full live-session snapshot broadcast on `draft.update`
 * (mirrors backend DraftSessionState).
 */
export interface DraftSessionSnapshot {
  draftId: number;
  code: string;
  status: string;
  currentTurn: number;
  bans: BanConfirmedEntry[];
  picks: PickConfirmedEntry[];
  pending: Partial<Record<Team, PendingSelection | null>>;
  skips: Record<Team, number>;
  updatedAt: string;
}

/** Emitted by TurnManager at 5s / 3s / 1s of the current turn (T-009). */
export interface TimerWarningPayload {
  seconds: number;
  turn: TurnStartPayload;
}

/** Emitted by TurnManager when a turn's countdown expires (T-009). */
export interface TimerExpiredPayload {
  autoLockedChampionId: string | null;
}

/** Broadcast when a draft expires (R-013 reconnection grace period elapsed). */
export interface DraftExpiredPayload {
  reason: string;
}

/** Gateway failures (WsException / ValidationPipe). */
export interface ExceptionPayload {
  status: string;
  message: string;
}

// ---------------------------------------------------------------------------
// Event maps
// ---------------------------------------------------------------------------

export interface ServerToClientEvents {
  'draft.update': (state: DraftSessionSnapshot) => void;
  'turn.start': (turn: TurnStartPayload) => void;
  'turn.end': (nextTurnNumber: number) => void;
  'ban.confirmed': (payload: BanConfirmedPayload) => void;
  'pick.confirmed': (payload: PickConfirmedPayload) => void;
  'timer.warning': (payload: TimerWarningPayload) => void;
  'timer.expired': (payload: TimerExpiredPayload) => void;
  'phase.ban1.start': () => void;
  'phase.pick1.start': () => void;
  'phase.ban2.start': () => void;
  'phase.pick2.start': () => void;
  'phase.finalization.start': () => void;
  'pick.reordered': (payload: PickReorderedPayload) => void;
  'draft.completed': (payload: DraftCompletedPayload) => void;
  'draft.expired': (payload: DraftExpiredPayload) => void;
  'auth.error': (payload: { message: string }) => void;
  'connection.ready': (payload: { authenticated: boolean }) => void;
  exception: (payload: ExceptionPayload) => void;
}

// Ack payload types (successful handler returns).
export interface DraftJoinAck {
  ok: true;
  draftId: number;
  team: Team;
  room: string;
}
export interface ChampionSelectAck {
  ok: true;
  championId: string | null;
}
export interface ChampionLockAck {
  ok: true;
  championId: string;
}
export interface SimpleAck {
  ok: true;
}
export interface PickSwapAck {
  ok: true;
  picks: PickConfirmedEntry[];
}
export interface HealthPingAck {
  ok: true;
  serverTime: number;
  latencyMs: number | null;
}
/** Acknowledgement returned by `public.join` (T-015). */
export interface PublicJoinAck {
  ok: true;
  draftId: number;
  code: string;
  status: string;
}

export interface ClientToServerEvents {
  'draft.join': (
    payload: { code: string; team?: Team },
    ack: (res: DraftJoinAck) => void,
  ) => void;
  'draft.leave': (ack: (res: SimpleAck) => void) => void;
  'ban.select': (
    payload: { championId?: string | null },
    ack: (res: ChampionSelectAck) => void,
  ) => void;
  'ban.lock': (ack: (res: ChampionLockAck) => void) => void;
  'ban.skip': (
    payload: Record<string, never>,
    ack: (res: SimpleAck) => void,
  ) => void;
  'pick.select': (
    payload: { championId?: string | null },
    ack: (res: ChampionSelectAck) => void,
  ) => void;
  'pick.lock': (ack: (res: ChampionLockAck) => void) => void;
  'pick.skip': (
    payload: Record<string, never>,
    ack: (res: SimpleAck) => void,
  ) => void;
  'pick.swap': (
    payload: { fromPickId: number; toPickId: number },
    ack: (res: PickSwapAck) => void,
  ) => void;
  'health.ping': (
    payload: { sentAt?: number },
    ack: (res: HealthPingAck) => void,
  ) => void;
}

export type DraftSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/**
 * Read-only spectator events (T-015). Public viewers only need the room
 * join/leave handshake; all live updates arrive on the shared
 * `ServerToClientEvents` contract.
 */
export interface SpectatorClientToServerEvents {
  'public.join': (
    payload: { draftCode: string },
    ack: (res: PublicJoinAck) => void,
  ) => void;
  'public.leave': (ack: (res: SimpleAck) => void) => void;
  'health.ping': (
    payload: { sentAt?: number },
    ack: (res: HealthPingAck) => void,
  ) => void;
}

export type SpectatorSocket = Socket<
  ServerToClientEvents,
  SpectatorClientToServerEvents
>;

// ---------------------------------------------------------------------------
// Connection factory (module-level singleton, one socket per browser tab)
// ---------------------------------------------------------------------------

let draftSocket: DraftSocket | null = null;

/**
 * Lazily create (or return) the app's draft socket. Not connected
 * automatically — `useSocket` / `joinDraft` call `connect()`.
 *
 * `auth` is a function so every (re)connection attempt reads the *current*
 * access token from storage: if the HTTP layer rotated tokens while the
 * socket was offline, the next handshake uses the fresh JWT.
 */
export function getDraftSocket(): DraftSocket {
  if (!draftSocket) {
    draftSocket = io(API_URL, {
      transports: ['websocket'],
      autoConnect: false,
      // Automatic reconnection (R-013): socket.io retries with exponential
      // backoff between 1s and 5s until it succeeds.
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000,
      auth: (cb) => cb({ token: authStorage.getAccessToken() }),
    });
  }
  return draftSocket;
}

/** Close and discard the socket (e.g. on logout). A new one is built lazily. */
export function closeDraftSocket(): void {
  if (draftSocket) {
    draftSocket.disconnect();
    draftSocket = null;
  }
}

let spectatorSocket: SpectatorSocket | null = null;

/**
 * Lazily create (or return) the anonymous spectator socket (T-015).
 *
 * Unlike `getDraftSocket()`, this connection carries no JWT: public viewers
 * must be able to watch a draft without an account. The gateway accepts
 * token-less handshakes as read-only spectators; they can only join a draft
 * room through `public.join`.
 */
export function getSpectatorSocket(): SpectatorSocket {
  if (!spectatorSocket) {
    spectatorSocket = io(API_URL, {
      transports: ['websocket'],
      autoConnect: false,
      // Same reconnection policy as the participant socket (R-013): retry
      // with backoff until the viewer is back or their 30s grace window ends.
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000,
    });
  }
  return spectatorSocket;
}

/** Close and discard the spectator socket. A new one is built lazily. */
export function closeSpectatorSocket(): void {
  if (spectatorSocket) {
    spectatorSocket.disconnect();
    spectatorSocket = null;
  }
}

// ---------------------------------------------------------------------------
// Acknowledgement helper
// ---------------------------------------------------------------------------

export interface AckOutcome<T = unknown> {
  ok: boolean;
  data?: T;
  /** Set on timeout (server-side failures arrive via the `exception` event). */
  error?: string;
}

/**
 * Emit with acknowledgement and a timeout. Resolves `{ ok: false }` on
 * timeout; the concrete failure message is delivered on the `exception`
 * event and surfaced through the draft store's `lastError`.
 */
export function emitAck<A>(
  socket: DraftSocket | SpectatorSocket,
  event: string,
  payload: unknown,
  timeoutMs = 4000,
): Promise<AckOutcome<A>> {
  return new Promise((resolve) => {
    const timeoutEmit = socket
      .timeout(timeoutMs)
      .emit.bind(socket) as unknown as (
      eventName: string,
      payloadArg: unknown,
      ack: (err: Error | null, res: A) => void,
    ) => void;

    timeoutEmit(event, payload, (err, res) => {
      if (err) {
        resolve({ ok: false, error: 'Request timed out' });
      } else {
        resolve({ ok: true, data: res });
      }
    });
  });
}
