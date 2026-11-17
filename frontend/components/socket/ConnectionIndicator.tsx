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
  idle: { text: 'Offline', color: '#6b7280', dot: '#9ca3af' },
  connecting: { text: 'Connecting…', color: '#b45309', dot: '#f59e0b' },
  connected: { text: 'Live', color: '#15803d', dot: '#22c55e' },
  reconnecting: { text: 'Reconnecting…', color: '#b45309', dot: '#f59e0b' },
  disconnected: { text: 'Disconnected — reconnecting', color: '#b45309', dot: '#f59e0b' },
  error: { text: 'Connection error', color: '#b91c1c', dot: '#ef4444' },
};

export default function ConnectionIndicator() {
  const connectionState = useDraftStore((s) => s.connectionState);
  const latencyMs = useDraftStore((s) => s.latencyMs);

  const style = STYLES[connectionState];

  return (
    <div
      aria-live="polite"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.5rem',
        padding: '0.25rem 0.75rem',
        borderRadius: 9999,
        border: `1px solid ${style.color}`,
        color: style.color,
        fontSize: '0.8rem',
        fontWeight: 600,
        background: 'rgba(0,0,0,0.03)',
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: style.dot,
          display: 'inline-block',
        }}
      />
      {style.text}
      {connectionState === 'connected' && latencyMs !== null && (
        <span style={{ fontWeight: 400 }}>{Math.round(latencyMs)} ms</span>
      )}
    </div>
  );
}
