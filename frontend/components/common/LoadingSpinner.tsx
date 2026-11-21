'use client';

import type { CSSProperties } from 'react';

/**
 * Loading spinner (T-018, task 141).
 *
 * Variants:
 * - `size`: 'sm' | 'md' | 'lg' — controls the spinner diameter.
 * - `overlay`: when true, renders a full-page dimmed backdrop so the
 *   spinner blocks interaction while data loads (champion pool, draft
 *   state, reconnect).
 *
 * Pure CSS animation keeps it dependency-free; inline styles mirror the
 * rest of the frontend.
 */

export type LoadingSpinnerSize = 'sm' | 'md' | 'lg';

const SIZE: Record<LoadingSpinnerSize, { width: string; height: string; borderWidth: string }> = {
  sm: { width: '16px', height: '16px', borderWidth: '2px' },
  md: { width: '28px', height: '28px', borderWidth: '3px' },
  lg: { width: '40px', height: '40px', borderWidth: '4px' },
};

const containerStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const spinnerStyle: CSSProperties = {
  border: 'solid',
  borderColor: 'var(--border)',
  borderTopColor: 'var(--primary)',
  borderRadius: '50%',
  animation: 'spin 0.8s linear infinite',
  boxSizing: 'border-box',
};

const overlayStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 9998,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'rgba(15, 23, 42, 0.45)',
  backdropFilter: 'blur(2px)',
};

const keyframes = `
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
`;

let stylesheetInjected = false;

function ensureStylesheet() {
  if (stylesheetInjected || typeof window === 'undefined') {
    return;
  }
  const style = document.createElement('style');
  style.type = 'text/css';
  style.innerHTML = keyframes;
  document.head.appendChild(style);
  stylesheetInjected = true;
}

interface LoadingSpinnerProps {
  /** Spinner diameter: 'sm' | 'md' | 'lg'. */
  size?: LoadingSpinnerSize;
  /** When true, show a dimmed full-screen backdrop behind the spinner. */
  overlay?: boolean;
  /** Accessible label announced to screen readers. */
  label?: string;
}

export default function LoadingSpinner({
  size = 'md',
  overlay = false,
  label = 'Loading…',
}: LoadingSpinnerProps) {
  ensureStylesheet();

  const dims = SIZE[size];

  const style: CSSProperties = {
    ...spinnerStyle,
    width: dims.width,
    height: dims.height,
    borderWidth: dims.borderWidth,
  };

  if (overlay) {
    return (
      <div style={overlayStyle}>
        <div style={containerStyle}>
          <div style={style} role="status" aria-label={label}>
            <span style={{ position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0, 0, 0, 0)', whiteSpace: 'nowrap', border: 0 }}>
              {label}
            </span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      <div style={style} role="status" aria-label={label}>
        <span style={{ position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0, 0, 0, 0)', whiteSpace: 'nowrap', border: 0 }}>
          {label}
        </span>
      </div>
    </div>
  );
}
