import { create } from 'zustand';
import {
  emitAck,
  getDraftSocket,
  type AckOutcome,
  type BanConfirmedEntry,
  type BanConfirmedPayload,
  type ChampionLockAck,
  type ChampionSelectAck,
  type DraftCompletedPayload,
  type DraftJoinAck,
  type DraftPhase,
  type DraftExpiredPayload,
  type DraftSessionSnapshot,
  type HealthPingAck,
  type PendingSelection,
  type PickConfirmedEntry,
  type PickConfirmedPayload,
  type PickReorderedPayload,
  type PickSwapAck,
  type SimpleAck,
  type Team,
  type TimerExpiredPayload,
  type TimerWarningPayload,
  type TurnStartPayload,
} from '../lib/socket';

/**
 * Live draft session state (Zustand), fed by the socket listeners in
 * `hooks/useSocket.ts` (T-007).
 *
 * State mirrors the backend's live Redis session (DraftSessionState):
 * bans/picks arrive as authoritative snapshots from `draft.update` /
 * `*.confirmed` broadcasts, so the store does not compute draft rules itself.
 *
 * Handler failures do not reach the ack (they arrive on the `exception`
 * event, recorded in `lastError`); failed emits therefore resolve with
 * `{ ok: false }` after their timeout.
 */

export type ConnectionState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'error';

interface DraftStoreState {
  // --- Session identity ------------------------------------------------------
  draftId: number | null;
  draftCode: string | null;
  draftStatus: string | null;
  /** This client's assigned side (from the draft.join acknowledgement). */
  myTeam: Team | null;
  /** Fearless mode flag, kept in sync via draft.update snapshots. */
  fearlessMode: boolean;

  // --- Live draft state (authoritative, from broadcasts) ----------------------
  currentTurnInfo: TurnStartPayload | null;
  bans: BanConfirmedEntry[];
  picks: PickConfirmedEntry[];
  pending: Partial<Record<Team, PendingSelection | null>>;
  skips: Record<Team, number>;
  /** Explicit phase marker from `phase.*.start` events (TurnManager, T-009). */
  phase: DraftPhase | null;
  /** Completion timestamp from `draft.completed` (R-014). */
  completedAt: string | null;

  // --- Timer events (TurnManager, T-009) --------------------------------------
  timerWarning: TimerWarningPayload | null;
  timerExpired: TimerExpiredPayload | null;

  /** Reason string from `draft.expired` (R-013 reconnection grace expiry). */
  draftExpired: string | null;

  // --- Connection (R-013) -------------------------------------------------------
  connectionState: ConnectionState;
  /** Last measured round-trip latency from health.ping, in ms. */
  latencyMs: number | null;
  /** When the socket last dropped, for grace-period UX. */
  lastDisconnectedAt: number | null;
  /** Most recent server failure message (`exception` / `auth.error`). */
  lastError: string | null;

  // --- State appliers (called by socket listeners) -----------------------------
  applyTurnStart: (turn: TurnStartPayload) => void;
  applyTurnEnd: (nextTurnNumber: number) => void;
  applyDraftUpdate: (snapshot: DraftSessionSnapshot) => void;
  applyBanConfirmed: (payload: BanConfirmedPayload) => void;
  applyPickConfirmed: (payload: PickConfirmedPayload) => void;
  applyPickReordered: (payload: PickReorderedPayload) => void;
  applyDraftCompleted: (payload: DraftCompletedPayload) => void;
  applyPhaseStart: (phase: DraftPhase) => void;
  applyTimerWarning: (payload: TimerWarningPayload) => void;
  applyTimerExpired: (payload: TimerExpiredPayload) => void;
  applyDraftExpired: (payload: DraftExpiredPayload) => void;
  setConnectionState: (state: ConnectionState, message?: string) => void;
  setLatency: (latencyMs: number | null) => void;
  setLastError: (message: string | null) => void;

  // --- Emit wrappers (server-authoritative actions) ------------------------------
  joinDraft: (code: string) => Promise<AckOutcome<DraftJoinAck>>;
  leaveDraft: () => Promise<AckOutcome<SimpleAck>>;
  selectBan: (championId: string | null) => Promise<AckOutcome<ChampionSelectAck>>;
  lockBan: () => Promise<AckOutcome<ChampionLockAck>>;
  skipBan: () => Promise<AckOutcome<SimpleAck>>;
  selectPick: (
    championId: string | null,
  ) => Promise<AckOutcome<ChampionSelectAck>>;
  lockPick: () => Promise<AckOutcome<ChampionLockAck>>;
  optimisticLockBan: () => Promise<AckOutcome<ChampionLockAck>>;
  optimisticLockPick: () => Promise<AckOutcome<ChampionLockAck>>;
  skipPick: () => Promise<AckOutcome<SimpleAck>>;
  swapPicks: (
    fromPickId: number,
    toPickId: number,
  ) => Promise<AckOutcome<PickSwapAck>>;
  pingHealth: () => Promise<AckOutcome<HealthPingAck>>;
  /** Drop the local draft session (logout / navigation away for good). */
  resetSession: () => void;
}

export const useDraftStore = create<DraftStoreState>()((set, get) => ({
  draftId: null,
  draftCode: null,
  draftStatus: null,
  myTeam: null,
  fearlessMode: false,

  currentTurnInfo: null,
  bans: [],
  picks: [],
  pending: {},
  skips: { BLUE: 0, RED: 0 },
  phase: null,
  completedAt: null,

  timerWarning: null,
  timerExpired: null,
  draftExpired: null,

  connectionState: 'idle',
  latencyMs: null,
  lastDisconnectedAt: null,
  lastError: null,

  // --- State appliers ---------------------------------------------------------

  applyTurnStart: (turn) =>
    set((state) => ({
      currentTurnInfo: turn,
      phase: turn.phase,
      // A new turn invalidates the previous timer notifications.
      timerWarning: null,
      timerExpired: null,
      lastError: state.lastError,
    })),

  applyTurnEnd: (nextTurnNumber) =>
    set((state) => ({
      currentTurnInfo: state.currentTurnInfo
        ? { ...state.currentTurnInfo, turnNumber: nextTurnNumber }
        : state.currentTurnInfo,
    })),

  applyDraftUpdate: (snapshot) =>
    set((state) => ({
      draftId: snapshot.draftId,
      draftCode: snapshot.code,
      draftStatus: snapshot.status,
      fearlessMode: snapshot.fearlessMode,
      bans: snapshot.bans,
      picks: snapshot.picks,
      pending: snapshot.pending,
      skips: snapshot.skips,
      // `currentTurnInfo` comes from turn.start broadcasts; draft.update
      // snapshots never weaken it.
      lastError: state.lastError,
    })),

  applyBanConfirmed: (payload) =>
    set((state) => {
      const pending = { ...state.pending };
      pending[payload.team] = null;
      return { bans: payload.bans, pending };
    }),

  applyPickConfirmed: (payload) =>
    set((state) => {
      const pending = { ...state.pending };
      pending[payload.team] = null;
      return { picks: payload.picks, pending };
    }),

  applyPickReordered: (payload) => set({ picks: payload.picks }),

  applyDraftCompleted: (payload) =>
    set({
      draftStatus: 'COMPLETE',
      draftId: payload.draftId,
      draftCode: payload.code,
      completedAt: payload.completedAt,
      picks: payload.picks,
      bans: payload.bans,
      timerWarning: null,
      timerExpired: null,
    }),

  applyPhaseStart: (phase) => set({ phase }),

  applyTimerWarning: (payload) => set({ timerWarning: payload }),

  applyTimerExpired: (payload) => set({ timerExpired: payload }),

  applyDraftExpired: (payload) =>
    set({ draftExpired: payload.reason, draftStatus: 'EXPIRED' }),

  setConnectionState: (connectionState, message) =>
    set((state) => ({
      connectionState,
      lastError:
        message !== undefined && message !== null
          ? message
          : connectionState === 'connected'
            ? null
            : state.lastError,
      lastDisconnectedAt:
        connectionState === 'disconnected'
          ? Date.now()
          : state.lastDisconnectedAt,
    })),

  setLatency: (latencyMs) => set({ latencyMs }),

  setLastError: (message) => set({ lastError: message }),

  // --- Emit wrappers -----------------------------------------------------------

  joinDraft: async (code) => {
    // Moving to a different draft (e.g. creating a new one after the previous
    // draft completed): drop the old room's bans/picks/turn so stale state can
    // never render while the new snapshot loads. The server leaves the old
    // room automatically on the new `draft.join`.
    const current = get();
    if (
      (current.draftId !== null || current.draftCode !== null) &&
      current.draftCode !== code
    ) {
      get().resetSession();
    }

    const socket = getDraftSocket();
    if (!socket.connected) {
      set({ connectionState: 'connecting' });
      socket.connect();
    }

    const outcome = await emitAck<DraftJoinAck>(socket, 'draft.join', { code });
    if (outcome.ok && outcome.data) {
      set({
        draftId: outcome.data.draftId,
        draftCode: code,
        myTeam: outcome.data.team,
        lastError: null,
      });
    } else {
      set({ lastError: outcome.error ?? 'Failed to join draft' });
    }
    return outcome;
  },

  leaveDraft: async () => {
    const socket = getDraftSocket();
    const outcome = await emitAck<SimpleAck>(socket, 'draft.leave', {});
    if (outcome.ok) {
      set({ draftId: null, draftCode: null, myTeam: null });
    }
    return outcome;
  },

  selectBan: async (championId) => {
    const outcome = await emitAck<ChampionSelectAck>(
      getDraftSocket(),
      'ban.select',
      { championId },
    );
    applyLocalPending(get, set, 'BAN', outcome, championId);
    return outcome;
  },

  lockBan: async () => {
    const outcome = await emitAck<ChampionLockAck>(
      getDraftSocket(),
      'ban.lock',
      {},
    );
    if (!outcome.ok) {
      set({ lastError: outcome.error ?? 'Ban lock failed' });
    }
    return outcome;
  },

  /**
   * Optimistically apply the local team's pending ban so the UI shows it
   * locked immediately (R-009), then round-trip with the server. On failure
   * the optimistic ban is rolled back; the outcome is returned so the caller
   * can surface a toast.
   */
  optimisticLockBan: async () => {
    const { myTeam, pending, bans, phase } = get();
    if (!myTeam) {
      return { ok: false, error: 'Not on a team' } as AckOutcome<
        ChampionLockAck
      >;
    }
    const myPending = pending[myTeam];
    if (!myPending || myPending.type !== 'BAN' || !myPending.championId) {
      return { ok: false, error: 'No pending ban' } as AckOutcome<
        ChampionLockAck
      >;
    }
    const snapshot = { bans: [...bans], pending: { ...pending } };
    const nextPending = { ...snapshot.pending };
    nextPending[myTeam] = null;
    const optimisticBan: BanConfirmedEntry = {
      championId: myPending.championId,
      team: myTeam,
      phase: phase === 'BANNING_P2' ? 2 : 1,
      locked: true,
    };
    set({ bans: [...snapshot.bans, optimisticBan], pending: nextPending });
    const outcome = await get().lockBan();
    if (!outcome.ok) {
      set({ bans: snapshot.bans, pending: snapshot.pending });
    }
    return outcome;
  },

  skipBan: async () => {
    const outcome = await emitAck<SimpleAck>(getDraftSocket(), 'ban.skip', {});
    if (!outcome.ok) {
      set({ lastError: outcome.error ?? 'Ban skip failed' });
    }
    return outcome;
  },

  selectPick: async (championId) => {
    const outcome = await emitAck<ChampionSelectAck>(
      getDraftSocket(),
      'pick.select',
      { championId },
    );
    applyLocalPending(get, set, 'PICK', outcome, championId);
    return outcome;
  },

  lockPick: async () => {
    const outcome = await emitAck<ChampionLockAck>(
      getDraftSocket(),
      'pick.lock',
      {},
    );
    if (!outcome.ok) {
      set({ lastError: outcome.error ?? 'Pick lock failed' });
    }
    return outcome;
  },

  /**
   * Optimistically apply the local team's pending pick so the UI shows it
   * locked immediately (R-009), then round-trip with the server. On failure
   * the optimistic pick is rolled back; the outcome is returned so the caller
   * can surface a toast.
   */
  optimisticLockPick: async () => {
    const { myTeam, pending, picks } = get();
    if (!myTeam) {
      return { ok: false, error: 'Not on a team' } as AckOutcome<
        ChampionLockAck
      >;
    }
    const myPending = pending[myTeam];
    if (!myPending || myPending.type !== 'PICK' || !myPending.championId) {
      return { ok: false, error: 'No pending pick' } as AckOutcome<
        ChampionLockAck
      >;
    }
    const snapshot = { picks: [...picks], pending: { ...pending } };
    const nextPending = { ...snapshot.pending };
    nextPending[myTeam] = null;
    const optimisticPick: PickConfirmedEntry = {
      id: -Date.now(),
      championId: myPending.championId,
      team: myTeam,
      locked: true,
    };
    set({ picks: [...snapshot.picks, optimisticPick], pending: nextPending });
    const outcome = await get().lockPick();
    if (!outcome.ok) {
      set({ picks: snapshot.picks, pending: snapshot.pending });
    }
    return outcome;
  },

  skipPick: async () => {
    const outcome = await emitAck<SimpleAck>(getDraftSocket(), 'pick.skip', {});
    if (!outcome.ok) {
      set({ lastError: outcome.error ?? 'Pick skip failed' });
    }
    return outcome;
  },

  swapPicks: async (fromPickId, toPickId) => {
    const outcome = await emitAck<PickSwapAck>(getDraftSocket(), 'pick.swap', {
      fromPickId,
      toPickId,
    });
    if (outcome.ok && outcome.data) {
      get().applyPickReordered({ picks: outcome.data.picks });
      set({ lastError: null });
    } else if (!outcome.ok) {
      set({ lastError: outcome.error ?? 'Pick swap failed' });
    }
    return outcome;
  },

  pingHealth: async () => {
    const outcome = await emitAck<HealthPingAck>(
      getDraftSocket(),
      'health.ping',
      { sentAt: Date.now() },
    );
    if (outcome.ok && outcome.data) {
      set({ latencyMs: outcome.data.latencyMs });
    }
    return outcome;
  },

  resetSession: () =>
    set({
      draftId: null,
      draftCode: null,
      draftStatus: null,
      myTeam: null,
      fearlessMode: false,
      currentTurnInfo: null,
      bans: [],
      picks: [],
      pending: {},
      skips: { BLUE: 0, RED: 0 },
      phase: null,
      completedAt: null,
      timerWarning: null,
      timerExpired: null,
      draftExpired: null,
      lastError: null,
    }),
}));

/**
 * Optimistically mirror the local team's pending selection (R-009) from a
 * successful select acknowledgement. The opponent only sees the selection
 * once it is locked (server-side rule), so this never leaves the device.
 */
function applyLocalPending(
  get: () => DraftStoreState,
  set: (partial: Partial<DraftStoreState>) => void,
  type: 'BAN' | 'PICK',
  outcome: AckOutcome,
  championId: string | null,
): void {
  if (!outcome.ok) {
    return;
  }
  const { myTeam, pending } = get();
  if (!myTeam) {
    return;
  }
  const next = { ...pending };
  next[myTeam] = { type, championId: championId ?? null };
  set({ pending: next });
}
