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
import {
  banPhaseOf,
  initialTurnPayload,
  turnInfo,
} from './turn-schedule';
import {
  draftRoom,
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
 * - Ban/pick PostgreSQL persistence and `ban.confirmed` DB sync arrive in
 *   T-009; turn timers, auto-lock and turn advancement arrive in T-011
 *   (TurnManager); actual pick ownership swaps arrive in T-010. This gateway
 *   maintains the Redis live-session state those tasks build upon.
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

  constructor(
    private readonly wsJwtGuard: WsJwtGuard,
    private readonly prisma: PrismaService,
    private readonly sessions: DraftSessionService,
    private readonly health: ConnectionHealthService,
  ) {}

  // -------------------------------------------------------------------------
  // Connection lifecycle
  // -------------------------------------------------------------------------

  afterInit(): void {
    this.health.startPeriodicLogging();
    this.logger.log('Draft events gateway initialised');
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

    // Current turn snapshot to the whole room: doubles as the reconnection
    // state refresh for the opponent (R-013).
    this.server
      .to(draftRoom(draft.id))
      .emit('turn.start', initialTurnPayload(session.currentTurn) as TurnStartPayload);
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

  /** Lock the pending ban: persists to session state and broadcasts `ban.confirmed`. */
  @SubscribeMessage('ban.lock')
  async handleBanLock(@ConnectedSocket() client: Socket): Promise<{
    ok: true;
    championId: string;
  }> {
    const { draftId, team } = await this.requireDraftContext(client);
    await this.requireTurn(
      await this.sessions.getOrCreate(draftId),
      team,
      'BAN',
    );

    const { state, championId } = await this.sessions.confirmBan(draftId, team);
    if (!championId) {
      throw new WsException('No pending ban selection to lock');
    }

    const phase = banPhaseOf(turnInfo(state.currentTurn).phase);
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
    // Turn advancement / next `turn.start` is emitted by TurnManager (T-011).
    return { ok: true, championId };
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

  /** Lock the pending pick: persists to session state and broadcasts `pick.confirmed`. */
  @SubscribeMessage('pick.lock')
  async handlePickLock(@ConnectedSocket() client: Socket): Promise<{
    ok: true;
    championId: string;
  }> {
    const { draftId, team } = await this.requireDraftContext(client);
    const session = await this.sessions.getOrCreate(draftId);
    this.requireTurn(session, team, 'PICK');

    const { state, championId } = await this.sessions.confirmPick(draftId, team);
    if (!championId) {
      throw new WsException('No pending pick selection to lock');
    }

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
    return { ok: true, championId };
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
  // Helpers
  // -------------------------------------------------------------------------

  private async handleSkip(
    client: Socket,
    data: ChampionSelectDto,
    action: 'BAN' | 'PICK',
  ): Promise<{ ok: true }> {
    const { draftId, session, team } = await this.requireDraftContext(client);
    this.requireTurn(session, team, action);
    void data;

    const state = await this.sessions.recordSkip(draftId, team);
    this.server
      .to(draftRoom(draftId))
      .emit('draft.update', state as unknown as Record<string, unknown>);
    this.logger.log(`${action.toLowerCase()}.skip draft=${draftId} team=${team}`);
    return { ok: true };
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
}

interface SwapResolvedAck {
  ok: true;
  request: SwapRequestEntry;
  approved: boolean;
}
