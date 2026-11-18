'use client';

import type { CSSProperties } from 'react';
import type { Champion } from '../../lib/types';

/** Responsive champion grid shared by the ban and pick boards. */
export const championGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(88px, 1fr))',
  gap: '0.5rem',
  marginTop: '0.75rem',
};

export function ChampionCard({
  champion,
  selected,
  disabled,
  accent = '#1d4ed8',
  onToggle,
}: {
  champion: Champion;
  selected: boolean;
  disabled: boolean;
  /** Selection accent colour (team-tinted on the pick board). */
  accent?: string;
  onToggle: () => void;
}) {
  const cardStyle: CSSProperties = {
    border: selected ? `2px solid ${accent}` : '1px solid #d1d5db',
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
        <span style={{ display: 'block', color: accent, fontWeight: 600 }}>
          Selected
        </span>
      )}
    </button>
  );
}
