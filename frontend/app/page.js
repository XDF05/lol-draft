'use client';

import Link from 'next/link';
import { useAuth } from '../hooks/useAuth';

const mainStyle = { padding: '2rem', textAlign: 'center' };

export default function HomePage() {
  const { status, user, logout } = useAuth();

  if (status === 'loading') {
    return (
      <main style={mainStyle}>
        <h1>LoL Draft Strategy Board</h1>
        <p>Loading…</p>
      </main>
    );
  }

  if (status === 'authenticated') {
    return (
      <main style={mainStyle}>
        <h1>LoL Draft Strategy Board</h1>
        <p>
          Signed in as <strong>{user.username}</strong>.
        </p>
        <button onClick={logout}>Log out</button>
      </main>
    );
  }

  return (
    <main style={mainStyle}>
      <h1>LoL Draft Strategy Board</h1>
      <p>The draft board UI will be implemented in a later task.</p>
      <p>
        <Link href="/login">Log in</Link> or{' '}
        <Link href="/register">create an account</Link>
      </p>
    </main>
  );
}
