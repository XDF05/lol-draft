'use client';

import type { CSSProperties } from 'react';
import { useIsMobile } from '../../lib/useMediaQuery';
import type { Champion } from '../../lib/types';

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

const skeletonKeyframes = `
  @keyframes skeletonShimmer {
    0% { background-position: -200% 0; }
    100% { background-position: 200% 0; }
  }
`;

let skeletonStylesheetInjected = false;

function ensureSkeletonStylesheet() {
  if (skeletonStylesheetInjected || typeof window === 'undefined') {
    return;
  }
  const style = document.createElement('style');
  style.type = 'text/css';
  style.innerHTML = skeletonKeyframes;
  document.head.appendChild(style);
  skeletonStylesheetInjected = true;
}

export function ChampionCard({
  champion,
  selected,
  disabled,
  accent = '#1d4ed8',
  onToggle,
  loading = false,
}: {
  champion: Champion;
  selected: boolean;
  disabled: boolean;
  /** Selection accent colour (team-tinted on the pick board). */
  accent?: string;
  onToggle: () => void;
  /** When true, render a skeleton placeholder instead of the card content. */
  loading?: boolean;
}) {
  const isMobile = useIsMobile();
  const cardStyle: CSSProperties = {
    border: selected ? `2px solid ${accent}` : '1px solid #d1d5db',
    borderRadius: '0.375rem',
    padding: isMobile ? '0.25rem' : '0.375rem',
    textAlign: 'center',
    background: selected ? '#eff6ff' : '#fff',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.45 : 1,
    fontSize: isMobile ? '0.6875rem' : '0.75rem',
  };

  if (loading) {
    ensureSkeletonStylesheet();
    const iconSize = isMobile ? 36 : 48;
    return (
      <button
        type="button"
        style={{ ...cardStyle, pointerEvents: 'none' }}
        disabled
        aria-busy="true"
      >
        <div
          style={{
            width: iconSize,
            height: iconSize,
            borderRadius: '0.25rem',
            background: '#e2e8f0',
            margin: '0 auto',
            animation: 'skeletonShimmer 1.4s ease-in-out infinite',
          }}
        />
        <div
          style={{
            marginTop: '0.25rem',
            height: '0.75rem',
            width: '60%',
            borderRadius: '0.25rem',
            background: '#e2e8f0',
            margin: '0.25rem auto 0',
            animation: 'skeletonShimmer 1.4s ease-in-out infinite',
          }}
        />
      </button>
    );
  }

  const iconSize = isMobile ? 36 : 48;

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
        width={iconSize}
        height={iconSize}
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
