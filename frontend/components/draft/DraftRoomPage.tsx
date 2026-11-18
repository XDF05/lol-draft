'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import Link from 'next/link';
import { isAxiosError } from 'axios';
import BanPhase from './BanPhase';
import PickPhase from './PickPhase';
import ConnectionIndicator from '../socket/ConnectionIndicator';
import { useAuth } from '../../hooks/useAuth';
import useSocket from '../../hooks/useSocket';
import { useDraftStore } from '../../store/draftStore';
import {
  fetchDraftByCode,
  joinDraftByCode,
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
  border: '1px solid #d1d5db',
  borderRadius: '0.5rem',
  padding: '1rem',
  marginBottom: '1rem',
  background: '#fff',
};

const codeStyle: CSSProperties = {
  fontSize: '2rem',
  letterSpacing: '0.35em',
  fontWeight: 700,
  textAlign: 'center',
  margin: '0.5rem 0',
};

function extractErrorMessage(err: unknown, fallback: string): string {
  if (isAxiosError(err)) {
    const message = err.response?.data?.message;
    if (Array.isArray(message)) return message.join(', ');
    if (typeof message === 'string' && message.length > 0) return message;
  }
  return fallback;
}

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

export default function DraftRoomPage({ code }: { code: string }) {
  const { user, status: authStatus } = useAuth();
  useSocket(); // connects the socket and attaches the event listeners

  const draftId = useDraftStore((s) => s.draftId);
  const draftStatus = useDraftStore((s) => s.draftStatus);
  const myTeam = useDraftStore((s) => s.myTeam);
  const currentTurnInfo = useDraftStore((s) => s.currentTurnInfo);
  const bans = useDraftStore((s) => s.bans);
  const picks = useDraftStore((s) => s.picks);
  const draftExpired = useDraftStore((s) => s.draftExpired);
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
      setLoadError(extractErrorMessage(err, 'Draft not found.'));
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
        setJoinError(extractErrorMessage(err, 'Could not join this draft.'));
      } finally {
        joiningRef.current = false;
        setJoining(false);
      }
    })();
  }, [view, user, isParticipant, status, code, refresh, authStatus]);

  if (loadError) {
    return (
      <main style={{ maxWidth: '26rem', margin: '3rem auto', padding: '1.5rem' }}>
        <h1>Draft room</h1>
        <p style={{ color: '#b91c1c' }}>{loadError}</p>
        <Link href="/draft/new">Create a new draft</Link>
      </main>
    );
  }

  if (!view) {
    return (
      <main style={{ maxWidth: '26rem', margin: '3rem auto', padding: '1.5rem' }}>
        <p>Loading draft…</p>
      </main>
    );
  }

  if (status === 'EXPIRED') {
    return (
      <main style={{ maxWidth: '26rem', margin: '3rem auto', padding: '1.5rem' }}>
        <h1>Draft room</h1>
        <div style={cardStyle}>
          <p style={{ fontWeight: 600 }}>This draft has timed out.</p>
          <p style={{ color: '#4b5563' }}>
            {draftExpired ??
              'A player was disconnected for too long, so the draft expired.'}
          </p>
          <Link href="/draft/new">Start a new draft</Link>
        </div>
      </main>
    );
  }

  if (status === 'COMPLETE') {
    return (
      <main style={{ maxWidth: '26rem', margin: '3rem auto', padding: '1.5rem' }}>
        <h1>Draft room</h1>
        <div style={cardStyle}>
          <p style={{ fontWeight: 600 }}>Draft complete.</p>
          <p style={{ color: '#4b5563' }}>
            Final results will be shown here once saving is implemented.
          </p>
        </div>
      </main>
    );
  }

  if (status === 'WAITING_FOR_PLAYERS') {
    if (!isParticipant) {
      return (
        <main
          style={{ maxWidth: '26rem', margin: '3rem auto', padding: '1.5rem' }}
        >
          <h1>Draft room</h1>
          <div style={cardStyle}>
            {joining ? (
              <p>Joining draft {view.code}…</p>
            ) : joinError ? (
              <>
                <p style={{ color: '#b91c1c' }}>{joinError}</p>
                <button type="button" onClick={() => void refresh()}>
                  Try again
                </button>
              </>
            ) : (
              <p style={{ color: '#b91c1c' }}>
                This draft already has two players.
              </p>
            )}
          </div>
        </main>
      );
    }

    return (
      <main style={{ maxWidth: '26rem', margin: '3rem auto', padding: '1.5rem' }}>
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
        <div style={cardStyle}>
          <p>
            Send this code to your opponent — they open{' '}
            <strong>/draft/{view.code}</strong> and the draft starts
            automatically.
          </p>
          <p style={codeStyle}>{view.code}</p>
          <p style={{ textAlign: 'center' }}>
            <CopyCodeButton code={view.code} />
          </p>
          <p>
            You are on the{' '}
            <strong style={{ color: myTeam === 'RED' ? '#b91c1c' : '#1d4ed8' }}>
              {myTeam ?? (view.bluePlayer?.id === user?.id ? 'BLUE' : 'RED')}
            </strong>{' '}
            side.
          </p>
          <p style={{ color: '#6b7280', fontSize: '0.85rem' }}>
            Unjoined drafts expire after 5 minutes.
          </p>
        </div>
      </main>
    );
  }

  if (status === 'IN_PROGRESS') {
    if (!isParticipant) {
      return (
        <main
          style={{ maxWidth: '26rem', margin: '3rem auto', padding: '1.5rem' }}
        >
          <h1>Draft room</h1>
          <div style={cardStyle}>
            <p>You are not a participant of this draft.</p>
          </div>
        </main>
      );
    }

    return (
      <main style={{ maxWidth: '34rem', margin: '3rem auto', padding: '1.5rem' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '0.75rem',
          }}
        >
          <h1 style={{ margin: 0 }}>Draft {view.code}</h1>
          <ConnectionIndicator />
        </div>
        {lastError && <p style={{ color: '#b91c1c' }}>{lastError}</p>}

        <div style={cardStyle}>
          <strong>Blue:</strong> {view.bluePlayer?.username ?? '—'}
          {myTeam === 'BLUE' ? ' (you)' : ''}
          <br />
          <strong>Red:</strong> {view.redPlayer?.username ?? '—'}
          {myTeam === 'RED' ? ' (you)' : ''}
        </div>

        {/* Selection boards: ban grid + countdown (T-009), pick grid with
            advantage indicators (T-010). */}
        {currentTurnInfo?.phase.startsWith('BANNING') && <BanPhase />}
        {currentTurnInfo?.phase.startsWith('PICKING') && <PickPhase />}

        <div style={cardStyle}>
          {currentTurnInfo ? (
            <>
              <p style={{ margin: 0, fontWeight: 600 }}>
                Turn {currentTurnInfo.turnNumber} —{' '}
                {PHASE_LABELS[currentTurnInfo.phase] ?? currentTurnInfo.phase} (
                {currentTurnInfo.actionType.toLowerCase()})
              </p>
              <p style={{ margin: '0.25rem 0 0' }}>
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

        <div style={cardStyle}>
          <strong>Bans</strong>
          {bans.length === 0 ? (
            <p style={{ margin: '0.25rem 0 0', color: '#6b7280' }}>
              No bans yet.
            </p>
          ) : (
            <ul style={{ margin: '0.25rem 0 0', paddingLeft: '1.25rem' }}>
              {bans.map((ban, index) => (
                <li key={`${ban.championId}-${ban.team}-${index}`}>
                  {ban.championId}{' '}
                  <span style={{ color: ban.team === 'BLUE' ? '#1d4ed8' : '#b91c1c' }}>
                    ({ban.team.toLowerCase()}, P{ban.phase})
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div style={cardStyle}>
          <strong>Picks</strong>
          {picks.length === 0 ? (
            <p style={{ margin: '0.25rem 0 0', color: '#6b7280' }}>
              No picks yet.
            </p>
          ) : (
            <ul style={{ margin: '0.25rem 0 0', paddingLeft: '1.25rem' }}>
              {picks.map((pick, index) => (
                <li key={`${pick.championId}-${pick.team}-${index}`}>
                  {pick.championId}{' '}
                  <span style={{ color: pick.team === 'BLUE' ? '#1d4ed8' : '#b91c1c' }}>
                    ({pick.team.toLowerCase()})
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>
    );
  }

  // Unknown status — show what we know.
  return (
    <main style={{ maxWidth: '26rem', margin: '3rem auto', padding: '1.5rem' }}>
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
