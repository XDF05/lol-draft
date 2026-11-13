'use client';

import { useEffect } from 'react';
import { useChampionStore } from '../store/championStore';
import type { ChampionPoolStatus } from '../store/championStore';
import type { Champion } from '../lib/types';

/**
 * Loads the champion pool into the store on first mount and exposes it for
 * rendering. Concurrent mounts share one in-flight request (single-flight).
 */
export function useChampionData(): {
  champions: Champion[];
  status: ChampionPoolStatus;
  error: string | null;
} {
  const champions = useChampionStore((state) => state.champions);
  const status = useChampionStore((state) => state.status);
  const error = useChampionStore((state) => state.error);
  const fetchChampions = useChampionStore((state) => state.fetchChampions);

  useEffect(() => {
    // The store already records failures; nothing to do on rejection.
    void fetchChampions().catch(() => undefined);
  }, [fetchChampions]);

  return { champions, status, error };
}

export default useChampionData;
