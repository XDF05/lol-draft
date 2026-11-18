import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import {
  BanConfirmedEntry,
  PickConfirmedEntry,
  SwapRequestEntry,
  Team,
} from './socket-events';
import { banPhaseOf, turnInfo } from './turn-schedule';

/**
 * Live draft session state, kept in Redis while the draft is active
 * (design: "Draft state saved to Redis for live session", R-012).
 *
 * PostgreSQL remains the source of truth for the draft *record*: ban rows are
 * persisted on every lock (T-009); pick rows arrive with T-010. A rebuilt
 * session (Redis loss/restart) is hydrated from those rows so an in-progress
 * draft resumes with its ban/pick history intact (R-012).
 *
 * Concurrency note: state is read-modify-write JSON per draft. At 1v1 scale
 * (at most one acting team per turn) this is safe; the T-009 TurnManager
 * additionally serializes turn resolution via its per-turn action claim.
 */
export interface PendingSelection {
  type: 'BAN' | 'PICK';
  championId: string | null;
}

export interface DraftSessionState {
  draftId: number;
  code: string;
  status: string;
  fearlessMode: boolean;
  currentTurn: number;
  bans: BanConfirmedEntry[];
  picks: PickConfirmedEntry[];
  pending: Partial<Record<Team, PendingSelection | null>>;
  skips: Record<Team, number>;
  swapRequests: SwapRequestEntry[];
  updatedAt: string;
}

const sessionKey = (draftId: number): string => `draft:${draftId}:session`;

@Injectable()
export class DraftSessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /** Load the live session, creating it from the draft record when missing. */
  async getOrCreate(draftId: number): Promise<DraftSessionState> {
    const existing = await this.redis.get(sessionKey(draftId));
    if (existing) {
      return JSON.parse(existing) as DraftSessionState;
    }

    const [draft, banRows, pickRows] = await Promise.all([
      this.prisma.draft.findUnique({
        where: { id: draftId },
      }),
      this.prisma.ban.findMany({ where: { draftId }, orderBy: { id: 'asc' } }),
      this.prisma.pick.findMany({ where: { draftId }, orderBy: { id: 'asc' } }),
    ]);
    if (!draft) {
      throw new Error(`Draft ${draftId} not found`);
    }

    const state: DraftSessionState = {
      draftId: draft.id,
      code: draft.code,
      status: draft.status,
      fearlessMode: draft.fearlessMode,
      currentTurn: draft.currentTurn,
      // Hydrate the locked history from PostgreSQL so a session rebuilt
      // after a Redis loss keeps its bans/picks (R-012).
      bans: banRows.map((row) => ({
        championId: row.championId,
        team: row.team as Team,
        phase: row.phase as 1 | 2,
        locked: row.locked,
      })),
      picks: pickRows.map((row) => ({
        championId: row.championId,
        team: row.team as Team,
        locked: row.locked,
      })),
      pending: {},
      skips: { BLUE: 0, RED: 0 },
      swapRequests: [],
      updatedAt: new Date().toISOString(),
    };
    await this.save(state);
    return state;
  }

  async save(state: DraftSessionState): Promise<void> {
    state.updatedAt = new Date().toISOString();
    await this.redis.set(sessionKey(state.draftId), JSON.stringify(state));
  }

  /** Remove the live session entirely (draft expired or deleted). */
  async deleteSession(draftId: number): Promise<void> {
    await this.redis.del(sessionKey(draftId));
  }

  /**
   * Re-apply the draft record's authoritative fields (status, fearlessMode)
   * to the live session and persist them. A session created while the draft
   * was WAITING_FOR_PLAYERS keeps that stale status otherwise — nothing
   * else writes the flip into Redis (T-009 timers read it from here).
   * Returns null when the draft row no longer exists.
   */
  async syncWithRecord(draftId: number): Promise<DraftSessionState | null> {
    const draft = await this.prisma.draft.findUnique({
      where: { id: draftId },
    });
    if (!draft) {
      return null;
    }
    const state = await this.getOrCreate(draftId);
    state.status = draft.status;
    state.fearlessMode = draft.fearlessMode;
    await this.save(state);
    return state;
  }

  /** Store (or replace) the acting team's pending selection (R-009). */
  async setPending(
    draftId: number,
    team: Team,
    type: 'BAN' | 'PICK',
    championId: string | null,
  ): Promise<DraftSessionState> {
    const state = await this.getOrCreate(draftId);
    state.pending[team] = { type, championId: championId ?? null };
    await this.save(state);
    return state;
  }

  /** Drop the team's pending selection entirely (e.g. on draft.leave). */
  async clearPending(
    draftId: number,
    team: Team,
  ): Promise<DraftSessionState> {
    const state = await this.getOrCreate(draftId);
    delete state.pending[team];
    await this.save(state);
    return state;
  }

  /** Confirm the acting team's pending selection as a locked ban. */
  async confirmBan(
    draftId: number,
    team: Team,
  ): Promise<{ state: DraftSessionState; championId: string | null }> {
    const state = await this.getOrCreate(draftId);
    const pending = state.pending[team];
    if (!pending || pending.type !== 'BAN' || !pending.championId) {
      return { state, championId: null };
    }

    const phase = banPhaseOf(turnInfo(state.currentTurn).phase);
    state.bans.push({
      championId: pending.championId,
      team,
      phase,
      locked: true,
    });
    state.pending[team] = null;
    await this.save(state);
    return { state, championId: pending.championId };
  }

  /** Confirm the acting team's pending selection as a locked pick. */
  async confirmPick(
    draftId: number,
    team: Team,
  ): Promise<{ state: DraftSessionState; championId: string | null }> {
    const state = await this.getOrCreate(draftId);
    const pending = state.pending[team];
    if (!pending || pending.type !== 'PICK' || !pending.championId) {
      return { state, championId: null };
    }

    state.picks.push({
      championId: pending.championId,
      team,
      locked: true,
    });
    state.pending[team] = null;
    await this.save(state);
    return { state, championId: pending.championId };
  }

  /** Record a voluntary skip (ban.skip / pick.skip) for the acting team. */
  async recordSkip(
    draftId: number,
    team: Team,
  ): Promise<DraftSessionState> {
    const state = await this.getOrCreate(draftId);
    state.pending[team] = null;
    state.skips[team] = (state.skips[team] ?? 0) + 1;
    await this.save(state);
    return state;
  }

  /** Register a Finalization swap request (R-007). */
  async addSwapRequest(
    draftId: number,
    requesterTeam: Team,
    requestedBy: number,
    offerChampionId: string,
    targetChampionId: string,
  ): Promise<SwapRequestEntry> {
    const state = await this.getOrCreate(draftId);
    const entry: SwapRequestEntry = {
      id: crypto.randomUUID(),
      requestedBy,
      requesterTeam,
      offerChampionId,
      targetChampionId,
      status: 'PENDING',
    };
    state.swapRequests.push(entry);
    await this.save(state);
    return entry;
  }

  /** Approve or reject a pending swap request; only the opponent may decide. */
  async resolveSwapRequest(
    draftId: number,
    requestId: string,
    decidingTeam: Team,
    approved: boolean,
  ): Promise<SwapRequestEntry | null> {
    const state = await this.getOrCreate(draftId);
    const entry = state.swapRequests.find((r) => r.id === requestId);
    if (!entry || entry.status !== 'PENDING') {
      return null;
    }
    if (entry.requesterTeam === decidingTeam) {
      return null; // The requester's opponent decides.
    }
    entry.status = approved ? 'APPROVED' : 'REJECTED';
    await this.save(state);
    return entry;
  }
}
