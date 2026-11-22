import { Logger, UseFilters, UsePipes, ValidationPipe } from '@nestjs/common';
import * as crypto from 'crypto';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  WsException,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { WAITING_DRAFT_TTL_MS } from '../draft/draft.constants';
import { PrismaService } from '../prisma/prisma.service';
import { ConnectionHealthService } from './connection-health.service';
import { DraftSessionService } from './draft-session.service';
import { TurnManagerService } from './turn-manager.service';
import {
  banPhaseOf,
  initialTurnPayload,
  turnInfo,
} from './turn-schedule';
import {
  draftRoom,
  BanConfirmedEntry,
  DraftCompletedPayload,
  DraftExpiredPayload,
  HealthPingPayload,
  PickConfirmedEntry,
  PickConfirmedPayload,
  PickReorderedPayload,
  BanConfirmedPayload,
  publicBroadcastPayload,
  publicDraftRoom,
  PublicJoinAck,
  SocketUser,
  Team,
  TurnStartPayload,
  userRoom,
} from './socket-events';
import { ChampionSelectDto } from './dto/champion-select.dto';
import { DraftJoinDto } from './dto/draft-join.dto';
import { PickSwapDto } from './dto/pick-swap.dto';
import { PublicJoinDto } from './dto/public-join.dto';
import { WsJwtGuard } from './ws-jwt.guard';
import { DraftSessionState } from './draft-session.service';
import { WsValidationExceptionFilter } from './ws-validation-exception.filter';

/**
 * Real-time draft gateway (T-006).
 *
 * Responsibilities:
 * - Authenticate sockets via JWT at handshake time (`WsJwtGuard`).
 * - Room management: `draft.join` / `draft.leave` on the `draft:<id>` room,
 *   plus a personal `user:<id>` room per connected socket.
 * - Validate and route draft actions: `ban.*`, `pick.*`, `pick.swap`.
 * - Connection health monitoring via `ConnectionHealthService`.
 *
 * Scope notes (per the task breakdown):
 * - Ban/pick PostgreSQL persistence and `ban.confirmed`/`pick.confirmed`
 *   broadcast, the 30s turn timer, auto-lock and turn advancement are handled
 *   by T-009/T-010 (TurnManager). Finalization team-internal swaps
 *   (`pick.swap` → `pick.reordered`) and draft completion live here and in
 *   the TurnManager (T-014). This gateway maintains the Redis live-session
 *   state those tasks build upon.
 *
 * Event validation middleware: the class-level `ValidationPipe` validates
 * every `@MessageBody()` payload against its DTO (class-validator), and
 * `WsValidationExceptionFilter` renders failures on the client's `exception`
 * event as `{ status: 'error', message }` (including flattened validation
 * messages from DTO errors).
 */
@WebSocketGateway({
  cors: {
    // Same local-only policy as the HTTP API in main.ts.
    origin: ['http://localhost:3000', 'http://127.0.0.1:3000'],
    credentials: true,
  },
})
@UsePipes(
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }),
)
@UseFilters(new WsValidationExceptionFilter())
export class DraftEventsGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(DraftEventsGateway.name);

  /**
   * Live presence per draft: draftId → userId → socketIds currently in the
   * room. Used by the reconnection grace period (R-013) to detect when a
   * participant's last socket is gone.
   */
  private readonly draftPresence = new Map<number, Map<number, Set<string>>>();

  /**
   * Active reconnection grace timers: draftId → userId → timer. When the
   * timer lapses the draft expires (R-013 / EC-001).
   */
  private readonly graceTimers = new Map<
    number,
    Map<number, ReturnType<typeof setTimeout>>
  >();

  /**
   * Grace period after which a participant who never returned forfeits the
   * draft. Configurable for tests via DRAFT_GRACE_PERIOD_MS (default 30s).
   */
  private readonly gracePeriodMs =
    Number(process.env.DRAFT_GRACE_PERIOD_MS) || 30_000;

  constructor(
    private readonly wsJwtGuard: WsJwtGuard,
    private readonly prisma: PrismaService,
    private readonly sessions: DraftSessionService,
    private readonly health: ConnectionHealthService,
    private readonly turnManager: TurnManagerService,
  ) {}

  // -------------------------------------------------------------------------
  // Connection lifecycle
  // -------------------------------------------------------------------------

  afterInit(): void {
    this.health.startPeriodicLogging();
    // TurnManager emits on the gateway's server (avoiding a module cycle).
    this.turnManager.attachServer(this.server);
    this.logger.log('Draft events gateway initialised');
  }

  onModuleDestroy(): void {
    // Do not leave grace timers running across a shutdown.
    for (const timers of this.graceTimers.values()) {
      for (const timer of timers.values()) {
        clearTimeout(timer);
      }
    }
    this.graceTimers.clear();
  }

  /**
   * Authenticate at handshake time when credentials are present. Sockets
   * without a token are public spectators (T-015): they stay connected but
   * can only join read-only rooms via `public.join`. A malformed or expired
   * token is still rejected so a broken session fails loudly.
   */
  handleConnection(client: Socket): void {
    try {
      const user = this.wsJwtGuard.authenticate(client);
      client.data.user = user;
      this.health.register(client.id, user);
      void client.join(userRoom(user.id));
      this.logger.log(
        `connect user=${user.username} socket=${client.id} total=${this.health.stats().totalConnections}`,
      );
    } catch (err) {
      if (!this.hasHandshakeToken(client)) {
        // Anonymous spectator connection (T-015): no user room, no presence.
        this.logger.log(`connect spectator socket=${client.id}`);
        return;
      }
      const message =
        err instanceof Error ? err.message : 'Socket authentication failed';
      client.emit('auth.error', { message });
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket): void {
    const removed = this.health.unregister(client.id);
    if (removed) {
      this.logger.log(
        `disconnect user=${removed.user.username} socket=${client.id} total=${this.health.stats().totalConnections}`,
      );
    }

    // If this socket was in a draft room, update presence and possibly start
    // the reconnection grace period (R-013).
    const user = client.data.user as SocketUser | undefined;
    const draftId = client.data.draftId as number | undefined;
    if (user && draftId) {
      this.onParticipantSocketLost(draftId, user.id, client.id);
    }
  }

  // -------------------------------------------------------------------------
  // Room management
  // -------------------------------------------------------------------------

  /**
   * Join a draft room. Mirrors the T-006 acceptance criteria: look the draft
   * up by its public code, verify the caller is a participant, join the
   * `draft:<id>` room and broadcast the current `turn.start` to the room.
   */
  @SubscribeMessage('draft.join')
  async handleDraftJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: DraftJoinDto,
  ): Promise<{ ok: true; draftId: number; team: Team; room: string }> {
    const user = this.requireUser(client);

    const draft = await this.prismaDraftByCode(data.code);
    const team = this.teamOf(draft.blueTeamPlayerId, draft.redTeamPlayerId, user);
    if (data.team && data.team !== team) {
      throw new WsException(`You are assigned to the ${team} side`);
    }

    // Switching drafts on the same socket (e.g. creating a new one after the
    // previous draft completed): leave the old room automatically instead of
    // rejecting the join, so the client never needs a page reload. Joining
    // the room we are already in is a no-op resync.
    const previousDraftId = client.data.draftId as number | undefined;
    if (previousDraftId !== undefined && previousDraftId !== draft.id) {
      await this.leaveDraftRoom(client, previousDraftId, user);
    }

    const session = await this.sessions.getOrCreate(draft.id);
    this.applyRecordStatus(session, draft.status, draft.fearlessMode);

    await client.join(draftRoom(draft.id));
    client.data.draftId = draft.id;
    this.health.attachToDraft(client.id, draft.id);
    this.trackPresence(draft.id, user.id, client.id);

    // Keep the turn countdown running across reconnections (and restart it
    // after a server restart, T-009). A no-op for drafts not in progress.
    await this.turnManager.resumeTurnTimer(draft.id);
    const remainingSeconds = this.turnManager.remainingSecondsFor(draft.id);

    // Current turn snapshot to the whole room: doubles as the reconnection
    // state refresh for the opponent (R-013). `remainingSeconds` lets a
    // client resuming mid-turn tick from the true countdown instead of a
    // fresh 30s.
    const turnPayload: TurnStartPayload = {
      ...initialTurnPayload(session.currentTurn),
      ...(remainingSeconds !== null ? { remainingSeconds } : {}),
    } as TurnStartPayload;
    this.broadcast(draft.id, 'turn.start', turnPayload);
    this.broadcast(draft.id, 'draft.update', session);

    this.logger.log(
      `draft.join user=${user.username} draft=${draft.id} team=${team}`,
    );
    return { ok: true, draftId: draft.id, team, room: draftRoom(draft.id) };
  }

  /** Leave the current draft room, clearing the team's pending selection. */
  @SubscribeMessage('draft.leave')
  async handleDraftLeave(@ConnectedSocket() client: Socket): Promise<{
    ok: true;
  }> {
    const user = this.requireUser(client);
    const draftId = client.data.draftId as number | undefined;
    if (!draftId) {
      return { ok: true };
    }

    await this.leaveDraftRoom(client, draftId, user);
    return { ok: true };
  }

  /**
   * Leave a draft room: drop presence, clear the team's pending selection and
   * detach health tracking. Shared by `draft.leave` and by `draft.join` when
   * the socket moves to a different draft.
   */
  private async leaveDraftRoom(
    client: Socket,
    draftId: number,
    user: SocketUser,
  ): Promise<void> {
    this.untrackPresence(draftId, user.id, client.id);

    const draft = await this.prisma.draft.findUnique({ where: { id: draftId } });
    if (draft) {
      const isParticipant =
        draft.blueTeamPlayerId === user.id || draft.redTeamPlayerId === user.id;
      const isActive =
        draft.status === 'IN_PROGRESS' ||
        draft.status === 'WAITING_FOR_PLAYERS';
      if (isParticipant && isActive) {
        const team = this.teamOf(
          draft.blueTeamPlayerId,
          draft.redTeamPlayerId,
          user,
        );
        await this.sessions.clearPending(draftId, team);
      }
      await client.leave(draftRoom(draftId));
      this.health.detachFromDraft(client.id, draftId);
    }

    delete client.data.draftId;
  }

  // -------------------------------------------------------------------------
  // Public spectator room (T-015)
  // -------------------------------------------------------------------------

  /**
   * Join a draft's broadcast room as a read-only spectator. The draft code is
   * the only credential required; no user identity or presence is recorded,
   * so a spectator disconnect can never expire the draft. The joining socket
   * receives the current snapshot directly; subsequent live events arrive
   * through the sanitized `draft:<id>:public` room broadcasts.
   */
  @SubscribeMessage('public.join')
  async handlePublicJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: PublicJoinDto,
  ): Promise<PublicJoinAck> {
    const code = data.draftCode.trim().toUpperCase();
    const draft = await this.prisma.draft.findUnique({ where: { code } });
    if (
      !draft ||
      draft.status === 'EXPIRED' ||
      (draft.status === 'WAITING_FOR_PLAYERS' &&
        Date.now() - draft.createdAt.getTime() > WAITING_DRAFT_TTL_MS)
    ) {
      throw new WsException('Draft not found');
    }

    // A socket only spectates one draft at a time (e.g. after a redirect).
    const previous = client.data.publicDraftId as number | undefined;
    if (previous && previous !== draft.id) {
      await client.leave(publicDraftRoom(previous));
    }

    const session = await this.sessions.getOrCreate(draft.id);
    this.applyRecordStatus(session, draft.status, draft.fearlessMode);

    await client.join(publicDraftRoom(draft.id));
    client.data.publicDraftId = draft.id;

    // Make sure the countdown is armed even if only spectators are currently
    // connected (e.g. after a server restart). A no-op when already armed.
    await this.turnManager.resumeTurnTimer(draft.id);

    // State snapshot for the joining spectator; the room already sees live
    // updates. `remainingSeconds` keeps a mid-turn reconnect accurate.
    const remainingSeconds = this.turnManager.remainingSecondsFor(draft.id);
    const turnPayload: TurnStartPayload = {
      ...initialTurnPayload(session.currentTurn),
      ...(remainingSeconds !== null ? { remainingSeconds } : {}),
    };
    client.emit('turn.start', turnPayload);
    client.emit(
      'draft.update',
      publicBroadcastPayload('draft.update', session),
    );

    if (draft.status === 'COMPLETE') {
      client.emit('draft.completed', await this.completedPayload(draft.id));
    }

    this.logger.log(
      `public.join code=${draft.code} draft=${draft.id} socket=${client.id}`,
    );
    return {
      ok: true,
      draftId: draft.id,
      code: draft.code,
      status: draft.status,
    };
  }

  /** Leave the public broadcast room (navigation away / spectator timeout). */
  @SubscribeMessage('public.leave')
  async handlePublicLeave(
    @ConnectedSocket() client: Socket,
  ): Promise<{ ok: true }> {
    const draftId = client.data.publicDraftId as number | undefined;
    if (draftId) {
      await client.leave(publicDraftRoom(draftId));
      delete client.data.publicDraftId;
    }
    return { ok: true };
  }

  // -------------------------------------------------------------------------
  // Ban events
  // -------------------------------------------------------------------------

  /** Stage (or clear) the acting team's pending ban — not broadcast; the opponent only sees it once locked (R-003/R-009). */
  @SubscribeMessage('ban.select')
  async handleBanSelect(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: ChampionSelectDto,
  ): Promise<{ ok: true; championId: string | null }> {
    const { draftId, session, team } = await this.requireDraftContext(client);
    const turn = this.requireTurn(session, team, 'BAN');

    const championId = data.championId ?? null;
    if (championId) {
      this.validateBanChampion(session, championId);
    }

    await this.sessions.setPending(draftId, team, 'BAN', championId);
    return { ok: true, championId };
  }

  /**
   * Lock the pending ban: persists to session state + PostgreSQL, broadcasts
   * `ban.confirmed`, then hands the turn over to the TurnManager (T-009).
   */
  @SubscribeMessage('ban.lock')
  async handleBanLock(@ConnectedSocket() client: Socket): Promise<{
    ok: true;
    championId: string;
  }> {
    const { draftId, session, team } = await this.requireDraftContext(client);
    const turn = this.requireTurn(session, team, 'BAN');

    // A lock without a pending selection must not consume the turn: leave
    // the claim untouched so the running timer still resolves the turn.
    if (!session.pending[team]?.championId) {
      throw new WsException('No pending ban selection to lock');
    }

    // Exactly one of {this lock, the timer expiry} resolves the turn; a
    // lock racing the deadline is rejected here.
    if (!this.turnManager.claimTurnAction(draftId, turn.turnNumber)) {
      throw new WsException('Turn already resolved');
    }

    try {
      const { state, championId } = await this.sessions.confirmBan(draftId, team);
      if (!championId) {
        this.turnManager.releaseTurnAction(draftId, turn.turnNumber);
        throw new WsException('No pending ban selection to lock');
      }

      const phase = banPhaseOf(turnInfo(state.currentTurn).phase);
      await this.turnManager.persistBanRow(draftId, championId, team, phase);

      const payload: BanConfirmedPayload = {
        championId,
        team,
        phase,
        bans: state.bans,
      };
      this.broadcast(draftId, 'ban.confirmed', payload);
      this.broadcast(draftId, 'draft.update', state);

      this.logger.log(
        `ban.lock draft=${draftId} team=${team} champion=${championId} turn=${state.currentTurn}`,
      );
      // Stop the countdown and announce the next turn (turn.end/turn.start).
      await this.turnManager.handleActionCompleted(draftId);
      return { ok: true, championId };
    } catch (err) {
      // The claimed action itself failed (e.g. the Ban row could not be
      // persisted): free the turn so the still-running timer can resolve it.
      this.turnManager.releaseTurnAction(draftId, turn.turnNumber);
      throw err;
    }
  }

  /** Voluntary skip of the acting team's ban turn. */
  @SubscribeMessage('ban.skip')
  async handleBanSkip(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: ChampionSelectDto,
  ): Promise<{ ok: true }> {
    return this.handleSkip(client, data, 'BAN');
  }

  // -------------------------------------------------------------------------
  // Pick events
  // -------------------------------------------------------------------------

  /** Stage (or clear) the acting team's pending pick. */
  @SubscribeMessage('pick.select')
  async handlePickSelect(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: ChampionSelectDto,
  ): Promise<{ ok: true; championId: string | null }> {
    const { draftId, session, team } = await this.requireDraftContext(client);
    this.requireTurn(session, team, 'PICK');

    const championId = data.championId ?? null;
    if (championId) {
      this.validatePickChampion(session, championId);
    }

    await this.sessions.setPending(draftId, team, 'PICK', championId);
    return { ok: true, championId };
  }

  /**
   * Lock the pending pick: persists to session state + PostgreSQL, broadcasts
   * `pick.confirmed`, then hands the turn over to the TurnManager (T-010).
   */
  @SubscribeMessage('pick.lock')
  async handlePickLock(@ConnectedSocket() client: Socket): Promise<{
    ok: true;
    championId: string;
  }> {
    const { draftId, session, team } = await this.requireDraftContext(client);
    const turn = this.requireTurn(session, team, 'PICK');

    // A lock without a pending selection must not consume the turn: leave
    // the claim untouched so the running timer still resolves the turn.
    const pendingPick = session.pending[team]?.championId;
    if (!pendingPick) {
      throw new WsException('No pending pick selection to lock');
    }

    // Re-validate at lock time: a pick must never be committed against a
    // champion that is banned or already picked (R-006/R-011, DS-NF-003).
    this.validatePickChampion(session, pendingPick);

    // Exactly one of {this lock, the timer expiry} resolves the turn; a
    // lock racing the deadline is rejected here.
    if (!this.turnManager.claimTurnAction(draftId, turn.turnNumber)) {
      throw new WsException('Turn already resolved');
    }

    try {
      // Persist first so the live entry carries the Pick row id that
      // Finalization swaps address (T-014).
      const row = await this.turnManager.persistPickRow(
        draftId,
        pendingPick,
        team,
      );
      const { state, championId } = await this.sessions.confirmPick(
        draftId,
        team,
        row.id,
      );
      if (!championId) {
        // The pending selection vanished between persist and confirm (e.g. a
        // concurrent leave) — drop the just-created row so it cannot leak
        // into the draft history.
        await this.prisma.pick
          .delete({ where: { id: row.id } })
          .catch(() => undefined);
        this.turnManager.releaseTurnAction(draftId, turn.turnNumber);
        throw new WsException('No pending pick selection to lock');
      }

      const payload: PickConfirmedPayload = {
        championId,
        team,
        picks: state.picks,
      };
      this.broadcast(draftId, 'pick.confirmed', payload);
      this.broadcast(draftId, 'draft.update', state);

      this.logger.log(
        `pick.lock draft=${draftId} team=${team} champion=${championId} turn=${state.currentTurn}`,
      );
      // Stop the countdown and announce the next turn (turn.end/turn.start).
      await this.turnManager.handleActionCompleted(draftId);
      return { ok: true, championId };
    } catch (err) {
      // The claimed action itself failed (e.g. the Pick row could not be
      // persisted): free the turn so the still-running timer can resolve it.
      this.turnManager.releaseTurnAction(draftId, turn.turnNumber);
      throw err;
    }
  }

  /** Voluntary skip of the acting team's pick turn. */
  @SubscribeMessage('pick.skip')
  async handlePickSkip(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: ChampionSelectDto,
  ): Promise<{ ok: true }> {
    return this.handleSkip(client, data, 'PICK');
  }

  // -------------------------------------------------------------------------
  // Team-internal swap (Finalization phase, R-007)
  // -------------------------------------------------------------------------

  /**
   * Exchange two of the caller's own locked picks. Finalization swaps are
   * team-internal and immediate: the opponent is never asked to approve or
   * reject, and both clients receive the reordered list via `pick.reordered`.
   * Unlimited while the 60s timer runs.
   */
  @SubscribeMessage('pick.swap')
  async handlePickSwap(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: PickSwapDto,
  ): Promise<{ ok: true; picks: PickConfirmedEntry[] }> {
    const { draftId, session, team } = await this.requireDraftContext(client);
    this.requireFinalization(session);

    if (data.fromPickId === data.toPickId) {
      throw new WsException('Select two different picks to swap');
    }

    const rows = await this.prisma.pick.findMany({
      where: { id: { in: [data.fromPickId, data.toPickId] }, draftId },
    });
    const fromPick = rows.find((row) => row.id === data.fromPickId);
    const toPick = rows.find((row) => row.id === data.toPickId);
    if (!fromPick || !toPick) {
      throw new WsException('Picks not part of this draft');
    }
    // Team-internal only: both picks must belong to the caller's own team,
    // never the opponent's (R-007).
    if (fromPick.team !== team || toPick.team !== team) {
      throw new WsException('Can only swap picks within your own team');
    }
    if (!fromPick.locked || !toPick.locked) {
      throw new WsException('Only locked picks can be swapped');
    }

    // The per-team unique constraint on championId rejects a direct two-row
    // exchange mid-transaction; park the first row on a temporary id while
    // the two champions trade places.
    const temporaryChampionId = `__swap_${crypto.randomUUID()}`;
    await this.prisma.$transaction([
      this.prisma.pick.update({
        where: { id: fromPick.id },
        data: { championId: temporaryChampionId },
      }),
      this.prisma.pick.update({
        where: { id: toPick.id },
        data: { championId: fromPick.championId },
      }),
      this.prisma.pick.update({
        where: { id: fromPick.id },
        data: { championId: toPick.championId },
      }),
    ]);

    // Rebuild from the authoritative rows so both the live session and the
    // broadcast carry the new order (and row ids).
    const reordered = await this.prisma.pick.findMany({
      where: { draftId },
      orderBy: { id: 'asc' },
    });
    const picks: PickConfirmedEntry[] = reordered.map((row) => ({
      id: row.id,
      championId: row.championId,
      team: row.team as Team,
      locked: row.locked,
    }));
    const state = await this.sessions.replacePicks(draftId, picks);

    const payload: PickReorderedPayload = { picks };
    this.broadcast(draftId, 'pick.reordered', payload);
    this.broadcast(draftId, 'draft.update', state);

    this.logger.log(
      `pick.swap draft=${draftId} team=${team} from=${fromPick.id} to=${toPick.id}`,
    );
    return { ok: true, picks };
  }

  // -------------------------------------------------------------------------
  // Health
  // -------------------------------------------------------------------------

  /** Client latency probe; keeps `ConnectionHealthService` up to date. */
  @SubscribeMessage('health.ping')
  handleHealthPing(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: HealthPingPayload,
  ): { ok: true; serverTime: number; latencyMs: number | null } {
    const sentAt = typeof data?.sentAt === 'number' ? data.sentAt : null;
    const latencyMs =
      sentAt !== null ? Date.now() - sentAt : null;
    const recorded = this.health.recordPing(client.id, latencyMs);
    return { ok: true, serverTime: Date.now(), latencyMs: recorded };
  }

  // -------------------------------------------------------------------------
  // Cross-module API (draft creation flow, T-008)
  // -------------------------------------------------------------------------

  /**
   * Broadcast the authoritative session snapshot to a draft room. Used by
   * the HTTP draft flows — `DraftService` calls this when the second player
   * joins and the draft starts, so the waiting creator switches to the live
   * view without polling.
   */
  async broadcastDraftUpdate(draftId: number): Promise<void> {
    // syncWithRecord applies the record's status/fearless and persists them,
    // so a session created while the draft was waiting is upgraded to
    // IN_PROGRESS here (the timer relies on the persisted status).
    const session = await this.sessions.syncWithRecord(draftId);
    if (!session) {
      return;
    }
    this.broadcast(draftId, 'draft.update', session);
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private async handleSkip(
    client: Socket,
    data: ChampionSelectDto,
    action: 'BAN' | 'PICK',
  ): Promise<{ ok: true }> {
    const { draftId, session, team } = await this.requireDraftContext(client);
    const turn = this.requireTurn(session, team, action);
    void data;

    // A skip resolves the turn just like a lock or the timer expiry would.
    if (!this.turnManager.claimTurnAction(draftId, turn.turnNumber)) {
      throw new WsException('Turn already resolved');
    }

    try {
      const state = await this.sessions.recordSkip(draftId, team);
      this.broadcast(draftId, 'draft.update', state);
      this.logger.log(
        `${action.toLowerCase()}.skip draft=${draftId} team=${team} turn=${turn.turnNumber}`,
      );
      await this.turnManager.handleActionCompleted(draftId);
      return { ok: true };
    } catch (err) {
      this.turnManager.releaseTurnAction(draftId, turn.turnNumber);
      throw err;
    }
  }

  private requireUser(client: Socket): SocketUser {
    const user = client.data.user as SocketUser | undefined;
    if (!user) {
      throw new WsException('Socket is not authenticated');
    }
    return user;
  }

  /** True when the handshake carried credentials (which may still be invalid). */
  private hasHandshakeToken(client: Socket): boolean {
    const token = (client.handshake.auth?.token as string | undefined)?.trim();
    const header = client.handshake.headers?.authorization;
    return Boolean(token || (header && header.startsWith('Bearer ')));
  }

  /**
   * Emit a live event to both the participant room and the read-only public
   * room. Public viewers receive a sanitized snapshot for `draft.update` so
   * staged (pending) selections never leave the participants' room.
   */
  private broadcast(draftId: number, event: string, payload: unknown): void {
    this.server
      .to(draftRoom(draftId))
      .emit(event as never, payload as never);
    this.server
      .to(publicDraftRoom(draftId))
      .emit(event as never, publicBroadcastPayload(event, payload) as never);
  }

  /** Final results payload for a COMPLETE draft (reconnecting spectators). */
  private async completedPayload(
    draftId: number,
  ): Promise<DraftCompletedPayload> {
    const [draft, banRows, pickRows] = await Promise.all([
      this.prisma.draft.findUnique({ where: { id: draftId } }),
      this.prisma.ban.findMany({ where: { draftId }, orderBy: { id: 'asc' } }),
      this.prisma.pick.findMany({ where: { draftId }, orderBy: { id: 'asc' } }),
    ]);
    if (!draft) {
      throw new WsException('Draft not found');
    }

    const bans: BanConfirmedEntry[] = banRows.map((row) => ({
      championId: row.championId,
      team: row.team as Team,
      phase: row.phase as 1 | 2,
      locked: row.locked,
    }));
    const picks: PickConfirmedEntry[] = pickRows.map((row) => ({
      id: row.id,
      championId: row.championId,
      team: row.team as Team,
      locked: row.locked,
    }));

    return {
      draftId,
      code: draft.code,
      completedAt: (draft.completedAt ?? new Date()).toISOString(),
      picks,
      bans,
    };
  }

  private teamOf(
    bluePlayerId: number | null,
    redPlayerId: number | null,
    user: SocketUser,
  ): Team {
    if (bluePlayerId === user.id) {
      return 'BLUE';
    }
    if (redPlayerId === user.id) {
      return 'RED';
    }
    throw new WsException('You are not a participant of this draft');
  }

  /** Load the draft row by its public code (404-style feedback for bad codes). */
  private async prismaDraftByCode(code: string) {
    const draft = await this.prisma.draft.findUnique({ where: { code } });
    if (!draft) {
      throw new WsException('Draft not found');
    }
    return draft;
  }

  /** Joined-room context: fresh draft row + live session + the caller's team. */
  private async requireDraftContext(client: Socket): Promise<{
    draftId: number;
    session: DraftSessionState;
    team: Team;
    user: SocketUser;
  }> {
    const user = this.requireUser(client);
    const draftId = client.data.draftId as number | undefined;
    if (!draftId) {
      throw new WsException('Join a draft room first (draft.join)');
    }

    const draft = await this.prisma.draft.findUnique({ where: { id: draftId } });
    if (!draft) {
      throw new WsException('Draft no longer exists');
    }

    const team = this.teamOf(draft.blueTeamPlayerId, draft.redTeamPlayerId, user);
    const session = await this.sessions.getOrCreate(draftId);
    this.applyRecordStatus(session, draft.status, draft.fearlessMode);
    return { draftId, session, team, user };
  }

  /** All selection actions require an in-progress draft and the acting team's turn. */
  private requireTurn(
    session: DraftSessionState,
    team: Team,
    action: 'BAN' | 'PICK',
  ): ReturnType<typeof turnInfo> {
    if (session.status !== 'IN_PROGRESS') {
      throw new WsException('Draft has not started yet');
    }
    const turn = turnInfo(session.currentTurn);
    if (turn.actionType !== action) {
      throw new WsException(`Current turn is a ${turn.actionType} turn`);
    }
    if (turn.expectedTeam !== team) {
      throw new WsException('Not your turn');
    }
    return turn;
  }

  private requireFinalization(session: DraftSessionState): void {
    if (session.status !== 'IN_PROGRESS') {
      throw new WsException('Draft has not started yet');
    }
    if (turnInfo(session.currentTurn).phase !== 'FINALIZATION') {
      throw new WsException('Swaps are only available during Finalization');
    }
  }

  /** Ban pool rules: never re-ban; picked champions may be banned unless Fearless (R-005). */
  private validateBanChampion(
    session: DraftSessionState,
    championId: string,
  ): void {
    if (session.bans.some((b) => b.championId === championId)) {
      throw new WsException('Champion already banned');
    }
    if (
      session.fearlessMode &&
      session.picks.some((p) => p.championId === championId)
    ) {
      throw new WsException('Champion already picked');
    }
  }

  /** Pick pool rules: banned champions and already-picked champions are out (R-011). */
  private validatePickChampion(
    session: DraftSessionState,
    championId: string,
  ): void {
    if (session.bans.some((b) => b.championId === championId)) {
      throw new WsException('Champion is banned');
    }
    if (session.picks.some((p) => p.championId === championId)) {
      throw new WsException('Champion already picked');
    }
  }

  /** Keep volatile fields (status/fearless) in sync with the draft record. */
  private applyRecordStatus(
    session: DraftSessionState,
    status: string,
    fearlessMode: boolean,
  ): void {
    session.status = status;
    session.fearlessMode = fearlessMode;
  }

  // -------------------------------------------------------------------------
  // Presence + reconnection grace period (R-013, T-008)
  // -------------------------------------------------------------------------

  /** Record a socket as present in a draft room; voids any grace timer. */
  private trackPresence(
    draftId: number,
    userId: number,
    socketId: string,
  ): void {
    let users = this.draftPresence.get(draftId);
    if (!users) {
      users = new Map();
      this.draftPresence.set(draftId, users);
    }
    let sockets = users.get(userId);
    if (!sockets) {
      sockets = new Set();
      users.set(userId, sockets);
    }
    sockets.add(socketId);

    // The player is back — any pending reconnection grace window is void.
    this.cancelGraceTimer(draftId, userId);
  }

  /** Remove one socket from a draft room's presence map. */
  private untrackPresence(
    draftId: number,
    userId: number,
    socketId: string,
  ): void {
    const users = this.draftPresence.get(draftId);
    const sockets = users?.get(userId);
    if (!sockets) {
      return;
    }
    sockets.delete(socketId);
    if (sockets.size === 0) {
      users?.delete(userId);
    }
    if (users && users.size === 0) {
      this.draftPresence.delete(draftId);
    }
  }

  private hasPresence(draftId: number, userId: number): boolean {
    return (this.draftPresence.get(draftId)?.get(userId)?.size ?? 0) > 0;
  }

  /**
   * A participant socket dropped. While the user still has sockets in the
   * room (other tabs/devices) nothing changes; once their last socket is
   * gone the reconnection grace period starts — if they do not return, the
   * draft expires (R-013: "player disconnected 30s+ cannot recover draft").
   */
  private onParticipantSocketLost(
    draftId: number,
    userId: number,
    socketId: string,
  ): void {
    this.untrackPresence(draftId, userId, socketId);
    if (this.hasPresence(draftId, userId)) {
      return;
    }
    this.startGraceTimer(draftId, userId);
  }

  private startGraceTimer(draftId: number, userId: number): void {
    this.cancelGraceTimer(draftId, userId);
    const graceSeconds = Math.round(this.gracePeriodMs / 1000);
    const timer = setTimeout(() => {
      this.graceTimers.get(draftId)?.delete(userId);
      void this.expireDraft(
        draftId,
        userId,
        `A player was disconnected for more than ${graceSeconds}s`,
      );
    }, this.gracePeriodMs);
    // A pending grace window must not keep the process alive on shutdown.
    timer.unref();

    let users = this.graceTimers.get(draftId);
    if (!users) {
      users = new Map();
      this.graceTimers.set(draftId, users);
    }
    users.set(userId, timer);
    this.logger.log(
      `grace.start draft=${draftId} user=${userId} expiresInMs=${this.gracePeriodMs}`,
    );
  }

  private cancelGraceTimer(draftId: number, userId: number): void {
    const timers = this.graceTimers.get(draftId);
    const timer = timers?.get(userId);
    if (timer) {
      clearTimeout(timer);
      timers?.delete(userId);
    }
  }

  private clearDraftTimers(draftId: number): void {
    const timers = this.graceTimers.get(draftId);
    if (!timers) {
      return;
    }
    for (const timer of timers.values()) {
      clearTimeout(timer);
    }
    this.graceTimers.delete(draftId);
  }

  /**
   * Expire an in-progress draft after the reconnection grace period elapsed
   * without the player returning (R-013 / EC-001): mark the row EXPIRED,
   * drop the live Redis session and tell the room on `draft.expired`.
   */
  private async expireDraft(
    draftId: number,
    userId: number,
    reason: string,
  ): Promise<void> {
    // Reconnected in the final instant — nothing to expire.
    if (this.hasPresence(draftId, userId)) {
      return;
    }

    // Atomically move IN_PROGRESS → EXPIRED; completed drafts and already
    // expired drafts (concurrent timer) no-op.
    const expired = await this.prisma.draft.updateMany({
      where: { id: draftId, status: 'IN_PROGRESS' },
      data: { status: 'EXPIRED', completedAt: new Date() },
    });
    if (expired.count === 0) {
      return;
    }

    await this.sessions.deleteSession(draftId);
    // A dead draft's turn countdown must not keep firing (T-009).
    this.turnManager.clearTimers(draftId);
    const payload: DraftExpiredPayload = { reason };
    this.broadcast(draftId, 'draft.expired', payload);
    this.logger.log(`draft.expired draft=${draftId} reason="${reason}"`);

    // Both players may have a timer pending; the draft is over either way.
    this.clearDraftTimers(draftId);
  }
}
