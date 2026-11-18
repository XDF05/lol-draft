'use client';

import {
  useEffect,
  useState,
  type CSSProperties,
} from 'react';
import { useChampionData } from '../../hooks/useChampionData';
import { useDraftStore } from '../../store/draftStore';
import type {
  BanConfirmedEntry,
  PickConfirmedEntry,
  TimerWarningPayload,
  TurnStartPayload,
} from '../../lib/socket';
import type { Champion } from '../../lib/types';

/**
 * Ban Phase selection board (T-009), shared by the Blue and Red teams.
 *
 * - The champion pool is filtered through `availableForBan` (banned
 *   champions are always out; picked champions only in Fearless mode,
 *   R-005/R-011 — the server enforces the same rules).
 * - Selection stages a *pending* ban locally; the opponent only sees it
 *   once `ban.confirmed` broadcasts the lock (R-009).
 * - The countdown ticks locally from the `turn.start` payload
 *   (`remainingSeconds` on a mid-turn reconnect, else `timerSeconds`) and
 *   resyncs whenever the server's `timer.warning` fires at 5s / 3s / 1s.
 *   The server auto-locks (or skips) at zero, so the UI only mirrors state.
 */

/** Warning tier colours at 5s / 3s / 1s (R-010). */
const WARNING_AMBER = '#d97706';
const WARNING_ORANGE = '#ea580c';
const WARNING_RED = '#dc2626';
const NEUTRAL = '#111827';

const sectionStyle: CSSProperties = {
  border: '1px solid #d1d5db',
  borderRadius: '0.5rem',
  padding: '1rem',
  marginBottom: '1rem',
  background: '#fff',
};

const gridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(88px, 1fr))',
  gap: '0.5rem',
  marginTop: '0.75rem',
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

/** Colour for the countdown at a given remaining-seconds value. */
function countdownColor(remaining: number): string {
  if (remaining <= 1) return WARNING_RED;
  if (remaining <= 3) return WARNING_ORANGE;
  if (remaining <= 5) return WARNING_AMBER;
  return NEUTRAL;
}

/**
 * Local countdown for the current turn: starts from the last `turn.start`
 * (preferring a mid-turn `remainingSeconds`), ticks down once a second, and
 * snaps to the server's authoritative `timer.warning` values.
 */
function useTurnCountdown(): number | null {
  const currentTurnInfo = useDraftStore((s) => s.currentTurnInfo);
  const timerWarning = useDraftStore((s) => s.timerWarning);
  const [remaining, setRemaining] = useState<number | null>(null);

  // New turn (or reconnect into one) → restart the local countdown.
  useEffect(() => {
    if (!currentTurnInfo) {
      setRemaining(null);
      return;
    }
    setRemaining(
      currentTurnInfo.remainingSeconds ?? currentTurnInfo.timerSeconds,
    );
  }, [currentTurnInfo]);

  // One tick per second for the current turn; restarted only on turn change.
  useEffect(() => {
    if (!currentTurnInfo) {
      return;
    }
    const interval = window.setInterval(() => {
      setRemaining((value) =>
        value === null || value <= 0 ? value : value - 1,
      );
    }, 1000);
    return () => window.clearInterval(interval);
  }, [currentTurnInfo]);

  // Server warnings are authoritative: correct a drifting clock downward
  // (never upward — a late warning must not resurrect time that passed).
  useEffect(() => {
    if (!timerWarning || !currentTurnInfo) {
      return;
    }
    applyWarningIfCurrent(timerWarning, currentTurnInfo, setRemaining);
  }, [timerWarning, currentTurnInfo]);

  return remaining;
}

function applyWarningIfCurrent(
  warning: TimerWarningPayload,
  turn: TurnStartPayload,
  setRemaining: (update: (value: number | null) => number | null) => void,
): void {
  if (warning.turn.turnNumber !== turn.turnNumber) {
    return; // a stale warning from the previous turn
  }
  setRemaining((value) =>
    value === null ? null : Math.min(value, warning.seconds),
  );
}

function ChampionCard({
  champion,
  selected,
  disabled,
  onToggle,
}: {
  champion: Champion;
  selected: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  const cardStyle: CSSProperties = {
    border: selected ? '2px solid #1d4ed8' : '1px solid #d1d5db',
    borderRadius: '0.375rem',
    padding: '0.375rem',
    textAlign: 'center',
    background: selected ? '#eff6ff' : '#fff',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.45 : 1,
    fontSize: '0.75rem',
  };

  return (
    <button
      type="button"
      style={cardStyle}
      disabled={disabled}
      aria-pressed={selected}
      onClick={onToggle}
    >
      <img
        src={champion.iconUrl}
        alt={champion.name}
        width={48}
        height={48}
        style={{ borderRadius: '0.25rem', display: 'block', margin: '0 auto' }}
      />
      <span style={{ display: 'block', marginTop: '0.25rem' }}>
        {champion.name}
      </span>
      {selected && (
        <span style={{ display: 'block', color: '#1d4ed8', fontWeight: 600 }}>
          Selected
        </span>
      )}
    </button>
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
        <div style={gridStyle}>
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
