'use client';

import { useState } from 'react';
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
    <div role="status" className="fearless-banner">
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
    <div className="fearless-toggle">
      <div className="fearless-toggle-row">
        <strong>Fearless Mode</strong>
        <span className={`fearless-state${enabled ? ' on' : ''}`}>
          {enabled ? 'ON' : 'OFF'}
        </span>
      </div>
      <p className="muted" style={{ margin: '0.5rem 0 0', fontSize: '0.9rem' }}>
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
        <p className="error-text" style={{ margin: '0.5rem 0 0' }}>
          {error}
        </p>
      )}

      {confirmOpen && (
        <div className="modal-overlay">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="fearless-modal-title"
            className="modal-card"
          >
            <h2 id="fearless-modal-title">
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
                <p className="notice danger">
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
              <p className="error-text" style={{ margin: '0.75rem 0 0' }}>
                {error}
              </p>
            )}

            <div className="modal-actions">
              <button
                type="button"
                disabled={saving}
                onClick={() => setConfirmOpen(false)}
              >
                Cancel
              </button>
              <button
                className="primary-button"
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
