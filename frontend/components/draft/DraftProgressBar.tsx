'use client';

import { useDraftStore } from '../../store/draftStore';
import type { CSSProperties } from 'react';

/** Total ban/pick/Finalization turns in a complete draft (R-003 to R-007). */
const TOTAL_TURNS = 21;

const PHASE_LABELS: Record<string, string> = {
  BANNING_P1: 'Ban Phase 1',
  PICKING_P1: 'Pick Phase 1',
  BANNING_P2: 'Ban Phase 2',
  PICKING_P2: 'Pick Phase 2',
  FINALIZATION: 'Finalization',
};

const containerStyle: CSSProperties = {
  border: '1px solid #d1d5db',
  borderRadius: '0.5rem',
  padding: '0.75rem 1rem',
  marginBottom: '1rem',
  background: '#fff',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.5rem',
};

const headerStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'baseline',
  gap: '0.5rem',
};

const phaseStyle: CSSProperties = {
  fontWeight: 600,
  fontSize: '0.875rem',
  color: '#0f172a',
};

const turnStyle: CSSProperties = {
  fontSize: '0.8125rem',
  color: '#475569',
};

const trackStyle: CSSProperties = {
  height: '0.5rem',
  borderRadius: 9999,
  background: '#e2e8f0',
  overflow: 'hidden',
};

const fillStyle: CSSProperties = {
  height: '100%',
  borderRadius: 9999,
  background: '#1d4ed8',
  transition: 'width 0.3s ease',
};

const captionStyle: CSSProperties = {
  fontSize: '0.75rem',
  color: '#6b7280',
  display: 'flex',
  gap: '1rem',
};

/**
 * Draft progress bar (T-018, task 146).
 *
 * Shows overall progress across all 21 draft turns plus the current phase.
 * Progress is driven by the server-authoritative turn number, so both clients
 * stay in sync (R-008).
 */
export default function DraftProgressBar() {
  const currentTurnInfo = useDraftStore((s) => s.currentTurnInfo);
  const phase = useDraftStore((s) => s.phase);
  const bans = useDraftStore((s) => s.bans);
  const picks = useDraftStore((s) => s.picks);
  const draftStatus = useDraftStore((s) => s.draftStatus);

  const turnNumber = currentTurnInfo?.turnNumber ?? 0;
  const completed = draftStatus === 'COMPLETE' ? TOTAL_TURNS : Math.max(0, turnNumber - 1);
  const progress = Math.min(100, Math.round((completed / TOTAL_TURNS) * 100));

  if (!currentTurnInfo && draftStatus !== 'COMPLETE') {
    return null;
  }

  return (
    <div style={containerStyle}>
      <div style={headerStyle}>
        <span style={phaseStyle}>
          {PHASE_LABELS[phase ?? ''] ?? phase ?? 'Syncing…'}
        </span>
        <span style={turnStyle}>
          Turn {turnNumber || 0} of {TOTAL_TURNS}
        </span>
      </div>
      <div style={trackStyle}>
        <div style={{ ...fillStyle, width: `${progress}%` }} />
      </div>
      <div style={captionStyle}>
        <span>{bans.length} bans</span>
        <span>{picks.length} picks</span>
      </div>
    </div>
  );
}
