'use client';

import { useState, type CSSProperties } from 'react';
import { useToast } from '../common/Toast';
import { useChampionData } from '../../hooks/useChampionData';
import { useDraftStore } from '../../store/draftStore';
import type { BanConfirmedEntry, PickConfirmedEntry } from '../../lib/socket';
import type { Champion } from '../../lib/types';
import ChampionPool from './ChampionPool';
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
 *   mirrors it while keeping the champion pool as the focal point.
 * - Selection stages a *pending* pick locally; the opponent only sees it
 *   once `pick.confirmed` broadcasts the lock (R-009).
 */

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
  const myPending = myTeam ? (pending[myTeam] ?? null) : null;
  const selectedId =
    myPending?.type === 'PICK' ? (myPending.championId ?? null) : null;
  const isMyTurn = isPickTurn && currentTurnInfo?.expectedTeam === myTeam;
  const canSelect = isMyTurn && !locking;

  useDraftKeyboardShortcuts({
    onConfirm: handleLock,
    onCancel: () => void selectPick(null),
    enabled: canSelect,
  });
  const bannedIds = new Set(bans.map((ban) => ban.championId));
  const pickedIds = new Set(picks.map((pick) => pick.championId));
  const championStatus = new Map(
    champions.map((champion) => {
      if (bannedIds.has(champion.id)) {
        return [champion.id, 'banned'] as const;
      }
      if (pickedIds.has(champion.id)) {
        return [champion.id, 'picked'] as const;
      }
      return [champion.id, 'available'] as const;
    }),
  );
  const isPickPhase2 = currentTurnInfo?.phase === 'PICKING_P2';
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
    <div className="phase-panel">
      <div className="phase-heading">
        <strong>
          {isPickPhase2 ? 'Pick Phase 2 — ' : ''}
          {isMyTurn
            ? 'Your pick'
            : `Waiting for ${(currentTurnInfo?.expectedTeam ?? '').toLowerCase()}…`}
        </strong>
        <TimerDisplay />
      </div>

      <ChampionPool
        champions={champions}
        status={poolStatus}
        error={poolError}
        statusById={championStatus}
        selectedId={selectedId}
        disabled={!canSelect}
        accent={accent}
        onToggle={toggleSelection}
      />

      <div className="phase-action-row">
        <span className="muted">
          {isMyTurn
            ? 'Choose one champion, then lock it in.'
            : 'Waiting for the other player.'}
        </span>
        <button
          type="button"
          style={{ '--accent': accent } as CSSProperties}
          disabled={!selectedId || locking || !isMyTurn}
          onClick={() => void handleLock()}
        >
          {locking ? 'Locking…' : 'Lock pick'}
        </button>
      </div>
    </div>
  );
}
