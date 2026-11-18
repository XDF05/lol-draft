'use client';

import { useEffect, useState } from 'react';
import { useDraftStore } from '../../store/draftStore';
import type {
  TimerWarningPayload,
  TurnStartPayload,
} from '../../lib/socket';

/**
 * Shared turn countdown for the ban and pick boards (R-010).
 *
 * Starts from the last `turn.start` (preferring a mid-turn
 * `remainingSeconds`), ticks down once a second, and snaps to the server's
 * authoritative `timer.warning` values at 5s / 3s / 1s.
 */

/** Warning tier colours at 5s / 3s / 1s (R-010). */
const WARNING_AMBER = '#d97706';
const WARNING_ORANGE = '#ea580c';
const WARNING_RED = '#dc2626';
const NEUTRAL = '#111827';

/** Colour for the countdown at a given remaining-seconds value. */
export function countdownColor(remaining: number): string {
  if (remaining <= 1) return WARNING_RED;
  if (remaining <= 3) return WARNING_ORANGE;
  if (remaining <= 5) return WARNING_AMBER;
  return NEUTRAL;
}

export function useTurnCountdown(): number | null {
  const currentTurnInfo = useDraftStore((s) => s.currentTurnInfo);
  const timerWarning = useDraftStore((s) => s.timerWarning);
  const [remaining, setRemaining] = useState<number | null>(null);

  // New turn (or reconnect into one) → restart the local countdown.
  useEffect(() => {
    if (!currentTurnInfo) {
      setRemaining(null);
      return;
    }
    setRemaining(
      currentTurnInfo.remainingSeconds ?? currentTurnInfo.timerSeconds,
    );
  }, [currentTurnInfo]);

  // One tick per second for the current turn; restarted only on turn change.
  useEffect(() => {
    if (!currentTurnInfo) {
      return;
    }
    const interval = window.setInterval(() => {
      setRemaining((value) =>
        value === null || value <= 0 ? value : value - 1,
      );
    }, 1000);
    return () => window.clearInterval(interval);
  }, [currentTurnInfo]);

  // Server warnings are authoritative: correct a drifting clock downward
  // (never upward — a late warning must not resurrect time that passed).
  useEffect(() => {
    if (!timerWarning || !currentTurnInfo) {
      return;
    }
    applyWarningIfCurrent(timerWarning, currentTurnInfo, setRemaining);
  }, [timerWarning, currentTurnInfo]);

  return remaining;
}

function applyWarningIfCurrent(
  warning: TimerWarningPayload,
  turn: TurnStartPayload,
  setRemaining: (update: (value: number | null) => number | null) => void,
): void {
  if (warning.turn.turnNumber !== turn.turnNumber) {
    return; // a stale warning from the previous turn
  }
  setRemaining((value) =>
    value === null ? null : Math.min(value, warning.seconds),
  );
}
