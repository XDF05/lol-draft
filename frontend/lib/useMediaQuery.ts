'use client';

import { useState, useEffect } from 'react';

/**
 * Responsive breakpoint helper (T-018, task 148).
 *
 * Tracks a CSS media query and returns whether it matches, updating on
 * resize/orientation change. Safe to call during SSR (returns false until
 * mounted).
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const mql = window.matchMedia(query);
    setMatches(mql.matches);
    const handler = (event: MediaQueryListEvent) => setMatches(event.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [query]);

  return matches;
}

/** True below 640px (mobile). */
export function useIsMobile(): boolean {
  return useMediaQuery('(max-width: 639px)');
}
