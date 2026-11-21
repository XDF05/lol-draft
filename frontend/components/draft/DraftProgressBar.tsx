'use client';

import { useDraftStore } from '../../store/draftStore';

/** Total ban/pick/Finalization turns in a complete draft (R-003 to R-007). */
const TOTAL_TURNS = 21;

const PHASE_LABELS: Record<string, string> = {
  BANNING_P1: 'Ban Phase 1',
  PICKING_P1: 'Pick Phase 1',
  BANNING_P2: 'Ban Phase 2',
  PICKING_P2: 'Pick Phase 2',
  FINALIZATION: 'Finalization',
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
    <div className="draft-progress">
      <div className="draft-progress-header">
        <span className="draft-progress-phase">
          {PHASE_LABELS[phase ?? ''] ?? phase ?? 'Syncing…'}
        </span>
        <span className="draft-progress-turn">
          Turn {turnNumber || 0} of {TOTAL_TURNS}
        </span>
      </div>
      <div className="draft-progress-track">
        <div className="draft-progress-fill" style={{ width: `${progress}%` }} />
      </div>
      <div className="draft-progress-caption">
        <span>{bans.length} bans</span>
        <span>{picks.length} picks</span>
      </div>
    </div>
  );
}
