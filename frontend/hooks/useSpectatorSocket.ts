'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  emitAck,
  getSpectatorSocket,
  type BanConfirmedEntry,
  type BanConfirmedPayload,
  type DraftCompletedPayload,
  type DraftExpiredPayload,
  type DraftSessionSnapshot,
  type ExceptionPayload,
  type PickConfirmedEntry,
  type PickConfirmedPayload,
  type PickReorderedPayload,
  type PublicJoinAck,
  type SpectatorSocket,
  type TimerWarningPayload,
  type TurnStartPayload,
} from '../lib/socket';
import type { ConnectionState } from '../store/draftStore';

/**
 * Public spectator socket lifecycle (T-015).
 *
 * - Connects anonymously (no JWT) and joins the draft broadcast room with
 *   `public.join` on every successful connection, including reconnects.
 * - Mirrors the same live events the participant board consumes, so bans,
 *   picks, phase and timer stay in sync without any participant state.
 * - Reconnection grace: if the viewer stays offline for 30 seconds the
 *   spectator session is marked expired (the draft itself is untouched —
 *   only the players' own presence can expire a draft, R-013).
 */

export const SPECTATOR_RECONNECT_GRACE_SECONDS = 30;

export interface SpectatorDraftState {
  draftId: number | null;
  status: string | null;
  fearlessMode: boolean | null;
  bans: BanConfirmedEntry[] | null;
  picks: PickConfirmedEntry[] | null;
  currentTurnInfo: TurnStartPayload | null;
  completedAt: string | null;
  draftExpired: string | null;
  timerWarning: TimerWarningPayload | null;
  connectionState: ConnectionState;
  /** Seconds left in the 30s reconnect window, or null while connected. */
  graceSeconds: number | null;
  /** True once the viewer stayed offline past the grace window. */
  sessionExpired: boolean;
  error: string | null;
}

const INITIAL_STATE: SpectatorDraftState = {
  draftId: null,
  status: null,
  fearlessMode: null,
  bans: null,
  picks: null,
  currentTurnInfo: null,
  completedAt: null,
  draftExpired: null,
  timerWarning: null,
  connectionState: 'idle',
  graceSeconds: null,
  sessionExpired: false,
  error: null,
};

export function useSpectatorSocket(
  code: string,
): SpectatorDraftState & { retry: () => void } {
  const [state, setState] = useState<SpectatorDraftState>(INITIAL_STATE);
  const socketRef = useRef<SpectatorSocket | null>(null);
  const graceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const graceIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const disposedRef = useRef(false);
  /** True once the 30s window elapsed; suppresses further grace cycles. */
  const graceExpiredRef = useRef(false);

  const clearGraceTimers = useCallback(() => {
    if (graceTimerRef.current) {
      clearTimeout(graceTimerRef.current);
      graceTimerRef.current = null;
    }
    if (graceIntervalRef.current) {
      clearInterval(graceIntervalRef.current);
      graceIntervalRef.current = null;
    }
  }, []);

  const beginGrace = useCallback(() => {
    if (disposedRef.current || graceExpiredRef.current || graceTimerRef.current) {
      return;
    }
    setState((s) => ({
      ...s,
      graceSeconds: SPECTATOR_RECONNECT_GRACE_SECONDS,
    }));
    graceIntervalRef.current = setInterval(() => {
      setState((s) =>
        s.graceSeconds === null
          ? s
          : { ...s, graceSeconds: Math.max(0, s.graceSeconds - 1) },
      );
    }, 1000);
    graceTimerRef.current = setTimeout(() => {
      graceTimerRef.current = null;
      graceExpiredRef.current = true;
      if (graceIntervalRef.current) {
        clearInterval(graceIntervalRef.current);
        graceIntervalRef.current = null;
      }
      setState((s) => ({
        ...s,
        graceSeconds: null,
        sessionExpired: true,
        connectionState: 'error',
        error: `Spectator connection lost for more than ${SPECTATOR_RECONNECT_GRACE_SECONDS} seconds.`,
      }));
      // Stop retrying until the viewer explicitly asks to reconnect.
      socketRef.current?.disconnect();
    }, SPECTATOR_RECONNECT_GRACE_SECONDS * 1000);
  }, []);

  const join = useCallback(() => {
    const socket = socketRef.current;
    if (!socket || !socket.connected) {
      return;
    }
    void emitAck<PublicJoinAck>(socket, 'public.join', {
      draftCode: code,
    }).then((outcome) => {
      if (disposedRef.current) {
        return;
      }
      const data = outcome.data;
      if (outcome.ok && data) {
        setState((s) => ({
          ...s,
          draftId: data.draftId,
          status: data.status,
          error: null,
        }));
      } else {
        setState((s) => ({
          ...s,
          error: outcome.error ?? 'Could not join the draft broadcast.',
        }));
      }
    });
  }, [code]);

  useEffect(() => {
    disposedRef.current = false;
    graceExpiredRef.current = false;
    setState(INITIAL_STATE);

    const socket = getSpectatorSocket();
    socketRef.current = socket;

    const onConnect = () => {
      graceExpiredRef.current = false;
      clearGraceTimers();
      setState((s) => ({
        ...s,
        connectionState: 'connected',
        graceSeconds: null,
        sessionExpired: false,
        error: null,
      }));
      join();
    };

    const onDisconnect = () => {
      if (graceExpiredRef.current) {
        return;
      }
      setState((s) => ({ ...s, connectionState: 'disconnected' }));
      beginGrace();
    };

    const onReconnectAttempt = () => {
      if (graceExpiredRef.current) {
        return;
      }
      setState((s) => ({ ...s, connectionState: 'reconnecting' }));
    };

    const onConnectError = () => {
      if (graceExpiredRef.current) {
        return;
      }
      setState((s) => ({ ...s, connectionState: 'reconnecting' }));
      beginGrace();
    };

    const onDraftUpdate = (snapshot: DraftSessionSnapshot) => {
      setState((s) => ({
        ...s,
        draftId: snapshot.draftId,
        status: snapshot.status,
        fearlessMode: snapshot.fearlessMode,
        bans: snapshot.bans,
        picks: snapshot.picks,
      }));
    };

    const onTurnStart = (turn: TurnStartPayload) => {
      setState((s) => ({ ...s, currentTurnInfo: turn, timerWarning: null }));
    };

    const onBanConfirmed = (payload: BanConfirmedPayload) => {
      setState((s) => ({ ...s, bans: payload.bans }));
    };

    const onPickConfirmed = (payload: PickConfirmedPayload) => {
      setState((s) => ({ ...s, picks: payload.picks }));
    };

    const onPickReordered = (payload: PickReorderedPayload) => {
      setState((s) => ({ ...s, picks: payload.picks }));
    };

    const onDraftCompleted = (payload: DraftCompletedPayload) => {
      setState((s) => ({
        ...s,
        draftId: payload.draftId,
        status: 'COMPLETE',
        completedAt: payload.completedAt,
        bans: payload.bans,
        picks: payload.picks,
        currentTurnInfo: null,
        timerWarning: null,
      }));
    };

    const onDraftExpired = (payload: DraftExpiredPayload) => {
      setState((s) => ({
        ...s,
        status: 'EXPIRED',
        draftExpired: payload.reason,
        currentTurnInfo: null,
        timerWarning: null,
      }));
    };

    const onTimerWarning = (payload: TimerWarningPayload) => {
      setState((s) => ({ ...s, timerWarning: payload }));
    };

    const onTimerExpired = () => {
      setState((s) => ({ ...s, timerWarning: null }));
    };

    const onException = (payload: ExceptionPayload) => {
      setState((s) => ({
        ...s,
        error: payload.message,
        // A failed re-join means the draft was deleted or expired while this
        // viewer was offline; show the expiry state instead of a stale board.
        ...(payload.message === 'Draft not found'
          ? { status: 'EXPIRED', currentTurnInfo: null }
          : {}),
      }));
    };

    const onAuthError = (payload: { message: string }) => {
      setState((s) => ({ ...s, error: payload.message }));
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('connect_error', onConnectError);
    socket.io.on('reconnect_attempt', onReconnectAttempt);
    socket.on('draft.update', onDraftUpdate);
    socket.on('turn.start', onTurnStart);
    socket.on('ban.confirmed', onBanConfirmed);
    socket.on('pick.confirmed', onPickConfirmed);
    socket.on('pick.reordered', onPickReordered);
    socket.on('draft.completed', onDraftCompleted);
    socket.on('draft.expired', onDraftExpired);
    socket.on('timer.warning', onTimerWarning);
    socket.on('timer.expired', onTimerExpired);
    socket.on('exception', onException);
    socket.on('auth.error', onAuthError);

    if (socket.connected) {
      onConnect();
    } else {
      setState((s) => ({ ...s, connectionState: 'connecting' }));
      socket.connect();
    }

    return () => {
      disposedRef.current = true;
      clearGraceTimers();
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('connect_error', onConnectError);
      socket.io.off('reconnect_attempt', onReconnectAttempt);
      socket.off('draft.update', onDraftUpdate);
      socket.off('turn.start', onTurnStart);
      socket.off('ban.confirmed', onBanConfirmed);
      socket.off('pick.confirmed', onPickConfirmed);
      socket.off('pick.reordered', onPickReordered);
      socket.off('draft.completed', onDraftCompleted);
      socket.off('draft.expired', onDraftExpired);
      socket.off('timer.warning', onTimerWarning);
      socket.off('timer.expired', onTimerExpired);
      socket.off('exception', onException);
      socket.off('auth.error', onAuthError);
      socket.disconnect();
    };
  }, [beginGrace, clearGraceTimers, join]);

  const retry = useCallback(() => {
    graceExpiredRef.current = false;
    setState((s) => ({
      ...s,
      sessionExpired: false,
      graceSeconds: null,
      error: null,
      connectionState: 'connecting',
    }));
    const socket = socketRef.current;
    if (!socket) {
      return;
    }
    if (socket.connected) {
      join();
    } else {
      socket.connect();
    }
  }, [join]);

  return { ...state, retry };
}

export default useSpectatorSocket;
