'use client';

import { useEffect } from 'react';
import {
  getDraftSocket,
  type DraftPhase,
  type DraftSocket,
} from '../lib/socket';
import { useDraftStore } from '../store/draftStore';

/**
 * Socket.IO connection management hook (T-007).
 *
 * - Ensures the app-level socket (lib/socket.ts singleton) is connected and
 *   attaches every server→client listener while the component is mounted,
 *   detaching them again on unmount (per-event `socket.off`).
 * - Automatic reconnection (R-013): socket.io retries with exponential
 *   backoff; the `auth` option re-reads the current JWT for each attempt.
 *   On every successful (re)connection an active draft room is re-joined so
 *   the server re-broadcasts `turn.start` + `draft.update` (state resync).
 * - Graceful disconnection: drop events never clear draft state — the last
 *   known bans/picks/turn stay in the store while the connection is down
 *   (`lastDisconnectedAt` records when it happened).
 * - While connected, a periodic `health.ping` measures latency for the
 *   connection indicator and the server's health monitoring.
 *
 * The listener wiring lives in `attachDraftEventListeners` so it can be
 * exercised without React (integration tests).
 */

type ServerHandler = [event: string, handler: (...args: never[]) => void];

/**
 * Attach all server→client event listeners to the socket, feeding the draft
 * store. Returns a function that removes them all again.
 */
export function attachDraftEventListeners(socket: DraftSocket): () => void {
  const store = () => useDraftStore.getState();
  const phaseHandlers: Array<[string, DraftPhase]> = [
    ['phase.ban1.start', 'BANNING_P1'],
    ['phase.pick1.start', 'PICKING_P1'],
    ['phase.ban2.start', 'BANNING_P2'],
    ['phase.pick2.start', 'PICKING_P2'],
    ['phase.finalization.start', 'FINALIZATION'],
  ];

  const handlers: ServerHandler[] = [
    ['draft.update', (state) => store().applyDraftUpdate(state as never)],
    ['turn.start', (turn) => store().applyTurnStart(turn as never)],
    ['turn.end', (next) => store().applyTurnEnd(next as never)],
    ['ban.confirmed', (p) => store().applyBanConfirmed(p as never)],
    ['pick.confirmed', (p) => store().applyPickConfirmed(p as never)],
    ['swap.requested', (r) => store().applySwapRequested(r as never)],
    ['swap.resolved', (p) => store().applySwapResolved(p as never)],
    [
      'timer.warning',
      (p) => store().applyTimerWarning(p as never),
    ],
    [
      'timer.expired',
      (p) => store().applyTimerExpired(p as never),
    ],
    [
      'auth.error',
      (p) => {
        const { message } = p as { message?: string };
        store().setConnectionState('error', message ?? 'Authentication failed');
      },
    ],
    [
      'exception',
      (p) => {
        const { message } = p as { message?: string };
        store().setLastError(message ?? 'Unknown server error');
      },
    ],
    ...phaseHandlers.map(
      ([event, phase]) =>
        [event, () => store().applyPhaseStart(phase)] as ServerHandler,
    ),
  ];

  for (const [event, handler] of handlers) {
    socket.on(event as never, handler as never);
  }

  return () => {
    for (const [event, handler] of handlers) {
      socket.off(event as never, handler as never);
    }
  };
}

/**
 * Attach connection-lifecycle listeners: state transitions and the
 * reconnection re-join. Returns a function that removes them again.
 */
export function attachConnectionListeners(socket: DraftSocket): () => void {
  const store = () => useDraftStore.getState();

  const onConnect = () => {
    store().setConnectionState('connected');
    // Re-join the active draft after reconnecting (or after a hot remount):
    // the server answers with turn.start + draft.update for the whole room,
    // resyncing our local state with the authoritative session (R-013).
    const { draftCode } = store();
    if (draftCode) {
      void store().joinDraft(draftCode);
    }
  };

  const onDisconnect = () => {
    // State preservation: keep bans/picks/turn as-is, only record the drop.
    store().setConnectionState('disconnected');
  };

  const onReconnectAttempt = () => {
    store().setConnectionState('reconnecting');
  };

  socket.on('connect', onConnect);
  socket.on('disconnect', onDisconnect);
  // reconnection lifecycle events live on the Manager (socket.io namespace).
  socket.io.on('reconnect_attempt', onReconnectAttempt);

  return () => {
    socket.off('connect', onConnect);
    socket.off('disconnect', onDisconnect);
    socket.io.off('reconnect_attempt', onReconnectAttempt);
  };
}

export function useSocket(): { socket: DraftSocket } {
  const socket = getDraftSocket();

  useEffect(() => {
    const store = () => useDraftStore.getState();

    if (!socket.connected) {
      store().setConnectionState('connecting');
      socket.connect();
    }

    const detachListeners = attachDraftEventListeners(socket);
    const detachConnection = attachConnectionListeners(socket);

    // Latency probe while connected (feeds the connection indicator and the
    // server's ConnectionHealthService).
    const healthInterval = setInterval(() => {
      if (socket.connected) {
        void store().pingHealth();
      }
    }, 15000);

    return () => {
      detachListeners();
      detachConnection();
      clearInterval(healthInterval);
    };
  }, [socket]);

  return { socket };
}

export default useSocket;
