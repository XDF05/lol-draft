'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import Link from 'next/link';
import { extractDraftError } from '../../lib/errors';
import { ErrorBoundary } from '../../components/common/ErrorBoundary';
import FearlessToggle, { FearlessBanner } from './FearlessToggle';
import DraftBoard from './DraftBoard';
import ConnectionIndicator from '../socket/ConnectionIndicator';
import DraftProgressBar from './DraftProgressBar';
import { useAuth } from '../../hooks/useAuth';
import { useChampionData } from '../../hooks/useChampionData';
import useSocket from '../../hooks/useSocket';
import { useDraftStore } from '../../store/draftStore';
import type { PickConfirmedEntry, Team } from '../../lib/socket';
import {
  buildSpectatorUrl,
  fetchDraftByCode,
  joinDraftByCode,
  spectatorPath,
  type DraftSide,
  type DraftView,
} from '../../lib/draft-api';

/**
 * Draft room page (T-008).
 *
 * - The creator lands here after creating a draft and sees the code with a
 *   "Waiting for opponent" message (polling keeps it fresh even if the
 *   socket broadcast is missed).
 * - An invited player opening the link claims the remaining free side
 *   automatically (first-come first-served, R-002) and the draft starts.
 * - Once in progress, a live summary (turn, bans, picks) is rendered from
 *   the socket-fed draft store; the full strategy board arrives later.
 * - An expired draft (R-013 reconnection grace period elapsed) explains why.
 */

const POLL_INTERVAL_MS = 4000;

const cardStyle: CSSProperties = {
  border: '1px solid var(--border)',
  borderRadius: '0.8rem',
  padding: '1rem',
  marginBottom: '1rem',
  background: 'var(--surface)',
};

function freeSideOf(view: DraftView): DraftSide | null {
  if (view.bluePlayer === null) return 'BLUE';
  if (view.redPlayer === null) return 'RED';
  return null;
}

const PHASE_LABELS: Record<string, string> = {
  BANNING_P1: 'Ban Phase 1',
  PICKING_P1: 'Pick Phase 1',
  BANNING_P2: 'Ban Phase 2',
  PICKING_P2: 'Pick Phase 2',
  FINALIZATION: 'Finalization',
};

function CopyCodeButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable (permissions) — the code is on screen anyway.
    }
  }

  return <button type="button" onClick={copy}>{copied ? 'Copied!' : 'Copy code'}</button>;
}

/** Shareable read-only link for the public spectator view (T-015). */
function CopySpectatorLinkButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(buildSpectatorUrl(code));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable — the link is on screen anyway.
    }
  }

  return (
    <button type="button" onClick={copy}>
      {copied ? 'Copied!' : 'Copy spectator link'}
    </button>
  );
}

/** Shown while the socket session for this room is still being established. */
function JoiningDraft({ onRetry }: { onRetry: () => void }) {
  return (
    <main className="page-shell narrow">
      <h1>Draft room</h1>
      <div style={cardStyle}>
        <p>Joining draft…</p>
        <button type="button" onClick={onRetry}>
          Retry
        </button>
      </div>
    </main>
  );
}

/** Final pick order shown once Finalization locks the draft (T-014). */
function DraftResults({
  picks,
  completedAt,
}: {
  picks: PickConfirmedEntry[];
  completedAt: string | null;
}) {
  const { champions } = useChampionData();
  const names = new Map(champions.map((champion) => [champion.id, champion.name]));
  const columns: Array<{ team: Team; label: string; color: string }> = [
    { team: 'BLUE', label: 'Blue', color: '#1d4ed8' },
    { team: 'RED', label: 'Red', color: '#b91c1c' },
  ];

  return (
    <div style={cardStyle}>
      <p style={{ fontWeight: 600, marginTop: 0 }}>Final picks</p>
      {completedAt && (
        <p className="muted" style={{ fontSize: '0.85rem' }}>
          Completed {new Date(completedAt).toLocaleString()}
        </p>
      )}
      {picks.length === 0 ? (
        <p className="muted">Syncing final results…</p>
      ) : (
        <div style={{ display: 'flex', gap: '1.5rem' }}>
          {columns.map(({ team, label, color }) => {
            const teamPicks = picks.filter((pick) => pick.team === team);
            return (
              <div key={team} style={{ flex: 1 }}>
                <strong style={{ color }}>{label}</strong>
                <ol style={{ margin: '0.35rem 0 0', paddingLeft: '1.25rem' }}>
                  {teamPicks.map((pick) => (
                    <li key={pick.id}>
                      {names.get(pick.championId) ?? pick.championId}
                    </li>
                  ))}
                </ol>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function DraftRoomPage({ code }: { code: string }) {
  const { user, status: authStatus } = useAuth();
  useSocket(); // connects the socket and attaches the event listeners

  const draftId = useDraftStore((s) => s.draftId);
  const draftStatus = useDraftStore((s) => s.draftStatus);
  const myTeam = useDraftStore((s) => s.myTeam);
  const storeFearlessMode = useDraftStore((s) => s.fearlessMode);
  const currentTurnInfo = useDraftStore((s) => s.currentTurnInfo);
  const picks = useDraftStore((s) => s.picks);
  const draftExpired = useDraftStore((s) => s.draftExpired);
  const completedAt = useDraftStore((s) => s.completedAt);
  const lastError = useDraftStore((s) => s.lastError);
  const socketJoinDraft = useDraftStore((s) => s.joinDraft);

  const [view, setView] = useState<DraftView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);

  // Guards the auto-join effect against re-entry across poll refreshes.
  const joiningRef = useRef(false);
  const refresh = useCallback(async () => {
    try {
      const next = await fetchDraftByCode(code);
      setView(next);
      setLoadError(null);
    } catch (err) {
      setView(null);
      setLoadError(extractDraftError(err).message);
    }
  }, [code]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Participant arrival tracking: poll while the draft is still waiting, as
  // a fallback for the draft.update broadcast.
  const status = draftId === view?.id && draftStatus ? draftStatus : view?.status;
  useEffect(() => {
    if (!view || status !== 'WAITING_FOR_PLAYERS') {
      return;
    }
    const interval = window.setInterval(() => {
      void refresh();
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [view, status, refresh]);

  const isParticipant = Boolean(
    view &&
      user &&
      (view.bluePlayer?.id === user.id || view.redPlayer?.id === user.id),
  );

  // Socket join for participants (creator right after redirect, opponent
  // right after the HTTP join). Retries on later polls until it succeeds.
  useEffect(() => {
    if (!view || !isParticipant || authStatus !== 'authenticated') {
      return;
    }
    if (draftId === view.id) {
      return; // already in the room
    }
    void socketJoinDraft(code);
  }, [view, isParticipant, draftId, code, authStatus, socketJoinDraft]);

  // An invited player takes the remaining free side automatically.
  useEffect(() => {
    if (!view || !user || authStatus !== 'authenticated') {
      return;
    }
    if (isParticipant || joiningRef.current) {
      return;
    }
    if (status !== 'WAITING_FOR_PLAYERS' || freeSideOf(view) === null) {
      return;
    }

    joiningRef.current = true;
    setJoining(true);
    void (async () => {
      try {
        await joinDraftByCode(code);
        await refresh();
      } catch (err) {
        setJoinError(extractDraftError(err).message);
      } finally {
        joiningRef.current = false;
        setJoining(false);
      }
    })();
  }, [view, user, isParticipant, status, code, refresh, authStatus]);

  if (loadError) {
    return (
      <main className="page-shell narrow">
        <h1>Draft room</h1>
        <p className="error-text">{loadError}</p>
        <Link href="/draft/new">Create a new draft</Link>
      </main>
    );
  }

  if (!view) {
    return (
      <main className="page-shell narrow">
        <p>Loading draft…</p>
      </main>
    );
  }

  // The HTTP view is updated by the toggling client; the socket-fed store
  // keeps the opponent's screen in sync via draft.update broadcasts.
  const synced = draftId === view.id;
  const retryJoin = () => void socketJoinDraft(code);
  const fearlessActive = view.fearlessMode || (synced && storeFearlessMode);

  if (status === 'EXPIRED') {
    return (
      <main className="page-shell narrow">
        <h1>Draft room</h1>
        <div style={cardStyle}>
          <p style={{ fontWeight: 600, marginTop: 0 }}>
            This draft has expired.
          </p>
          <p className="muted">
            {(synced ? draftExpired : null) ??
              'A player was disconnected for too long, so the draft expired.'}
          </p>
          <p style={{ marginTop: '1rem' }}>
            <Link href="/draft/new" className="primary-button">
              Create a new draft
            </Link>
          </p>
        </div>
      </main>
    );
  }

  if (status === 'COMPLETE') {
    // Participants wait for this room's snapshot before showing results, so a
    // previously completed draft's picks can never leak into the new room.
    if (isParticipant && !synced) {
      return <JoiningDraft onRetry={retryJoin} />;
    }
    return (
      <main className="page-shell narrow">
        <h1>Draft room</h1>
        <div style={cardStyle}>
          <p style={{ fontWeight: 600, margin: 0 }}>Draft complete.</p>
          <p className="muted">
            The Finalization timer expired and the final pick order is locked.
          </p>
        </div>
        <DraftResults picks={picks} completedAt={completedAt} />
        <Link href="/draft/new">Start a new draft</Link>
      </main>
    );
  }

  if (status === 'WAITING_FOR_PLAYERS') {
    if (!isParticipant) {
      return (
        <main className="page-shell narrow">
          <h1>Draft room</h1>
          {fearlessActive && <FearlessBanner />}
          <div style={cardStyle}>
            {joining ? (
              <p>Joining draft {view.code}…</p>
            ) : joinError ? (
              <>
                <p className="error-text">{joinError}</p>
                <button type="button" onClick={() => void refresh()}>
                  Try again
                </button>
              </>
            ) : (
              <p className="error-text">
                This draft already has two players.
              </p>
            )}
          </div>
        </main>
      );
    }

    return (
      <main className="page-shell narrow">
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '0.75rem',
          }}
        >
          <h1 style={{ margin: 0 }}>Waiting for opponent</h1>
          <ConnectionIndicator />
        </div>
        {fearlessActive && <FearlessBanner />}
        <FearlessToggle
          code={view.code}
          enabled={fearlessActive}
          onChanged={setView}
        />
        <div style={cardStyle}>
          <p>
            Send this code to your opponent — they open{' '}
            <strong>/draft/{view.code}</strong> and the draft starts
            automatically.
          </p>
          <p className="code-display">{view.code}</p>
          <p style={{ textAlign: 'center' }}>
            <CopyCodeButton code={view.code} />
          </p>
          <p style={{ textAlign: 'center', marginBottom: '0.25rem' }}>
            Spectators can watch at{' '}
            <Link href={spectatorPath(view.code)}>
              {spectatorPath(view.code)}
            </Link>
          </p>
          <p style={{ textAlign: 'center' }}>
            <CopySpectatorLinkButton code={view.code} />
          </p>
          <p>
            You are on the{' '}
            <strong style={{ color: myTeam === 'RED' ? '#b91c1c' : '#1d4ed8' }}>
              {myTeam ?? (view.bluePlayer?.id === user?.id ? 'BLUE' : 'RED')}
            </strong>{' '}
            side.
          </p>
          <p className="muted" style={{ fontSize: '0.85rem' }}>
            Unjoined drafts expire after 5 minutes.
          </p>
        </div>
      </main>
    );
  }

  if (status === 'IN_PROGRESS') {
    if (!isParticipant) {
      return (
        <main className="page-shell narrow">
          <h1>Draft room</h1>
          <div style={cardStyle}>
            <p>You are not a participant of this draft.</p>
          </div>
        </main>
      );
    }

    // Never render the live board from another room's store state.
    if (!synced) {
      return <JoiningDraft onRetry={retryJoin} />;
    }

    return (
      <ErrorBoundary>
        <main className="page-shell draft-page">
          <header className="draft-page-header">
            <div>
              <h1>Draft {view.code}</h1>
              <p>Live 1v1 champion draft</p>
            </div>
            <ConnectionIndicator />
          </header>

          <DraftProgressBar />
          {lastError && <p className="error-text">{lastError}</p>}
          {fearlessActive && <FearlessBanner />}

          <div className="draft-player-strip">
            <span className="blue">
              <strong>Blue:</strong> {view.bluePlayer?.username ?? '—'}
              {myTeam === 'BLUE' ? ' (you)' : ''}
            </span>
            <span className="red">
              <strong>Red:</strong> {view.redPlayer?.username ?? '—'}
              {myTeam === 'RED' ? ' (you)' : ''}
            </span>
            <span>
              Spectator link:{' '}
              <Link href={spectatorPath(view.code)}>
                {spectatorPath(view.code)}
              </Link>
            </span>
          </div>

          <DraftBoard
            bluePlayer={view.bluePlayer?.username}
            redPlayer={view.redPlayer?.username}
            myTeam={myTeam}
          />

          <div className="surface-card draft-turn-summary">
            {currentTurnInfo ? (
              <>
                <p style={{ margin: 0, fontWeight: 700 }}>
                  Turn {currentTurnInfo.turnNumber} —{' '}
                  {PHASE_LABELS[currentTurnInfo.phase] ?? currentTurnInfo.phase} (
                  {currentTurnInfo.actionType.toLowerCase()})
                </p>
                <p className="muted">
                  {currentTurnInfo.expectedTeam
                    ? currentTurnInfo.expectedTeam === myTeam
                      ? 'Your turn.'
                      : `Waiting for ${currentTurnInfo.expectedTeam.toLowerCase()}…`
                    : 'Finalization grace period.'}
                </p>
              </>
            ) : (
              <p>Syncing draft state…</p>
            )}
          </div>
        </main>
      </ErrorBoundary>
    );
  }

  // Unknown status — show what we know.
  return (
    <main className="page-shell narrow">
      <h1>Draft room</h1>
      <div style={cardStyle}>
        <p>
          Draft <strong>{view.code}</strong> is in state{' '}
          <strong>{status}</strong>.
        </p>
      </div>
    </main>
  );
}
