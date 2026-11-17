import { create } from 'zustand';
import {
  emitAck,
  getDraftSocket,
  type AckOutcome,
  type BanConfirmedEntry,
  type BanConfirmedPayload,
  type ChampionLockAck,
  type ChampionSelectAck,
  type DraftJoinAck,
  type DraftPhase,
  type DraftExpiredPayload,
  type DraftSessionSnapshot,
  type HealthPingAck,
  type PendingSelection,
  type PickConfirmedEntry,
  type PickConfirmedPayload,
  type SimpleAck,
  type SwapDecisionAck,
  type SwapRequestAck,
  type SwapRequestEntry,
  type SwapResolvedPayload,
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
  swapRequests: SwapRequestEntry[];
  /** Explicit phase marker from `phase.*.start` events (TurnManager, T-011). */
  phase: DraftPhase | null;

  // --- Timer events (TurnManager, T-011) --------------------------------------
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
  applySwapRequested: (request: SwapRequestEntry) => void;
  applySwapResolved: (payload: SwapResolvedPayload) => void;
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
  skipPick: () => Promise<AckOutcome<SimpleAck>>;
  requestSwap: (
    offerChampionId: string,
    targetChampionId: string,
  ) => Promise<AckOutcome<SwapRequestAck>>;
  decideSwap: (
    requestId: string,
    approve: boolean,
  ) => Promise<AckOutcome<SwapDecisionAck>>;
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
  swapRequests: [],
  phase: null,

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
      swapRequests: snapshot.swapRequests,
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

  applySwapRequested: (request) =>
    set((state) => {
      const others = state.swapRequests.filter((r) => r.id !== request.id);
      return { swapRequests: [...others, request] };
    }),

  applySwapResolved: (payload) =>
    set((state) => ({
      swapRequests: state.swapRequests.map((r) =>
        r.id === payload.request.id ? payload.request : r,
      ),
    })),

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

  skipPick: async () => {
    const outcome = await emitAck<SimpleAck>(getDraftSocket(), 'pick.skip', {});
    if (!outcome.ok) {
      set({ lastError: outcome.error ?? 'Pick skip failed' });
    }
    return outcome;
  },

  requestSwap: async (offerChampionId, targetChampionId) => {
    const outcome = await emitAck<SwapRequestAck>(
      getDraftSocket(),
      'swap.request',
      {
        proposedSwapWith: offerChampionId,
        targetChampionId,
      },
    );
    if (outcome.ok && outcome.data) {
      get().applySwapRequested(outcome.data.request);
    }
    return outcome;
  },

  decideSwap: async (requestId, approve) => {
    const outcome = approve
      ? await emitAck<SwapDecisionAck>(getDraftSocket(), 'swap.approve', {
          requestId,
        })
      : await emitAck<SwapDecisionAck>(getDraftSocket(), 'swap.reject', {
          requestId,
        });
    if (outcome.ok && outcome.data) {
      get().applySwapResolved({
        request: outcome.data.request,
        approved: outcome.data.approved,
      });
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
      swapRequests: [],
      phase: null,
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
