'use client';

import type { CSSProperties } from 'react';
import type { Champion } from '../../lib/types';

export type ChampionCardStatus = 'available' | 'picked' | 'banned';

/** Responsive champion grid shared by the ban and pick boards. */
export function championGridStyle(isMobile = false): CSSProperties {
  return {
    display: 'grid',
    gridTemplateColumns: isMobile
      ? 'repeat(auto-fill, minmax(72px, 1fr))'
      : 'repeat(auto-fill, minmax(88px, 1fr))',
    gap: isMobile ? '0.375rem' : '0.5rem',
    marginTop: isMobile ? '0.5rem' : '0.75rem',
  };
}

export function ChampionCard({
  champion,
  selected,
  disabled,
  status = 'available',
  accent = '#2563eb',
  onToggle,
  loading = false,
}: {
  champion: Champion;
  selected: boolean;
  disabled: boolean;
  /** Champion availability state for styling (greyed / crossed out). */
  status?: ChampionCardStatus;
  /** Selection accent colour (team-tinted on the pick board). */
  accent?: string;
  onToggle: () => void;
  /** When true, render a skeleton placeholder instead of the card content. */
  loading?: boolean;
}) {
  const isUnavailable = status === 'picked' || status === 'banned';
  const cardDisabled = disabled || isUnavailable;
  const cardStyle = { '--accent': accent } as CSSProperties;
  const cardClasses = [
    'champion-card',
    selected ? 'selected' : '',
    isUnavailable ? 'unavailable' : '',
    status,
  ]
    .filter(Boolean)
    .join(' ');

  if (loading) {
    return (
      <button
        type="button"
        className={cardClasses}
        style={cardStyle}
        disabled
        aria-busy="true"
        aria-label="Loading champion"
      >
        <span className="champion-portrait champion-skeleton" />
        <span className="champion-name champion-skeleton champion-skeleton-name" />
      </button>
    );
  }

  const statusLabel =
    status === 'banned' ? 'Banned' : status === 'picked' ? 'Picked' : null;

  return (
    <button
      type="button"
      className={cardClasses}
      style={cardStyle}
      disabled={cardDisabled}
      aria-pressed={selected}
      aria-disabled={cardDisabled}
      aria-label={`${champion.name}${statusLabel ? `, ${statusLabel}` : ''}`}
      title={champion.name}
      onClick={onToggle}
    >
      <span className="champion-portrait">
        <img src={champion.iconUrl} alt="" width={96} height={96} />
      </span>
      <span className="champion-name">{champion.name}</span>
      {selected && <span className="champion-status">Selected</span>}
      {statusLabel && <span className="champion-status">{statusLabel}</span>}
    </button>
  );
}
