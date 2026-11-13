/**
 * Shared TypeScript interfaces for the draft app.
 *
 * Keep in sync with the backend contract
 * (backend/src/champions/entities/champion.entity.ts) — both describe the
 * same wire format.
 */

export interface Champion {
  /** Stable pool ID (Riot champion key). */
  id: string;
  name: string;
  iconUrl: string;
}

/** Envelope returned by GET /champions. */
export interface ChampionsResponse {
  count: number;
  data: Champion[];
}
