'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import api from '../../lib/api';
import { useAuth } from '../../hooks/useAuth';

const USERNAME_RE = /^[a-zA-Z0-9_]+$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const inputStyle = {
  display: 'block',
  width: '100%',
  padding: '0.5rem',
  marginTop: '0.25rem',
  marginBottom: '1rem',
  fontSize: '1rem',
};

function extractErrorMessage(err) {
  const message = err.response?.data?.message;
  if (Array.isArray(message)) return message.join(', ');
  if (typeof message === 'string' && message.length > 0) return message;
  return 'Something went wrong. Please try again.';
}

export default function RegisterPage() {
  const router = useRouter();
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  function validate() {
    if (
      username.length < 3 ||
      username.length > 32 ||
      !USERNAME_RE.test(username)
    ) {
      return 'Username must be 3-32 characters: letters, numbers and underscores only.';
    }
    if (!EMAIL_RE.test(email)) {
      return 'Please enter a valid email address.';
    }
    if (password.length < 8) {
      return 'Password must be at least 8 characters long.';
    }
    if (confirm !== password) {
      return 'Passwords do not match.';
    }
    return null;
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setError(null);
    setSubmitting(true);
    try {
      await api.post('/auth/register', { username, email, password });
      // Registration succeeded: sign the new user in automatically.
      try {
        await login({ username, password });
        router.push('/');
      } catch {
        // Auto-login failed (e.g. transient API issue): fall back to login.
        router.push('/login');
      }
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main style={{ maxWidth: '20rem', margin: '3rem auto', padding: '1.5rem' }}>
      <h1 style={{ textAlign: 'center' }}>Create an account</h1>
      <form onSubmit={handleSubmit}>
        <label>
          Username
          <input
            style={inputStyle}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
          />
        </label>
        <label>
          Email
          <input
            style={inputStyle}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
          />
        </label>
        <label>
          Password
          <input
            style={inputStyle}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
          />
        </label>
        <label>
          Confirm password
          <input
            style={inputStyle}
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
          />
        </label>
        {error && <p style={{ color: '#b91c1c' }}>{error}</p>}
        <button type="submit" disabled={submitting}>
          {submitting ? 'Creating account…' : 'Register'}
        </button>
      </form>
      <p style={{ textAlign: 'center' }}>
        Already have an account? <Link href="/login">Log in</Link>
      </p>
    </main>
  );
}
