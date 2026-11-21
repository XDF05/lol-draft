'use client';

import { useMemo, useState } from 'react';
import type { ChampionPoolStatus } from '../../store/championStore';
import type { Champion } from '../../lib/types';
import { ChampionCard, type ChampionCardStatus } from './ChampionCard';

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-4-4" />
    </svg>
  );
}

interface ChampionPoolProps {
  champions: Champion[];
  status: ChampionPoolStatus;
  error: string | null;
  statusById: ReadonlyMap<string, ChampionCardStatus>;
  selectedId: string | null;
  disabled: boolean;
  accent: string;
  onToggle: (championId: string) => void;
}

/**
 * Searchable champion pool used by both ban and pick phases.
 *
 * The pool intentionally has no role filter: all champions remain available
 * in the same grid and can be found quickly by name.
 */
export default function ChampionPool({
  champions,
  status,
  error,
  statusById,
  selectedId,
  disabled,
  accent,
  onToggle,
}: ChampionPoolProps) {
  const [query, setQuery] = useState('');

  const visibleChampions = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    if (!normalizedQuery) {
      return champions;
    }
    return champions.filter((champion) =>
      champion.name.toLocaleLowerCase().includes(normalizedQuery),
    );
  }, [champions, query]);

  if (status === 'error') {
    return (
      <div className="champion-pool">
        <p className="champion-pool-message error-text">
          {error ?? 'Could not load the champion pool.'}
        </p>
      </div>
    );
  }

  if (status !== 'ready') {
    return (
      <div className="champion-pool">
        <p className="champion-pool-message">Loading champion pool…</p>
      </div>
    );
  }

  return (
    <div className="champion-pool">
      <div className="champion-pool-toolbar">
        <label className="champion-search">
          <SearchIcon />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search champions"
            aria-label="Search champions"
          />
        </label>
        <span className="champion-count" aria-live="polite">
          {visibleChampions.length} champion{visibleChampions.length === 1 ? '' : 's'}
        </span>
      </div>

      <div className="champion-pool-grid">
        {visibleChampions.length === 0 ? (
          <p className="champion-empty">No champions match “{query.trim()}”.</p>
        ) : (
          visibleChampions.map((champion) => (
            <ChampionCard
              key={champion.id}
              champion={champion}
              status={statusById.get(champion.id) ?? 'available'}
              selected={selectedId === champion.id}
              disabled={disabled}
              accent={accent}
              onToggle={() => onToggle(champion.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}
