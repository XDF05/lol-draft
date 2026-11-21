'use client';

import Link from 'next/link';
import { useAuth } from '../hooks/useAuth';

export default function HomePage() {
  const { status, user, logout } = useAuth();

  if (status === 'loading') {
    return (
      <main className="centered-page">
        <div className="landing-card">
          <h1>LoL Draft Strategy Board</h1>
          <p className="muted">Loading…</p>
        </div>
      </main>
    );
  }

  if (status === 'authenticated' && user) {
    return (
      <main className="centered-page">
        <div className="landing-card">
          <h1>LoL Draft Strategy Board</h1>
          <p>
            Signed in as <strong>{user.username}</strong>.
          </p>
          <div className="landing-actions">
            <Link className="primary-button" href="/draft/new">
              Create a draft
            </Link>
            <button type="button" onClick={logout}>
              Log out
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="centered-page">
      <div className="landing-card">
        <h1>LoL Draft Strategy Board</h1>
        <p>
          Plan a competitive 1v1 champion draft with live bans, picks, timers,
          and a shareable spectator view.
        </p>
        <div className="landing-actions">
          <Link className="primary-button" href="/login">
            Log in
          </Link>
          <Link href="/register">Create an account</Link>
        </div>
      </div>
    </main>
  );
}
