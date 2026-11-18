'use client';

import { useState, type CSSProperties } from 'react';
import { useChampionData } from '../../hooks/useChampionData';
import { useDraftStore } from '../../store/draftStore';
import type {
  BanConfirmedEntry,
  PickConfirmedEntry,
} from '../../lib/socket';
import type { Champion } from '../../lib/types';
import { ChampionCard, championGridStyle } from './ChampionCard';
import { countdownColor, useTurnCountdown } from './useTurnCountdown';

/**
 * Ban Phase selection board (T-009), shared by the Blue and Red teams.
 *
 * - The champion pool is filtered through `availableForBan` (banned
 *   champions are always out; picked champions only in Fearless mode,
 *   R-005/R-011 — the server enforces the same rules).
 * - Selection stages a *pending* ban locally; the opponent only sees it
 *   once `ban.confirmed` broadcasts the lock (R-009).
 * - The countdown ticks locally from the `turn.start` payload and resyncs
 *   whenever the server's `timer.warning` fires at 5s / 3s / 1s. The server
 *   auto-locks (or skips) at zero, so the UI only mirrors state.
 */

const sectionStyle: CSSProperties = {
  border: '1px solid #d1d5db',
  borderRadius: '0.5rem',
  padding: '1rem',
  marginBottom: '1rem',
  background: '#fff',
};

/**
 * Champions still selectable for a ban: everything except banned champions
 * (and, in Fearless mode, picked ones — banning a picked champion is then
 * forbidden). Pure so the filter rules can be checked without a renderer.
 */
export function availableForBan(
  champions: readonly Champion[],
  bans: readonly BanConfirmedEntry[],
  picks: readonly PickConfirmedEntry[],
  fearlessMode: boolean,
): Champion[] {
  const banned = new Set(bans.map((b) => b.championId));
  const picked = fearlessMode
    ? new Set(picks.map((p) => p.championId))
    : null;
  return champions.filter(
    (champion) =>
      !banned.has(champion.id) && !(picked?.has(champion.id) ?? false),
  );
}

export default function BanPhase() {
  const myTeam = useDraftStore((s) => s.myTeam);
  const currentTurnInfo = useDraftStore((s) => s.currentTurnInfo);
  const bans = useDraftStore((s) => s.bans);
  const picks = useDraftStore((s) => s.picks);
  const fearlessMode = useDraftStore((s) => s.fearlessMode);
  const pending = useDraftStore((s) => s.pending);
  const selectBan = useDraftStore((s) => s.selectBan);
  const lockBan = useDraftStore((s) => s.lockBan);
  const { champions, status: poolStatus, error: poolError } = useChampionData();

  const remaining = useTurnCountdown();
  const [locking, setLocking] = useState(false);

  const isBanTurn =
    currentTurnInfo !== null && currentTurnInfo.actionType === 'BAN';
  const myPending = myTeam ? pending[myTeam] ?? null : null;
  const isMyTurn = isBanTurn && currentTurnInfo?.expectedTeam === myTeam;
  const canSelect = isMyTurn && !locking;
  const available = availableForBan(champions, bans, picks, fearlessMode);

  // Ban Phase 2 (R-005) runs Red-first and allows counter-bans against
  // Phase 1 picks (unless Fearless mode), tracked as ban #4/#5 per team.
  const isBanPhase2 = currentTurnInfo?.phase === 'BANNING_P2';
  const myTeamBanCount = myTeam
    ? bans.filter((ban) => ban.team === myTeam).length
    : 0;
  const nextBanNumber = myTeamBanCount + 1;

  async function handleLock() {
    if (!myPending?.championId || locking) {
      return;
    }
    setLocking(true);
    try {
      await lockBan();
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
          {isBanPhase2 ? 'Ban Phase 2 — ' : ''}
          {isMyTurn ? 'Your ban pick' : `Waiting for ${(currentTurnInfo?.expectedTeam ?? '').toLowerCase()}…`}
        </strong>
        {remaining !== null && (
          <span
            style={{
              color: countdownColor(remaining),
              fontWeight: 700,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {remaining}s
          </span>
        )}
      </div>

      {isBanTurn && isBanPhase2 && currentTurnInfo?.expectedTeam === 'RED' && (
        <p
          style={{
            margin: '0.5rem 0 0',
            padding: '0.5rem 0.75rem',
            borderRadius: '0.375rem',
            background: '#fef2f2',
            color: '#991b1b',
            fontWeight: 600,
          }}
        >
          Counter-pick opportunity{' '}
          <span style={{ fontWeight: 400 }}>
            — Red can answer Blue&apos;s Phase 1 picks with counter-bans.
          </span>
        </p>
      )}

      {isMyTurn && (
        <p style={{ margin: '0.5rem 0 0', color: '#4b5563', fontSize: '0.85rem' }}>
          This is {myTeam?.toLowerCase()} ban #{nextBanNumber} of 5.
        </p>
      )}

      {selectedId && (
        <p style={{ margin: '0.5rem 0 0', color: '#1d4ed8' }}>
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
          No champions left to ban.
        </p>
      ) : (
        <div style={championGridStyle}>
          {available.map((champion) => (
            <ChampionCard
              key={champion.id}
              champion={champion}
              selected={selectedId === champion.id}
              disabled={!canSelect}
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
        {locking ? 'Locking…' : 'Lock ban'}
      </button>
    </div>
  );
}
