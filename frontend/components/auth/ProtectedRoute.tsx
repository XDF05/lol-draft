'use client';

import { useEffect, type ReactNode } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '../../hooks/useAuth';

/**
 * Renders children only when authenticated. While the stored session is
 * being validated on first load it shows a loading state; unauthenticated
 * users are redirected to /login with their intended path as ?next=.
 */
export default function ProtectedRoute({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    }
  }, [status, pathname, router]);

  if (status !== 'authenticated') {
    return (
      <div className="centered-page">
        <div className="landing-card">
          <p className="muted" style={{ margin: 0, textAlign: 'center' }}>
            Loading…
          </p>
        </div>
      </div>
    );
  }

  return children;
}
