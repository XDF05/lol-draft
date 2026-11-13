/**
 * Public champion shape served to clients and cached in Redis.
 *
 * Keep in sync with the frontend contract (frontend/lib/types.ts) — both
 * describe the same wire format.
 */
export interface Champion {
  /** Stable pool ID (Riot champion key), e.g. "Ahri". */
  id: string;
  name: string;
  iconUrl: string;
}

/** Envelope returned by GET /champions and stored under `champions:data`. */
export interface ChampionsResponse {
  count: number;
  data: Champion[];
}
