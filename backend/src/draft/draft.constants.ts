/**
 * Draft lifecycle timings shared by the HTTP draft flow and the background
 * cleanup sweep.
 */

/** A waiting draft with no second player is cleaned up after 5 minutes. */
export const WAITING_DRAFT_TTL_MS = 5 * 60 * 1000;

/**
 * Expired drafts are retained briefly so connected clients can render the
 * expiry notice, then hard-deleted (R-013: "Draft auto-deletes after timeout
 * period").
 */
export const EXPIRED_DRAFT_RETENTION_MS = 5 * 60 * 1000;

/** How often the background cleanup sweep runs. */
export const DRAFT_CLEANUP_INTERVAL_MS = 60 * 1000;
