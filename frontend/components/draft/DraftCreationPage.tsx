'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { isAxiosError } from 'axios';
import { createDraft, type DraftSide } from '../../lib/draft-api';

/**
 * Draft creation flow (T-008): side selection (Blue/Red, R-002) and
 * POST /draft/create, then redirect into the draft room to wait for the
 * opponent.
 */

const selectedBorder = {
  BLUE: '2px solid #3b82f6',
  RED: '2px solid #ef4444',
} as const;

function extractErrorMessage(err: unknown): string {
  if (isAxiosError(err)) {
    const message = err.response?.data?.message;
    if (Array.isArray(message)) return message.join(', ');
    if (typeof message === 'string' && message.length > 0) return message;
  }
  return 'Could not create the draft. Please try again.';
}

const SIDES: Array<{ side: DraftSide; title: string; blurb: string }> = [
  {
    side: 'BLUE',
    title: 'Blue side',
    blurb: 'First overall pick (turn 7) — the aggressive side.',
  },
  {
    side: 'RED',
    title: 'Red side',
    blurb: 'Counter-pick advantage (turn 9) — the reactive side.',
  },
];

export default function DraftCreationPage() {
  const router = useRouter();
  const [side, setSide] = useState<DraftSide>('BLUE');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const { code } = await createDraft(side);
      router.push(`/draft/${code}`);
    } catch (err) {
      setError(extractErrorMessage(err));
      setSubmitting(false);
    }
  }

  return (
    <main className="centered-page">
      <div className="auth-card">
        <h1>New draft</h1>
        <p className="muted" style={{ textAlign: 'center' }}>
          Pick your side, then share the draft code with your opponent.
        </p>
        <form onSubmit={handleSubmit}>
          <fieldset className="side-choice-list">
            <legend style={{ fontWeight: 700, marginBottom: '0.5rem' }}>
              Your side
            </legend>
            {SIDES.map(({ side: value, title, blurb }) => {
              const selected = side === value;
              const sideClass = value.toLowerCase();
              return (
                <label
                  key={value}
                  className={`side-choice ${sideClass}${selected ? ` selected-${sideClass}` : ''}`}
                  style={
                    selected ? { border: selectedBorder[value] } : undefined
                  }
                >
                  <input
                    type="radio"
                    name="side"
                    value={value}
                    checked={selected}
                    onChange={() => setSide(value)}
                    style={{ position: 'absolute', opacity: 0 }}
                  />
                  <span className="side-choice-title">
                    {title}
                    {selected ? ' ✓' : ''}
                  </span>
                  <span className="side-choice-description">{blurb}</span>
                </label>
              );
            })}
          </fieldset>
          {error && <p className="error-text">{error}</p>}
          <button
            className="primary-button"
            type="submit"
            disabled={submitting}
          >
            {submitting ? 'Creating draft…' : 'Create draft'}
          </button>
        </form>
      </div>
    </main>
  );
}
