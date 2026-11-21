'use client';

import { useState, type CSSProperties } from 'react';
import { useToast } from '../common/Toast';
import { useChampionData } from '../../hooks/useChampionData';
import { useDraftStore } from '../../store/draftStore';
import { useIsMobile } from '../../lib/useMediaQuery';
import type {
  BanConfirmedEntry,
  PickConfirmedEntry,
  Team,
} from '../../lib/socket';
import type { Champion } from '../../lib/types';
import { ChampionCard, championGridStyle } from './ChampionCard';
import TimerDisplay from './TimerDisplay';
import { useDraftKeyboardShortcuts } from './useDraftKeyboardShortcuts';

/**
 * Pick Phase selection board (T-010), shared by the Blue and Red teams.
 *
 * - Banned champions and every locked pick are removed from the pool
 *   immediately (R-011), so the component also serves Pick Phase 2.
 * - Pick Phase 2 (R-006) opens with Red's counter-pick, gives Blue the
 *   back-to-back advantage and closes with Red's final pick.
 * - The turn schedule supplies the asymmetric pick order; this board only
 *   mirrors it and highlights the back-to-back "advantage" picks and the
 *   Red side's closing counter-pick.
 * - Selection stages a *pending* pick locally; the opponent only sees it
 *   once `pick.confirmed` broadcasts the lock (R-009).
 */

const sectionStyle: CSSProperties = {
  border: '1px solid #d1d5db',
  borderRadius: '0.5rem',
  padding: '1rem',
  marginBottom: '1rem',
  background: '#fff',
};

/** Champions still selectable for a pick: not banned and not already picked. */
export function availableForPick(
  champions: readonly Champion[],
  bans: readonly BanConfirmedEntry[],
  picks: readonly PickConfirmedEntry[],
): Champion[] {
  const banned = new Set(bans.map((b) => b.championId));
  const picked = new Set(picks.map((p) => p.championId));
  return champions.filter(
    (champion) => !banned.has(champion.id) && !picked.has(champion.id),
  );
}

/**
 * Locked picks per team. Both sides finish the draft with 5 picks
 * (R-006: Blue = 5, Red = 5), so the UI can show progress against that total.
 */
export function pickCounts(
  picks: readonly PickConfirmedEntry[],
): Record<Team, number> {
  return {
    BLUE: picks.filter((pick) => pick.team === 'BLUE').length,
    RED: picks.filter((pick) => pick.team === 'RED').length,
  };
}

export interface PickAdvantage {
  team: Team;
  label: string;
  detail: string;
}

/**
 * Pick advantage windows (R-004, R-006): Red picks twice in a row on turns
 * 8-9, Blue answers with two in a row on turns 10-11 and Red closes Pick
 * Phase 1 on turn 12. Pick Phase 2 opens with Red's counter-pick on turn 17,
 * Blue takes the back-to-back advantage on turns 18-19, and Red closes the
 * draft on turn 20.
 */
export function pickAdvantage(turnNumber: number): PickAdvantage | null {
  switch (turnNumber) {
    case 8:
    case 9:
      return {
        team: 'RED',
        label: 'Red Advantage',
        detail: 'Red has back-to-back picks.',
      };
    case 10:
    case 11:
      return {
        team: 'BLUE',
        label: 'Blue Advantage',
        detail: 'Blue has back-to-back picks.',
      };
    case 12:
      return {
        team: 'RED',
        label: 'Red Counter-Pick',
        detail: 'Final pick of Pick Phase 1.',
      };
    case 17:
      return {
        team: 'RED',
        label: 'Red Counter-Pick',
        detail: 'First pick of Pick Phase 2 — Red answers the Phase 2 bans.',
      };
    case 18:
    case 19:
      return {
        team: 'BLUE',
        label: 'Blue Advantage',
        detail: 'Blue has back-to-back picks.',
      };
    case 20:
      return {
        team: 'RED',
        label: 'Red Last Pick',
        detail: 'Final pick of the draft.',
      };
    default:
      return null;
  }
}

export default function PickPhase() {
  const myTeam = useDraftStore((s) => s.myTeam);
  const currentTurnInfo = useDraftStore((s) => s.currentTurnInfo);
  const bans = useDraftStore((s) => s.bans);
  const picks = useDraftStore((s) => s.picks);
  const pending = useDraftStore((s) => s.pending);
  const selectPick = useDraftStore((s) => s.selectPick);
  const optimisticLockPick = useDraftStore((s) => s.optimisticLockPick);
  const { champions, status: poolStatus, error: poolError } = useChampionData();

  const [locking, setLocking] = useState(false);
  const { toast: showToast } = useToast();

  const isPickTurn =
    currentTurnInfo !== null && currentTurnInfo.actionType === 'PICK';
  const myPending = myTeam ? pending[myTeam] ?? null : null;
  const selectedId =
    myPending?.type === 'PICK' ? (myPending.championId ?? null) : null;
  const isMyTurn = isPickTurn && currentTurnInfo?.expectedTeam === myTeam;
  const canSelect = isMyTurn && !locking;

  useDraftKeyboardShortcuts({
    onConfirm: handleLock,
    onCancel: () => void selectPick(null),
    enabled: canSelect,
  });
  const available = availableForPick(champions, bans, picks);
  const totals = pickCounts(picks);
  const isPickPhase2 = currentTurnInfo?.phase === 'PICKING_P2';
  const advantage = currentTurnInfo
    ? pickAdvantage(currentTurnInfo.turnNumber)
    : null;
  const isMobile = useIsMobile();

  async function handleLock() {
    if (!selectedId || locking) {
      return;
    }
    setLocking(true);
    try {
      const outcome = await optimisticLockPick();
      if (!outcome.ok) {
        showToast({
          title: 'Pick lock failed',
          description: outcome.error ?? 'Please try again.',
        });
      }
    } finally {
      setLocking(false);
    }
  }

  function toggleSelection(championId: string) {
    if (!canSelect) {
      return;
    }
    // Toggle: clicking the staged champion again clears the selection.
    void selectPick(selectedId === championId ? null : championId);
  }

  if (!isPickTurn) {
    return null; // rendered only during pick phases
  }

  const accent = myTeam === 'RED' ? '#b91c1c' : '#1d4ed8';

  return (
    <div style={sectionStyle}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          gap: '1rem',
        }}
      >
        <strong>
          {isPickPhase2 ? 'Pick Phase 2 — ' : ''}
          {isMyTurn
            ? 'Your pick'
            : `Waiting for ${(currentTurnInfo?.expectedTeam ?? '').toLowerCase()}…`}
        </strong>
        <TimerDisplay />
      </div>

      <p style={{ margin: '0.25rem 0 0', color: '#4b5563', fontSize: '0.85rem' }}>
        Picks — Blue {totals.BLUE}/5 · Red {totals.RED}/5
      </p>

      {advantage && (
        <p
          style={{
            margin: '0.5rem 0 0',
            padding: '0.5rem 0.75rem',
            borderRadius: '0.375rem',
            background: advantage.team === 'BLUE' ? '#eff6ff' : '#fef2f2',
            color: advantage.team === 'BLUE' ? '#1e40af' : '#991b1b',
            fontWeight: 600,
          }}
        >
          {advantage.label}{' '}
          <span style={{ fontWeight: 400 }}>— {advantage.detail}</span>
        </p>
      )}

      {selectedId && (
        <p style={{ margin: '0.5rem 0 0', color: accent }}>
          Staged: <strong>{selectedId}</strong> — lock it in or pick another.
        </p>
      )}

      {poolStatus === 'error' ? (
        <p style={{ marginTop: '0.75rem', color: '#b91c1c' }}>
          {poolError ?? 'Could not load the champion pool.'}
        </p>
      ) : poolStatus !== 'ready' ? (
        <p style={{ marginTop: '0.75rem', color: '#6b7280' }}>
          Loading champion pool…
        </p>
      ) : available.length === 0 ? (
        <p style={{ marginTop: '0.75rem', color: '#6b7280' }}>
          No champions left to pick.
        </p>
      ) : (
        <div style={championGridStyle(isMobile)}>
          {available.map((champion) => (
            <ChampionCard
              key={champion.id}
              champion={champion}
              selected={selectedId === champion.id}
              disabled={!canSelect}
              accent={accent}
              onToggle={() => toggleSelection(champion.id)}
            />
          ))}
        </div>
      )}

      <button
        type="button"
        style={{ marginTop: '0.75rem' }}
        disabled={!selectedId || locking || !isMyTurn}
        onClick={() => void handleLock()}
      >
        {locking ? 'Locking…' : 'Lock pick'}
      </button>
    </div>
  );
}
