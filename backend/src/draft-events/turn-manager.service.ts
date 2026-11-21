import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import type { Server } from 'socket.io';
import { PrismaService } from '../prisma/prisma.service';
import { DraftSessionService } from './draft-session.service';
import {
  FINALIZATION_TURN,
  MAX_TURNS,
  banPhaseOf,
  turnInfo,
} from './turn-schedule';
import {
  BanConfirmedPayload,
  BanConfirmedEntry,
  DraftCompletedPayload,
  PickConfirmedEntry,
  PickConfirmedPayload,
  Team,
  TimerExpiredPayload,
  TurnStartPayload,
  draftRoom,
} from './socket-events';

/** Server-side turn timer warnings (R-010: warning states at 5s, 3s, 1s). */
const WARNING_AT_SECONDS = [5, 3, 1] as const;

/** Schedule phase → its `phase.*.start` announcement event. */
const PHASE_EVENTS: Record<string, string> = {
  BANNING_P1: 'phase.ban1.start',
  PICKING_P1: 'phase.pick1.start',
  BANNING_P2: 'phase.ban2.start',
  PICKING_P2: 'phase.pick2.start',
  FINALIZATION: 'phase.finalization.start',
};

interface ArmedTurnTimer {
  /** Epoch ms when this turn's countdown ends (auto-lock fires). */
  deadline: number;
  /** Effective countdown seconds for this turn (may be shortened in tests). */
  seconds: number;
  turnNumber: number;
  warnings: Array<ReturnType<typeof setTimeout>>;
  expiry: ReturnType<typeof setTimeout>;
}

/**
 * Server-side turn timer and turn advancement (T-009; hardened in T-016).
 *
 * One 30s countdown per draft turn (60s for Finalization, R-010). Deadline
 * based, so reconnects and short test overrides stay accurate:
 *
 * - The countdown is armed when a draft starts and re-armed (idempotently,
 *   same deadline) whenever a player rejoins; `remainingSecondsFor` lets the
 *   join handshake tell the returning client how much time is really left.
 * - `timer.warning` fires at 5s / 3s / 1s for the warning UI states.
 * - On expiry the turn is auto-resolved (R-009): a pending selection is
 *   locked (persisted to PostgreSQL), otherwise the acting team's turn is
 *   skipped — then the turn advances.
 * - Turn advancement persists `currentTurn` to the draft row, updates the
 *   Redis session and announces `turn.end` → `turn.start` (+ a
 *   `phase.*.start` marker on phase boundaries).
 *
 * Exactly one action resolves a turn: the gateway handlers and the timer
 * expiry both go through `claimTurnAction`, so a lock racing the deadline
 * can never double-advance.
 */
@Injectable()
export class TurnManagerService implements OnModuleDestroy {
  private readonly logger = new Logger(TurnManagerService.name);

  /** Socket.IO server, handed over by the gateway once initialised. */
  private server: Server | null = null;

  private readonly timers = new Map<number, ArmedTurnTimer>();
  /** draftId → turn numbers whose action has already been claimed. */
  private readonly claimedTurns = new Map<number, Set<number>>();

  /**
   * Test/dev overrides that shorten the countdowns (spec values: 30s per
   * action, 60s for Finalization). Unset variables keep the spec timing; a
   * shortened turn timer also halves Finalization unless it is set itself.
   */
  private readonly turnTimerOverrideMs =
    Number(process.env.DRAFT_TURN_TIMER_MS) || null;
  private readonly turnTimerMs = this.turnTimerOverrideMs ?? 30_000;
  private readonly finalizationTimerMs =
    Number(process.env.DRAFT_FINALIZATION_TIMER_MS) ||
    (this.turnTimerOverrideMs !== null ? this.turnTimerOverrideMs * 2 : 60_000);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: DraftSessionService,
  ) {}

  /** The gateway hands its Socket.IO server over once initialised. */
  attachServer(server: Server): void {
    this.server = server;
  }

  onModuleDestroy(): void {
    for (const draftId of [...this.timers.keys()]) {
      this.clearTimers(draftId);
    }
  }

  /**
   * Arm the countdown for the draft's current turn and announce it to the
   * room (`turn.start` + phase marker + snapshot). Called when a draft
   * starts (T-008 flow).
   */
  async startTurnTimer(draftId: number): Promise<void> {
    await this.armTurn(draftId, { announce: true });
  }

  /**
   * Re-arm after a reconnect: keeps the running deadline when the timer is
   * already armed; after a server restart it restarts the current turn's
   * countdown (the Redis session survives, the in-memory timer does not).
   */
  async resumeTurnTimer(draftId: number): Promise<void> {
    await this.armTurn(draftId, { announce: false });
  }

  /** Remaining seconds of the armed timer (null when not armed). */
  remainingSecondsFor(draftId: number): number | null {
    const armed = this.timers.get(draftId);
    if (!armed) {
      return null;
    }
    return Math.max(0, Math.ceil((armed.deadline - Date.now()) / 1000));
  }

  /**
   * Exclusive per-turn action claim: the first of {manual lock, manual
   * skip, timer expiry} to claim a turn resolves it; later attempts are
   * rejected so a lock racing the deadline cannot double-advance.
   */
  claimTurnAction(draftId: number, turnNumber: number): boolean {
    let claims = this.claimedTurns.get(draftId);
    if (!claims) {
      claims = new Set();
      this.claimedTurns.set(draftId, claims);
    }
    if (claims.has(turnNumber)) {
      return false;
    }
    claims.add(turnNumber);
    return true;
  }

  /** Undo a claim when the claimed action itself failed (nothing to lock). */
  releaseTurnAction(draftId: number, turnNumber: number): void {
    this.claimedTurns.get(draftId)?.delete(turnNumber);
  }

  /**
   * The turn's action finished (lock/skip broadcast done): stop the
   * countdown and advance to the next turn.
   */
  async handleActionCompleted(draftId: number): Promise<void> {
    this.clearTimers(draftId);
    await this.advanceTurn(draftId);
  }

  /** Stop all timers for a draft (draft expiry / teardown). */
  clearTimers(draftId: number): void {
    const armed = this.timers.get(draftId);
    if (!armed) {
      return;
    }
    clearTimeout(armed.expiry);
    for (const warning of armed.warnings) {
      clearTimeout(warning);
    }
    this.timers.delete(draftId);
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private async armTurn(
    draftId: number,
    opts: { announce: boolean },
  ): Promise<void> {
    const session = await this.sessions.syncWithRecord(draftId);
    if (!session || session.status !== 'IN_PROGRESS') {
      return;
    }

    const turn = turnInfo(session.currentTurn);
    const configuredMs =
      turn.phase === 'FINALIZATION'
        ? this.finalizationTimerMs
        : this.turnTimerMs;
    const seconds = Math.min(turn.timerSeconds, Math.ceil(configuredMs / 1000));
    const deadline = Date.now() + seconds * 1000;

    const existing = this.timers.get(draftId);
    if (existing && existing.turnNumber === turn.turnNumber) {
      // Already armed for this turn — keep the running deadline (a join must
      // never hand the acting team a fresh countdown).
      return;
    }
    this.clearTimers(draftId);

    const warnings: Array<ReturnType<typeof setTimeout>> = [];
    for (const at of WARNING_AT_SECONDS) {
      const delay = deadline - at * 1000 - Date.now();
      if (delay <= 0) {
        continue; // re-arming late in the turn: that warning already passed
      }
      warnings.push(
        setTimeout(() => {
          this.emitTo(draftId, 'timer.warning', {
            seconds: at,
            turn: { ...turn, timerSeconds: seconds } as TurnStartPayload,
          });
        }, delay),
      );
    }

    const expiry = setTimeout(() => {
      this.timers.delete(draftId);
      void this.resolveExpiredTurn(draftId);
    }, seconds * 1000);

    this.timers.set(draftId, {
      deadline,
      seconds,
      turnNumber: turn.turnNumber,
      warnings,
      expiry,
    });

    if (opts.announce) {
      this.emitTo(draftId, 'turn.start', {
        ...turn,
        timerSeconds: seconds,
      } as TurnStartPayload);
      // Phase marker whenever the schedule enters a new phase (turn 1 has
      // no predecessor, so Ban Phase 1 opens with `phase.ban1.start`).
      const previousPhase =
        turn.turnNumber === 1 ? null : turnInfo(turn.turnNumber - 1).phase;
      if (previousPhase !== turn.phase) {
        this.emitTo(draftId, PHASE_EVENTS[turn.phase], {});
      }
      const fresh = await this.sessions.getOrCreate(draftId);
      this.emitTo(draftId, 'draft.update', fresh);
    }

    this.logger.log(
      `timer.start draft=${draftId} turn=${turn.turnNumber} seconds=${seconds}`,
    );
  }

  /**
   * Deadline hit: auto-resolve the turn (R-009) — lock the pending
   * selection, otherwise skip — then advance.
   */
  private async resolveExpiredTurn(draftId: number): Promise<void> {
    const session = await this.sessions.syncWithRecord(draftId);
    if (!session || session.status !== 'IN_PROGRESS') {
      return;
    }
    const turn = turnInfo(session.currentTurn);

    if (!this.claimTurnAction(draftId, turn.turnNumber)) {
      return; // a manual action already owns this turn
    }

    if (turn.phase === 'FINALIZATION') {
      // The 60s grace period ended: swaps are locked and the draft is
      // finalized (R-007/R-014).
      this.emitTo(draftId, 'timer.expired', {
        autoLockedChampionId: null,
      } satisfies TimerExpiredPayload);
      await this.completeDraft(draftId);
      return;
    }

    const team = turn.expectedTeam;
    if (!team) {
      return;
    }

    const pending = session.pending[team];
    let autoLockedChampionId: string | null = null;
    if (pending?.championId) {
      if (turn.actionType === 'BAN') {
        autoLockedChampionId = await this.autoLockBan(
          draftId,
          team,
          turn.turnNumber,
        );
      } else {
        autoLockedChampionId = await this.autoLockPick(
          draftId,
          team,
          turn.turnNumber,
          pending.championId,
        );
      }
    } else {
      const state = await this.sessions.recordSkip(draftId, team);
      this.emitTo(draftId, 'draft.update', state);
      this.logger.log(
        `auto.skip draft=${draftId} team=${team} turn=${turn.turnNumber}`,
      );
    }

    this.emitTo(draftId, 'timer.expired', {
      autoLockedChampionId,
    } satisfies TimerExpiredPayload);
    await this.advanceTurn(draftId);
  }

  /** Timeout with a pending ban: lock it, persist the Ban row, broadcast. */
  private async autoLockBan(
    draftId: number,
    team: Team,
    turnNumber: number,
  ): Promise<string | null> {
    const { state, championId } = await this.sessions.confirmBan(draftId, team);
    if (!championId) {
      return null;
    }
    const phase = banPhaseOf(turnInfo(turnNumber).phase);
    await this.persistBanRow(draftId, championId, team, phase);
    const payload: BanConfirmedPayload = { championId, team, phase, bans: state.bans };
    this.emitTo(draftId, 'ban.confirmed', payload);
    this.emitTo(draftId, 'draft.update', state);
    this.logger.log(
      `auto.lock draft=${draftId} team=${team} champion=${championId} turn=${turnNumber}`,
    );
    return championId;
  }

  /**
   * Timeout with a pending pick: persist the Pick row, lock it in the live
   * session (carrying the row id for Finalization swaps) and broadcast
   * (T-010/T-014).
   */
  private async autoLockPick(
    draftId: number,
    team: Team,
    turnNumber: number,
    championId: string,
  ): Promise<string | null> {
    const row = await this.persistPickRow(draftId, championId, team);
    const { state, championId: confirmed } = await this.sessions.confirmPick(
      draftId,
      team,
      row.id,
    );
    if (!confirmed) {
      // The pending selection vanished before confirmation — do not leave a
      // stray Pick row behind.
      await this.prisma.pick
        .delete({ where: { id: row.id } })
        .catch(() => undefined);
      return null;
    }
    const payload: PickConfirmedPayload = {
      championId: confirmed,
      team,
      picks: state.picks,
    };
    this.emitTo(draftId, 'pick.confirmed', payload);
    this.emitTo(draftId, 'draft.update', state);
    this.logger.log(
      `auto.lock draft=${draftId} team=${team} champion=${confirmed} turn=${turnNumber}`,
    );
    return confirmed;
  }

  /**
   * One Ban row per locked ban (T-009: "Update PostgreSQL bans table").
   * Shared by the timer's auto-lock and the gateway's manual `ban.lock`.
   */
  async persistBanRow(
    draftId: number,
    championId: string,
    team: Team,
    phase: 1 | 2,
  ): Promise<void> {
    const draft = await this.prisma.draft.findUnique({ where: { id: draftId } });
    const playerId =
      team === 'BLUE' ? draft?.blueTeamPlayerId : draft?.redTeamPlayerId;
    if (!playerId) {
      return;
    }
    await this.prisma.ban.create({
      data: { draftId, championId, phase, playerId, team, locked: true },
    });
  }

  /**
   * One Pick row per locked pick (T-010: "Update PostgreSQL picks table").
   * Shared by the timer's auto-lock and the gateway's manual `pick.lock`.
   * Returns the row id so the live session can address it during
   * Finalization swaps.
   */
  async persistPickRow(
    draftId: number,
    championId: string,
    team: Team,
  ): Promise<{ id: number }> {
    const draft = await this.prisma.draft.findUnique({ where: { id: draftId } });
    const playerId =
      team === 'BLUE' ? draft?.blueTeamPlayerId : draft?.redTeamPlayerId;
    if (!playerId) {
      throw new Error(`Draft ${draftId} has no ${team} player for this pick`);
    }
    const row = await this.prisma.pick.create({
      data: { draftId, championId, playerId, team, locked: true },
    });
    return { id: row.id };
  }

  /**
   * Finalization timer expired (R-007/R-014): atomically lock the draft,
   * save `completedAt`, and broadcast the final pick order. The live session
   * is kept (status COMPLETE) so the public/reconnect view still resolves.
   */
  private async completeDraft(draftId: number): Promise<void> {
    const completed = await this.prisma.draft.updateMany({
      where: { id: draftId, status: 'IN_PROGRESS' },
      data: { status: 'COMPLETE', completedAt: new Date() },
    });
    if (completed.count === 0) {
      return; // already completed or expired
    }

    const [draft, pickRows, banRows] = await Promise.all([
      this.prisma.draft.findUnique({ where: { id: draftId } }),
      this.prisma.pick.findMany({ where: { draftId }, orderBy: { id: 'asc' } }),
      this.prisma.ban.findMany({ where: { draftId }, orderBy: { id: 'asc' } }),
    ]);
    if (!draft) {
      return;
    }

    const picks: PickConfirmedEntry[] = pickRows.map((row) => ({
      id: row.id,
      championId: row.championId,
      team: row.team as Team,
      locked: row.locked,
    }));
    const bans: BanConfirmedEntry[] = banRows.map((row) => ({
      championId: row.championId,
      team: row.team as Team,
      phase: row.phase as 1 | 2,
      locked: row.locked,
    }));

    // Persist the COMPLETE status into the live session as well, then push
    // the final snapshot + completion event to both clients.
    const state = await this.sessions.syncWithRecord(draftId);
    this.clearTimers(draftId);
    this.claimedTurns.delete(draftId);

    if (state) {
      this.emitTo(draftId, 'draft.update', state);
    }
    const payload: DraftCompletedPayload = {
      draftId,
      code: draft.code,
      completedAt: (draft.completedAt ?? new Date()).toISOString(),
      picks,
      bans,
    };
    this.emitTo(draftId, 'draft.completed', payload);
    this.logger.log(
      `draft.completed draft=${draftId} picks=${picks.length} bans=${bans.length}`,
    );
  }

  /** Move to the next turn: persist, announce, re-arm. */
  private async advanceTurn(draftId: number): Promise<void> {
    const session = await this.sessions.syncWithRecord(draftId);
    if (!session || session.status !== 'IN_PROGRESS') {
      return;
    }
    if (session.currentTurn >= MAX_TURNS) {
      // Turn 21 is the Finalization grace period; its timer expiry completes
      // the draft (completeDraft).
      return;
    }

    const nextTurn = session.currentTurn + 1;
    this.claimedTurns.delete(draftId);

    // Persist the T+1 state update to PostgreSQL, then to the live session,
    // so a rebuilt session (Redis loss) resumes at the right turn.
    await this.prisma.draft.update({
      where: { id: draftId },
      data: { currentTurn: nextTurn },
    });
    session.currentTurn = nextTurn;
    await this.sessions.save(session);

    this.emitTo(draftId, 'turn.end', nextTurn);
    await this.armTurn(draftId, { announce: true });
  }

  private emitTo(draftId: number, event: string, payload: unknown): void {
    if (!this.server) {
      this.logger.warn(`emit skipped (server not attached): ${event}`);
      return;
    }
    this.server.to(draftRoom(draftId)).emit(event as never, payload as never);
  }
}
