'use client';

import { useMemo, useState, type CSSProperties } from 'react';
import { useChampionData } from '../../hooks/useChampionData';
import { useDraftStore } from '../../store/draftStore';
import type { PickConfirmedEntry, Team } from '../../lib/socket';
import { countdownColor, useTurnCountdown } from './useTurnCountdown';

/**
 * Finalization Phase board (T-014, R-007).
 *
 * The 60-second grace period after the last pick. Each player may exchange
 * two of their own team's locked picks to change the order in which those
 * picks appear in the draft:
 *
 * - Team-internal only: both picks must belong to the caller's side.
 * - Immediate: the opponent is never asked to approve or reject.
 * - Unlimited while the countdown runs; the server locks the draft (COMPLETE)
 *   when the timer expires.
 *
 * The server is authoritative: every swap broadcasts `pick.reordered` and
 * `draft.update` to both clients.
 */

const sectionStyle: CSSProperties = {
  border: '1px solid #d1d5db',
  borderRadius: '0.5rem',
  padding: '1rem',
  marginBottom: '1rem',
  background: '#fff',
};

const listStyle: CSSProperties = {
  listStyle: 'none',
  margin: '0.5rem 0 0',
  padding: 0,
};

const pickRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '0.75rem',
  padding: '0.35rem 0',
  borderBottom: '1px solid #f3f4f6',
};

function teamLabel(team: Team | null): string {
  if (team === 'BLUE') return 'Blue';
  if (team === 'RED') return 'Red';
  return 'Your team';
}

function teamColor(team: Team | null): string {
  return team === 'RED' ? '#b91c1c' : '#1d4ed8';
}

export default function FinalizationPhase() {
  const myTeam = useDraftStore((s) => s.myTeam);
  const currentTurnInfo = useDraftStore((s) => s.currentTurnInfo);
  const picks = useDraftStore((s) => s.picks);
  const swapPicks = useDraftStore((s) => s.swapPicks);
  const { champions } = useChampionData();

  const remaining = useTurnCountdown();
  const [selectedPickId, setSelectedPickId] = useState<number | null>(null);
  const [swapping, setSwapping] = useState(false);

  const championNames = useMemo(
    () => new Map(champions.map((champion) => [champion.id, champion.name])),
    [champions],
  );

  if (currentTurnInfo?.phase !== 'FINALIZATION') {
    return null; // rendered only during Finalization
  }

  const myPicks = picks.filter((pick) => pick.team === myTeam);
  const opponentPicks = picks.filter((pick) => pick.team !== myTeam);
  const opponentTeam: Team | null =
    myTeam === 'BLUE' ? 'RED' : myTeam === 'RED' ? 'BLUE' : null;
  const canSwap = remaining !== null && remaining > 0 && !swapping;
  const accent = teamColor(myTeam);

  function nameOf(pick: PickConfirmedEntry): string {
    return championNames.get(pick.championId) ?? pick.championId;
  }

  async function handleSwapClick(pickId: number): Promise<void> {
    if (!canSwap) {
      return;
    }
    if (selectedPickId === null) {
      setSelectedPickId(pickId);
      return;
    }
    if (selectedPickId === pickId) {
      setSelectedPickId(null);
      return;
    }

    setSwapping(true);
    try {
      const outcome = await swapPicks(selectedPickId, pickId);
      if (outcome.ok) {
        setSelectedPickId(null);
      }
    } finally {
      setSwapping(false);
    }
  }

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
        <strong>Finalization — reorder your picks</strong>
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

      <p style={{ margin: '0.25rem 0 0', color: '#4b5563', fontSize: '0.85rem' }}>
        Swap two of your own picks to change their order. Swaps apply
        immediately, the opponent is not involved, and you can swap as many
        times as you like until the timer ends.
      </p>

      <p style={{ margin: '0.5rem 0 0', color: accent, fontWeight: 600 }}>
        {teamLabel(myTeam)} picks
      </p>

      {myPicks.length === 0 ? (
        <p style={{ margin: '0.25rem 0 0', color: '#6b7280' }}>
          No picks available to reorder.
        </p>
      ) : (
        <ul style={listStyle}>
          {myPicks.map((pick, index) => {
            const selected = selectedPickId === pick.id;
            return (
              <li key={pick.id} style={pickRowStyle}>
                <span>
                  <span style={{ color: '#6b7280', marginRight: '0.35rem' }}>
                    {index + 1}.
                  </span>
                  <strong>{nameOf(pick)}</strong>
                </span>
                <button
                  type="button"
                  disabled={!canSwap}
                  aria-pressed={selected}
                  style={
                    selected
                      ? { borderColor: accent, color: accent, fontWeight: 700 }
                      : undefined
                  }
                  onClick={() => void handleSwapClick(pick.id)}
                >
                  {selected ? 'Selected — pick another' : 'Swap Pick'}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {selectedPickId !== null && (
        <p style={{ margin: '0.5rem 0 0', color: accent, fontSize: '0.85rem' }}>
          Now choose the other pick to exchange with.
        </p>
      )}

      {opponentPicks.length > 0 && (
        <>
          <p
            style={{
              margin: '0.75rem 0 0',
              color: teamColor(opponentTeam),
              fontWeight: 600,
            }}
          >
            {teamLabel(opponentTeam)} picks (read-only)
          </p>
          <ul style={listStyle}>
            {opponentPicks.map((pick, index) => (
              <li key={pick.id} style={pickRowStyle}>
                <span>
                  <span style={{ color: '#6b7280', marginRight: '0.35rem' }}>
                    {index + 1}.
                  </span>
                  {nameOf(pick)}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      {remaining === 0 && (
        <p style={{ margin: '0.75rem 0 0', color: '#b91c1c', fontWeight: 600 }}>
          Time is up — the draft is locking.
        </p>
      )}
    </div>
  );
}
