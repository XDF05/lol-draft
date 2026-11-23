import axios from 'axios';
import { create } from 'zustand';
import api from '../lib/api';
import type { Champion, ChampionsResponse } from '../lib/types';

/**
 * Global champion pool state (Zustand).
 *
 * The pool is fetched once per app session via GET /champions; the backend
 * serves it from its patch-aware Redis cache, so this stays cheap. Concurrent
 * callers share one in-flight request (single-flight).
 */

export type ChampionPoolStatus = 'idle' | 'loading' | 'ready' | 'error';

interface ChampionState {
  champions: Champion[];
  status: ChampionPoolStatus;
  error: string | null;
  /**
   * Loads the champion pool (single-flight). Resolves with the list, or
   * rejects after recording `status: 'error'` for display.
   */
  fetchChampions: () => Promise<Champion[]>;
}

let inflight: Promise<Champion[]> | null = null;

export const useChampionStore = create<ChampionState>()((set, get) => ({
  champions: [],
  status: 'idle',
  error: null,

  fetchChampions: () => {
    if (get().status === 'ready') {
      return Promise.resolve(get().champions);
    }
    if (!inflight) {
      inflight = api
        .get<ChampionsResponse>('/champions')
        .then((res) => res.data)
        .then((payload) => {
          set({ champions: payload.data, status: 'ready', error: null });
          return payload.data;
        })
        .catch((err) => {
          set({ status: 'error', error: toErrorMessage(err) });
          throw err;
        })
        .finally(() => {
          inflight = null;
        });
    }
    return inflight;
  },
}));

function toErrorMessage(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as { message?: unknown } | undefined;
    if (typeof data?.message === 'string' && data.message.length > 0) {
      // e.g. "Champion pool unavailable" from the API (EC-003).
      return data.message;
    }
  }
  return 'Champion pool unavailable';
}
