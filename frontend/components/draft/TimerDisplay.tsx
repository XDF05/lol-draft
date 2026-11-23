'use client';

import { type CSSProperties } from 'react';
import { countdownColor, useTurnCountdown } from './useTurnCountdown';

/**
 * Reusable visual countdown display for ban/pick/Finalization turns (T-016).
 *
 * Mirrors the server-authoritative countdown (ticked locally from
 * `turn.start`, corrected downward by `timer.warning` at 5s / 3s / 1s) and
 * applies the R-010 warning colours: amber at 5s, orange at 3s, red at 1s.
 *
 * Renders `null` when there is no active turn countdown, so callers can
 * place it unconditionally in any phase board.
 */
export interface TimerDisplayProps {
  /** Additional inline styles merged with the default countdown style. */
  style?: CSSProperties;
}

export default function TimerDisplay({ style }: TimerDisplayProps) {
  const remaining = useTurnCountdown();
  if (remaining === null) {
    return null;
  }

  const baseStyle: CSSProperties = {
    color: remaining > 5 ? 'var(--text)' : countdownColor(remaining),
    fontWeight: 700,
    fontVariantNumeric: 'tabular-nums',
    ...style,
  };

  return <span style={baseStyle}>{remaining}s</span>;
}
