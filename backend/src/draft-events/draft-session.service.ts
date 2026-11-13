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
 * PostgreSQL remains the source of truth for the draft *record*; ban/pick row
 * persistence arrives with T-009. Turn timers/auto-advancement arrive with
 * T-011 (TurnManager), which will build on `confirmBan`/`confirmPick`.
 *
 * Concurrency note: state is read-modify-write JSON per draft. At 1v1 scale
 * (at most one acting team per turn) this is safe; T-011 serializes actions
 * server-side via the turn timer.
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

    const draft = await this.prisma.draft.findUnique({
      where: { id: draftId },
    });
    if (!draft) {
      throw new Error(`Draft ${draftId} not found`);
    }

    const state: DraftSessionState = {
      draftId: draft.id,
      code: draft.code,
      status: draft.status,
      fearlessMode: draft.fearlessMode,
      currentTurn: draft.currentTurn,
      bans: [],
      picks: [],
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
