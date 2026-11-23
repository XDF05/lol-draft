'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import { extractDraftError } from '../../lib/errors';
import ConnectionIndicator from '../socket/ConnectionIndicator';
import { useChampionData } from '../../hooks/useChampionData';
import {
  SPECTATOR_RECONNECT_GRACE_SECONDS,
  useSpectatorSocket,
} from '../../hooks/useSpectatorSocket';
import {
  fetchPublicDraftByCode,
  type PublicDraftView,
} from '../../lib/draft-api';
import type {
  BanConfirmedEntry,
  PickConfirmedEntry,
  Team,
} from '../../lib/socket';
import TimerDisplay from './TimerDisplay';

/**
 * Public spectator page (T-015).
 *
 * Read-only view of a draft, reached via the shared `/d/:code` link. No
 * account is required: the page uses the anonymous spectator socket and the
 * unauthenticated public snapshot endpoint. Bans, picks, phase, countdown
 * and the final results update live; the viewer's own connection gets a 30s
 * reconnection grace window before the page reports that the session ended.
 */

const mainStyle: CSSProperties = {
  maxWidth: '64rem',
  margin: '0 auto',
  padding: '2rem 1rem 3rem',
};

const cardStyle: CSSProperties = {
  border: '1px solid var(--border)',
  borderRadius: '0.8rem',
  padding: '1rem',
  marginBottom: '1rem',
  background: 'var(--surface)',
};

const PHASE_LABELS: Record<string, string> = {
  BANNING_P1: 'Ban Phase 1',
  PICKING_P1: 'Pick Phase 1',
  BANNING_P2: 'Ban Phase 2',
  PICKING_P2: 'Pick Phase 2',
  FINALIZATION: 'Finalization',
};

function championName(championId: string, names: Map<string, string>): string {
  return names.get(championId) ?? championId;
}

function TeamPicks({
  team,
  picks,
  names,
}: {
  team: Team;
  picks: PickConfirmedEntry[];
  names: Map<string, string>;
}) {
  const teamPicks = picks.filter((pick) => pick.team === team);
  return (
    <div style={{ flex: 1, minWidth: '10rem' }}>
      <strong style={{ color: team === 'BLUE' ? '#1d4ed8' : '#b91c1c' }}>
        {team === 'BLUE' ? 'Blue' : 'Red'}
      </strong>
      <ol style={{ margin: '0.35rem 0 0', paddingLeft: '1.25rem' }}>
        {Array.from({ length: 5 }, (_, index) => {
          const pick = teamPicks[index];
          return (
            <li
              key={pick?.id ?? `${team}-${index}`}
              style={{ minHeight: '1.4rem' }}
            >
              {pick ? (
                championName(pick.championId, names)
              ) : (
                <span style={{ color: 'var(--text-muted)' }}>—</span>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function BansList({
  bans,
  names,
}: {
  bans: BanConfirmedEntry[];
  names: Map<string, string>;
}) {
  if (bans.length === 0) {
    return (
      <p style={{ margin: '0.25rem 0 0', color: 'var(--text-muted)' }}>
        No bans yet.
      </p>
    );
  }
  return (
    <ul style={{ margin: '0.25rem 0 0', paddingLeft: '1.25rem' }}>
      {bans.map((ban, index) => (
        <li key={`${ban.championId}-${ban.team}-${index}`}>
          {championName(ban.championId, names)}{' '}
          <span style={{ color: ban.team === 'BLUE' ? '#1d4ed8' : '#b91c1c' }}>
            ({ban.team.toLowerCase()}, P{ban.phase})
          </span>
        </li>
      ))}
    </ul>
  );
}

export default function SpectatorView({ code }: { code: string }) {
  const { champions } = useChampionData();
  const names = new Map(
    champions.map((champion) => [champion.id, champion.name]),
  );

  const [snapshot, setSnapshot] = useState<PublicDraftView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const live = useSpectatorSocket(code);

  useEffect(() => {
    let cancelled = false;
    setSnapshot(null);
    setLoadError(null);
    void fetchPublicDraftByCode(code)
      .then((view) => {
        if (!cancelled) {
          setSnapshot(view);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setLoadError(extractDraftError(err).message);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [code]);

  const status = live.status ?? snapshot?.status ?? null;
  const bans = live.bans ?? snapshot?.bans ?? [];
  const picks = live.picks ?? snapshot?.picks ?? [];
  const turn = live.currentTurnInfo ?? snapshot?.turn ?? null;
  const completedAt = live.completedAt ?? snapshot?.completedAt ?? null;

  const header = (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: '1rem',
        marginBottom: '0.75rem',
      }}
    >
      <div>
        <h1 style={{ margin: 0 }}>Draft {code}</h1>
        <p className="muted" style={{ margin: '0.25rem 0 0' }}>
          Spectator view — read-only
        </p>
      </div>
      <ConnectionIndicator
        connectionState={live.connectionState}
        latencyMs={null}
      />
    </div>
  );

  if (live.sessionExpired) {
    return (
      <main style={mainStyle}>
        {header}
        <div style={cardStyle}>
          <p style={{ fontWeight: 600, marginTop: 0 }}>
            Spectator connection ended.
          </p>
          <p className="muted">
            {live.error ??
              `The viewer stayed offline for more than ${SPECTATOR_RECONNECT_GRACE_SECONDS} seconds.`}
          </p>
          <button type="button" onClick={live.retry}>
            Reconnect
          </button>
        </div>
        <Link href="/">Back to home</Link>
      </main>
    );
  }

  if (!status && (loadError || live.error)) {
    return (
      <main style={mainStyle}>
        {header}
        <div style={cardStyle}>
          <p className="error-text" style={{ marginTop: 0 }}>
            {loadError ?? live.error}
          </p>
          <button type="button" onClick={live.retry}>
            Try again
          </button>
        </div>
        <Link href="/">Back to home</Link>
      </main>
    );
  }

  if (!status) {
    return (
      <main style={mainStyle}>
        {header}
        <p>Loading draft…</p>
      </main>
    );
  }

  if (status === 'EXPIRED') {
    return (
      <main style={mainStyle}>
        {header}
        <div style={cardStyle}>
          <p style={{ fontWeight: 600, marginTop: 0 }}>
            This draft has expired.
          </p>
          <p className="muted">
            {live.draftExpired ??
              'A player was disconnected for too long, so the draft expired.'}
          </p>
        </div>
        <Link href="/">Back to home</Link>
      </main>
    );
  }

  if (status === 'COMPLETE') {
    return (
      <main style={mainStyle}>
        {header}
        <div style={cardStyle}>
          <p style={{ fontWeight: 600, margin: 0 }}>Draft Complete</p>
          <p className="muted" style={{ marginBottom: 0 }}>
            The final pick order is locked.
          </p>
          {completedAt && (
            <p
              className="muted"
              style={{ fontSize: '0.85rem', marginBottom: 0 }}
            >
              Completed {new Date(completedAt).toLocaleString()}
            </p>
          )}
        </div>
        <div style={cardStyle}>
          <strong>Final picks</strong>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '1.5rem',
              marginTop: '0.5rem',
            }}
          >
            <TeamPicks team="BLUE" picks={picks} names={names} />
            <TeamPicks team="RED" picks={picks} names={names} />
          </div>
        </div>
        <div style={cardStyle}>
          <strong>Bans</strong>
          <BansList bans={bans} names={names} />
        </div>
        <Link href="/">Back to home</Link>
      </main>
    );
  }

  if (status === 'WAITING_FOR_PLAYERS') {
    return (
      <main style={mainStyle}>
        {header}
        <div style={cardStyle}>
          <p style={{ fontWeight: 600, marginTop: 0 }}>Waiting for players…</p>
          <p style={{ margin: '0.25rem 0' }}>
            <strong>Blue:</strong> {snapshot?.bluePlayer?.username ?? '—'}
          </p>
          <p style={{ margin: '0.25rem 0' }}>
            <strong>Red:</strong> {snapshot?.redPlayer?.username ?? '—'}
          </p>
          <p className="muted" style={{ fontSize: '0.85rem', marginBottom: 0 }}>
            The draft starts automatically when both sides are filled.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main style={mainStyle}>
      {header}

      {live.graceSeconds !== null && (
        <div
          style={{
            ...cardStyle,
            borderColor: 'var(--warning)',
            color: 'var(--warning)',
          }}
        >
          Connection lost — reconnecting… {live.graceSeconds}s of{' '}
          {SPECTATOR_RECONNECT_GRACE_SECONDS}s grace left.
        </div>
      )}

      <div style={cardStyle}>
        <p style={{ margin: '0.25rem 0' }}>
          <strong>Blue:</strong> {snapshot?.bluePlayer?.username ?? '—'}
        </p>
        <p style={{ margin: '0.25rem 0' }}>
          <strong>Red:</strong> {snapshot?.redPlayer?.username ?? '—'}
        </p>
      </div>

      <div style={cardStyle}>
        {turn ? (
          <>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'baseline',
                gap: '1rem',
              }}
            >
              <strong>
                Turn {turn.turnNumber} —{' '}
                {PHASE_LABELS[turn.phase] ?? turn.phase}
              </strong>
              <TimerDisplay />
            </div>
            <p style={{ margin: '0.25rem 0 0' }}>
              {turn.expectedTeam
                ? `${turn.expectedTeam === 'BLUE' ? 'Blue' : 'Red'} is choosing…`
                : 'Finalization — teams may swap picks.'}
            </p>
          </>
        ) : (
          <p style={{ margin: 0 }}>Syncing draft state…</p>
        )}
      </div>

      <div style={cardStyle}>
        <strong>Bans</strong>
        <BansList bans={bans} names={names} />
      </div>

      <div style={cardStyle}>
        <strong>Picks</strong>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '1.5rem',
            marginTop: '0.5rem',
          }}
        >
          <TeamPicks team="BLUE" picks={picks} names={names} />
          <TeamPicks team="RED" picks={picks} names={names} />
        </div>
      </div>
    </main>
  );
}
