import { Logger, UseFilters, UsePipes, ValidationPipe } from '@nestjs/common';
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
  DraftExpiredPayload,
  HealthPingPayload,
  PickConfirmedPayload,
  BanConfirmedPayload,
  SocketUser,
  SwapResolvedPayload,
  SwapRequestEntry,
  Team,
  TurnStartPayload,
  userRoom,
} from './socket-events';
import { ChampionSelectDto } from './dto/champion-select.dto';
import { DraftJoinDto } from './dto/draft-join.dto';
import { SwapDecisionDto, SwapRequestDto } from './dto/swap.dto';
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
 * - Validate and route draft actions: `ban.*`, `pick.*`, `swap.*`.
 * - Connection health monitoring via `ConnectionHealthService`.
 *
 * Scope notes (per the task breakdown):
 * - Ban/pick PostgreSQL persistence and `ban.confirmed`/`pick.confirmed`
 *   broadcast, the 30s turn timer, auto-lock and turn advancement are handled
 *   by T-009/T-010 (TurnManager); actual pick ownership swaps arrive in T-014. This gateway maintains the
 *   Redis live-session state those tasks build upon.
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
   * Authenticate at handshake time; unauthenticated sockets are told why via
   * `auth.error` and disconnected immediately.
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
    if (client.data.draftId) {
      throw new WsException('Already in a draft room — leave it first');
    }

    const draft = await this.prismaDraftByCode(data.code);
    const team = this.teamOf(draft.blueTeamPlayerId, draft.redTeamPlayerId, user);
    if (data.team && data.team !== team) {
      throw new WsException(`You are assigned to the ${team} side`);
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
    this.server
      .to(draftRoom(draft.id))
      .emit('turn.start', turnPayload as unknown as TurnStartPayload);
    this.server
      .to(draftRoom(draft.id))
      .emit('draft.update', session as unknown as Record<string, unknown>);

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

    this.untrackPresence(draftId, user.id, client.id);

    const draft = await this.prisma.draft.findUnique({ where: { id: draftId } });
    if (draft) {
      const team = this.teamOf(
        draft.blueTeamPlayerId,
        draft.redTeamPlayerId,
        user,
      );
      await this.sessions.clearPending(draftId, team);
      await client.leave(draftRoom(draftId));
      this.health.detachFromDraft(client.id, draftId);
    }

    delete client.data.draftId;
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
      this.server
        .to(draftRoom(draftId))
        .emit('ban.confirmed', payload as unknown as Record<string, unknown>);
      this.server
        .to(draftRoom(draftId))
        .emit('draft.update', state as unknown as Record<string, unknown>);

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
    if (!session.pending[team]?.championId) {
      throw new WsException('No pending pick selection to lock');
    }

    // Exactly one of {this lock, the timer expiry} resolves the turn; a
    // lock racing the deadline is rejected here.
    if (!this.turnManager.claimTurnAction(draftId, turn.turnNumber)) {
      throw new WsException('Turn already resolved');
    }

    try {
      const { state, championId } = await this.sessions.confirmPick(draftId, team);
      if (!championId) {
        this.turnManager.releaseTurnAction(draftId, turn.turnNumber);
        throw new WsException('No pending pick selection to lock');
      }

      await this.turnManager.persistPickRow(draftId, championId, team);

      const payload: PickConfirmedPayload = {
        championId,
        team,
        picks: state.picks,
      };
      this.server
        .to(draftRoom(draftId))
        .emit('pick.confirmed', payload as unknown as Record<string, unknown>);
      this.server
        .to(draftRoom(draftId))
        .emit('draft.update', state as unknown as Record<string, unknown>);

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
  // Swap events (Finalization phase, R-007)
  // -------------------------------------------------------------------------

  /** Request to trade the requester's locked pick for an opponent pick. */
  @SubscribeMessage('swap.request')
  async handleSwapRequest(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: SwapRequestDto,
  ): Promise<{ ok: true; request: SwapRequestEntry }> {
    const { draftId, session, team, user } = await this.requireDraftContext(
      client,
    );
    this.requireFinalization(session);

    const myPick = session.picks.find(
      (p) => p.team === team && p.championId === data.proposedSwapWith,
    );
    const opponentTeam: Team = team === 'BLUE' ? 'RED' : 'BLUE';
    const theirPick = session.picks.find(
      (p) => p.team === opponentTeam && p.championId === data.targetChampionId,
    );
    if (!myPick || !theirPick) {
      throw new WsException(
        'Swap requires one locked pick from each team',
      );
    }

    const request = await this.sessions.addSwapRequest(
      draftId,
      team,
      user.id,
      data.proposedSwapWith,
      data.targetChampionId,
    );
    this.server
      .to(draftRoom(draftId))
      .emit('swap.requested', request as unknown as Record<string, unknown>);
    return { ok: true, request };
  }

  /** Opponent approves a pending swap (ownership transfer is applied in T-010). */
  @SubscribeMessage('swap.approve')
  async handleSwapApprove(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: SwapDecisionDto,
  ): Promise<SwapResolvedAck> {
    return this.resolveSwap(client, data, true);
  }

  /** Opponent rejects a pending swap. */
  @SubscribeMessage('swap.reject')
  async handleSwapReject(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: SwapDecisionDto,
  ): Promise<SwapResolvedAck> {
    return this.resolveSwap(client, data, false);
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
    this.server
      .to(draftRoom(draftId))
      .emit('draft.update', session as unknown as Record<string, unknown>);
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
      this.server
        .to(draftRoom(draftId))
        .emit('draft.update', state as unknown as Record<string, unknown>);
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

  private async resolveSwap(
    client: Socket,
    data: SwapDecisionDto,
    approved: boolean,
  ): Promise<SwapResolvedAck> {
    const { draftId, session, team } = await this.requireDraftContext(client);
    this.requireFinalization(session);

    const entry = session.swapRequests.find((r) => r.id === data.requestId);
    if (!entry) {
      throw new WsException('Swap request not found');
    }
    if (entry.status !== 'PENDING') {
      throw new WsException('Swap request already resolved');
    }
    if (entry.requesterTeam === team) {
      throw new WsException('Only the opponent can decide a swap request');
    }

    const request = await this.sessions.resolveSwapRequest(
      draftId,
      data.requestId,
      team,
      approved,
    );
    if (!request) {
      throw new WsException('Swap request could not be resolved');
    }

    const payload: SwapResolvedPayload = { request, approved };
    this.server
      .to(draftRoom(draftId))
      .emit('swap.resolved', payload as unknown as Record<string, unknown>);
    return { ok: true, request, approved };
  }

  private requireUser(client: Socket): SocketUser {
    const user = client.data.user as SocketUser | undefined;
    if (!user) {
      throw new WsException('Socket is not authenticated');
    }
    return user;
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
    this.server
      .to(draftRoom(draftId))
      .emit('draft.expired', payload as unknown as Record<string, unknown>);
    this.logger.log(`draft.expired draft=${draftId} reason="${reason}"`);

    // Both players may have a timer pending; the draft is over either way.
    this.clearDraftTimers(draftId);
  }
}

interface SwapResolvedAck {
  ok: true;
  request: SwapRequestEntry;
  approved: boolean;
}
