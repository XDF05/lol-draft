'use client';

import { useState, type CSSProperties } from 'react';
import { useToast } from '../common/Toast';
import { useChampionData } from '../../hooks/useChampionData';
import { useDraftStore } from '../../store/draftStore';
import ChampionPool from './ChampionPool';
import TimerDisplay from './TimerDisplay';
import { useDraftKeyboardShortcuts } from './useDraftKeyboardShortcuts';

/**
 * Ban Phase selection board (T-009), shared by the Blue and Red teams.
 *
 * - One ban rule, shared with the server: a champion that is already banned
 *   or already picked is never bannable. Such champions stay visible in the
 *   pool, labelled, but their card is disabled.
 * - Selection stages a *pending* ban locally; the opponent only sees it
 *   once `ban.confirmed` broadcasts the lock (R-009).
 * - The countdown ticks locally from the `turn.start` payload and resyncs
 *   whenever the server's `timer.warning` fires at 5s / 3s / 1s. The server
 *   auto-locks (or skips) at zero, so the UI only mirrors state.
 */

export default function BanPhase() {
  const myTeam = useDraftStore((s) => s.myTeam);
  const currentTurnInfo = useDraftStore((s) => s.currentTurnInfo);
  const bans = useDraftStore((s) => s.bans);
  const picks = useDraftStore((s) => s.picks);
  const pending = useDraftStore((s) => s.pending);
  const selectBan = useDraftStore((s) => s.selectBan);
  const optimisticLockBan = useDraftStore((s) => s.optimisticLockBan);
  const { champions, status: poolStatus, error: poolError } = useChampionData();

  const [locking, setLocking] = useState(false);
  const { toast: showToast } = useToast();

  const isBanTurn =
    currentTurnInfo !== null && currentTurnInfo.actionType === 'BAN';
  const myPending = myTeam ? pending[myTeam] ?? null : null;
  const isMyTurn = isBanTurn && currentTurnInfo?.expectedTeam === myTeam;
  const canSelect = isMyTurn && !locking;

  useDraftKeyboardShortcuts({
    onConfirm: handleLock,
    onCancel: () => void selectBan(null),
    enabled: canSelect,
  });

  const bannedIds = new Set(bans.map((ban) => ban.championId));
  const pickedIds = new Set(picks.map((pick) => pick.championId));
  // A champion that is already banned or already picked is never bannable.
  // It stays in the pool, labelled, so players can see why it is unavailable.
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
  // Ban Phase 2 (R-005) runs Red-first and is tracked as ban #4/#5 per team.
  const isBanPhase2 = currentTurnInfo?.phase === 'BANNING_P2';

  async function handleLock() {
    if (!myPending?.championId || locking) {
      return;
    }
    setLocking(true);
    try {
      const outcome = await optimisticLockBan();
      if (!outcome.ok) {
        showToast({
          title: 'Ban lock failed',
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
    void selectBan(myPending?.championId === championId ? null : championId);
  }

  if (!isBanTurn) {
    return null; // rendered only during ban phases
  }

  const selectedId = myPending?.championId ?? null;

  const accent = myTeam === 'RED' ? '#dc2626' : '#2563eb';

  return (
    <div className="phase-panel">
      <div className="phase-heading">
        <strong>
          {isBanPhase2 ? 'Ban Phase 2 — ' : ''}
          {isMyTurn ? 'Your ban pick' : `Waiting for ${(currentTurnInfo?.expectedTeam ?? '').toLowerCase()}…`}
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
          {isMyTurn ? 'Choose one champion, then lock it in.' : 'Waiting for the other player.'}
        </span>
        <button
          type="button"
          style={{ '--accent': accent } as CSSProperties}
          disabled={!selectedId || locking || !isMyTurn}
          onClick={() => void handleLock()}
        >
          {locking ? 'Locking…' : 'Lock ban'}
        </button>
      </div>
    </div>
  );
}
