'use client';

import { useDraftStore } from '../../store/draftStore';
import type { ConnectionState } from '../../store/draftStore';

/**
 * Connection state indicator (T-007, R-013).
 *
 * A small pill showing the socket connection state and, when live, the
 * measured round-trip latency. Mount it in the draft board layout once
 * draft pages exist (T-008+).
 */

const STYLES: Record<ConnectionState, { text: string; color: string; dot: string }> = {
  idle: { text: 'Offline', color: 'var(--text-muted)', dot: '#9ca3af' },
  connecting: { text: 'Connecting…', color: 'var(--warning)', dot: '#f59e0b' },
  connected: { text: 'Live', color: 'var(--success)', dot: '#22c55e' },
  reconnecting: { text: 'Reconnecting…', color: 'var(--warning)', dot: '#f59e0b' },
  disconnected: { text: 'Disconnected — reconnecting', color: 'var(--warning)', dot: '#f59e0b' },
  error: { text: 'Connection error', color: 'var(--danger)', dot: '#ef4444' },
};

export default function ConnectionIndicator({
  connectionState: connectionStateOverride,
  latencyMs: latencyOverride,
}: {
  /** Override for views with their own socket (public spectators, T-015). */
  connectionState?: ConnectionState;
  latencyMs?: number | null;
} = {}) {
  const storeState = useDraftStore((s) => s.connectionState);
  const storeLatency = useDraftStore((s) => s.latencyMs);
  const connectionState = connectionStateOverride ?? storeState;
  const latencyMs =
    latencyOverride !== undefined ? latencyOverride : storeLatency;

  const style = STYLES[connectionState];

  return (
    <div
      aria-live="polite"
      className="connection-pill"
      style={{ color: style.color }}
    >
      <span
        className="connection-dot"
        style={{ background: style.dot }}
      />
      {style.text}
      {connectionState === 'connected' && latencyMs !== null && (
        <span style={{ fontWeight: 400 }}>{Math.round(latencyMs)} ms</span>
      )}
    </div>
  );
}
