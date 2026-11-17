'use client';

import { useState, type CSSProperties, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { isAxiosError } from 'axios';
import { createDraft, type DraftSide } from '../../lib/draft-api';

/**
 * Draft creation flow (T-008): side selection (Blue/Red, R-002) and
 * POST /draft/create, then redirect into the draft room to wait for the
 * opponent.
 */

const cardStyle: CSSProperties = {
  display: 'block',
  width: '100%',
  padding: '1rem',
  border: '1px solid #d1d5db',
  borderRadius: '0.5rem',
  background: '#fff',
  textAlign: 'left',
  cursor: 'pointer',
  font: 'inherit',
};

const selectedBorder = {
  BLUE: '2px solid #1d4ed8',
  RED: '2px solid #b91c1c',
} as const;

const accents = {
  BLUE: '#1d4ed8',
  RED: '#b91c1c',
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
    <main style={{ maxWidth: '26rem', margin: '3rem auto', padding: '1.5rem' }}>
      <h1 style={{ textAlign: 'center' }}>New draft</h1>
      <p style={{ textAlign: 'center', color: '#4b5563' }}>
        Pick your side, then share the draft code with your opponent.
      </p>
      <form onSubmit={handleSubmit}>
        <fieldset
          style={{
            border: 'none',
            margin: 0,
            padding: 0,
            display: 'grid',
            gap: '0.75rem',
            marginBottom: '1.25rem',
          }}
        >
          <legend style={{ fontWeight: 600, marginBottom: '0.5rem' }}>
            Your side
          </legend>
          {SIDES.map(({ side: value, title, blurb }) => {
            const selected = side === value;
            return (
              <label
                key={value}
                style={{
                  ...cardStyle,
                  border: selected ? selectedBorder[value] : cardStyle.border,
                  opacity: selected ? 1 : 0.85,
                }}
              >
                <input
                  type="radio"
                  name="side"
                  value={value}
                  checked={selected}
                  onChange={() => setSide(value)}
                  style={{ position: 'absolute', opacity: 0 }}
                />
                <span
                  style={{
                    display: 'block',
                    fontWeight: 600,
                    color: accents[value],
                  }}
                >
                  {title}
                  {selected ? ' ✓' : ''}
                </span>
                <span style={{ fontSize: '0.85rem', color: '#4b5563' }}>
                  {blurb}
                </span>
              </label>
            );
          })}
        </fieldset>
        {error && <p style={{ color: '#b91c1c' }}>{error}</p>}
        <button
          type="submit"
          disabled={submitting}
          style={{ width: '100%', padding: '0.6rem' }}
        >
          {submitting ? 'Creating draft…' : 'Create draft'}
        </button>
      </form>
    </main>
  );
}
