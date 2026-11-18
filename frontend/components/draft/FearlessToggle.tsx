'use client';

import { useState, type CSSProperties } from 'react';
import { isAxiosError } from 'axios';
import { setFearlessMode, type DraftView } from '../../lib/draft-api';

/**
 * Fearless Drafting mode toggle (T-013).
 *
 * Only offered while the draft is WAITING_FOR_PLAYERS. Enabling it opens a
 * confirmation modal that spells out the permanent lock consequences —
 * picked champions stay locked for the rest of the draft (and can never be
 * banned or picked again). The server rejects changes after the draft starts.
 */

const sectionStyle: CSSProperties = {
  border: '1px solid #d1d5db',
  borderRadius: '0.5rem',
  padding: '1rem',
  marginBottom: '1rem',
  background: '#fff',
};

const overlayStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(17, 24, 39, 0.55)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '1rem',
  zIndex: 50,
};

const modalStyle: CSSProperties = {
  background: '#fff',
  borderRadius: '0.5rem',
  padding: '1.25rem',
  maxWidth: '28rem',
  width: '100%',
  boxShadow: '0 20px 45px rgba(0, 0, 0, 0.25)',
};

const warningStyle: CSSProperties = {
  padding: '0.75rem',
  borderRadius: '0.375rem',
  background: '#fef2f2',
  color: '#991b1b',
};

function extractErrorMessage(err: unknown, fallback: string): string {
  if (isAxiosError(err)) {
    const message = err.response?.data?.message;
    if (Array.isArray(message)) return message.join(', ');
    if (typeof message === 'string' && message.length > 0) return message;
  }
  return fallback;
}

/** Persistent "FEARLESS MODE ACTIVE" banner shown throughout the draft. */
export function FearlessBanner() {
  return (
    <div
      role="status"
      style={{
        padding: '0.6rem 0.75rem',
        marginBottom: '1rem',
        borderRadius: '0.375rem',
        background: '#7f1d1d',
        color: '#fff',
        fontWeight: 700,
        letterSpacing: '0.04em',
        textAlign: 'center',
      }}
    >
      FEARLESS MODE ACTIVE — picks are locked for the rest of the draft.
    </div>
  );
}

interface FearlessToggleProps {
  code: string;
  enabled: boolean;
  /** Receives the updated draft view after a successful toggle. */
  onChanged: (view: DraftView) => void;
}

export default function FearlessToggle({
  code,
  enabled,
  onChanged,
}: FearlessToggleProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nextValue = !enabled;

  async function handleConfirm() {
    if (saving) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const view = await setFearlessMode(code, nextValue);
      onChanged(view);
      setConfirmOpen(false);
    } catch (err) {
      setError(
        extractErrorMessage(err, 'Could not change Fearless Mode. Try again.'),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={sectionStyle}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '1rem',
        }}
      >
        <strong>Fearless Mode</strong>
        <span
          style={{
            padding: '0.15rem 0.55rem',
            borderRadius: '999px',
            fontSize: '0.8rem',
            fontWeight: 700,
            background: enabled ? '#7f1d1d' : '#e5e7eb',
            color: enabled ? '#fff' : '#374151',
          }}
        >
          {enabled ? 'ON' : 'OFF'}
        </span>
      </div>
      <p style={{ margin: '0.5rem 0 0', color: '#4b5563', fontSize: '0.9rem' }}>
        When enabled, every champion picked in this draft is locked permanently:
        neither player may pick or ban it again. This can only be changed before
        the draft starts.
      </p>
      <button
        type="button"
        style={{ marginTop: '0.75rem' }}
        disabled={saving}
        onClick={() => {
          setError(null);
          setConfirmOpen(true);
        }}
      >
        {enabled ? 'Turn off Fearless Mode' : 'Enable Fearless Mode'}
      </button>
      {error && !confirmOpen && (
        <p style={{ margin: '0.5rem 0 0', color: '#b91c1c' }}>{error}</p>
      )}

      {confirmOpen && (
        <div style={overlayStyle}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="fearless-modal-title"
            style={modalStyle}
          >
            <h2 id="fearless-modal-title" style={{ marginTop: 0 }}>
              {nextValue ? 'Enable Fearless Mode?' : 'Turn off Fearless Mode?'}
            </h2>

            {nextValue ? (
              <>
                <p style={{ marginTop: 0 }}>
                  Fearless Drafting changes the strategic rules for the whole
                  draft:
                </p>
                <ul style={{ margin: '0 0 0.75rem', paddingLeft: '1.25rem' }}>
                  <li>Every pick is locked permanently.</li>
                  <li>
                    A picked champion can never be banned or picked again — not
                    even in a later ban phase.
                  </li>
                  <li>
                    Both players will see a FEARLESS MODE ACTIVE banner for the
                    rest of the draft.
                  </li>
                </ul>
                <p style={warningStyle}>
                  <strong>Warning:</strong> once the draft starts, Fearless Mode
                  cannot be turned off.
                </p>
              </>
            ) : (
              <p style={{ marginTop: 0 }}>
                Fearless Mode will be off when this draft starts. The permanent
                pick lock will not apply.
              </p>
            )}

            {error && (
              <p style={{ margin: '0.75rem 0 0', color: '#b91c1c' }}>{error}</p>
            )}

            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                gap: '0.5rem',
                marginTop: '1rem',
              }}
            >
              <button
                type="button"
                disabled={saving}
                onClick={() => setConfirmOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void handleConfirm()}
              >
                {saving
                  ? 'Saving…'
                  : nextValue
                    ? 'Yes, enable Fearless Mode'
                    : 'Yes, turn it off'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
