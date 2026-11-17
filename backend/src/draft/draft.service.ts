import * as crypto from 'crypto';
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DraftEventsGateway } from '../draft-events/draft-events.gateway';
import { DraftSessionService } from '../draft-events/draft-session.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDraftDto, DraftSide } from './dto/create-draft.dto';
import { JoinDraftDto } from './dto/join-draft.dto';
import type {
  CreateDraftResponse,
  DraftView,
  JoinDraftResponse,
} from './draft.types';

/**
 * Draft room creation flow (T-008).
 *
 * - POST create: unique 7-character code, creator claims a side, the row is
 *   persisted as WAITING_FOR_PLAYERS.
 * - POST join: atomic first-come-first-served side claim (a single
 *   conditional UPDATE — simultaneous joiners cannot both win a side), the
 *   second arrival fills both sides and starts the draft (turn 1).
 * - Lazy cleanup: a waiting draft nobody joined within 5 minutes is
 *   hard-deleted on the next read, so stale codes resolve to 404 (EC-004:
 *   no information leaked about expired drafts).
 *
 * The 30-second reconnection grace period for in-progress drafts lives in
 * DraftEventsGateway (R-013) — it needs socket room access to notify players.
 */

/** Code alphabet: ambiguous glyphs (I, L, O, 0, 1) are excluded. */
const DRAFT_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const DRAFT_CODE_LENGTH = 7;
/** Retries for code collisions (both pre-check misses and P2002 races). */
const DRAFT_CODE_MAX_ATTEMPTS = 5;

/** A waiting draft with no second player is cleaned up after 5 minutes. */
const WAITING_DRAFT_TTL_MS = 5 * 60 * 1000;

/** Participant usernames resolved alongside the draft row. */
const DRAFT_INCLUDE = {
  blueTeamPlayer: { select: { id: true, username: true } },
  redTeamPlayer: { select: { id: true, username: true } },
} satisfies Prisma.DraftInclude;

type DraftWithPlayers = Prisma.DraftGetPayload<{ include: typeof DRAFT_INCLUDE }>;

@Injectable()
export class DraftService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: DraftSessionService,
    private readonly gateway: DraftEventsGateway,
  ) {}

  /** Create a waiting draft; the creator claims their side immediately. */
  async create(userId: number, dto: CreateDraftDto): Promise<CreateDraftResponse> {
    const side: DraftSide = dto.side ?? 'BLUE';

    for (let attempt = 0; attempt < DRAFT_CODE_MAX_ATTEMPTS; attempt++) {
      const code = this.randomCode();

      // Fast path: skip codes that already exist (edge case: duplicate code).
      const existing = await this.prisma.draft.findUnique({ where: { code } });
      if (existing) {
        continue;
      }

      try {
        await this.prisma.draft.create({
          data: {
            code,
            status: 'WAITING_FOR_PLAYERS',
            ...(side === 'BLUE'
              ? { blueTeamPlayerId: userId }
              : { redTeamPlayerId: userId }),
          },
        });
      } catch (err) {
        // Concurrent creator won the code race — try a fresh one.
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002'
        ) {
          continue;
        }
        throw err;
      }

      return {
        code,
        status: 'WAITING_FOR_PLAYERS',
        message: 'Draft created. Send this code to your opponent.',
      };
    }

    throw new Error('Could not generate a unique draft code');
  }

  /** Draft lookup for the room page (participants, status). */
  async getByCode(code: string): Promise<DraftView> {
    return this.toView(await this.findLiveDraftOrThrow(code));
  }

  /**
   * Claim the free side (first-come first-served) and start the draft when
   * both sides are filled. Re-joins by existing participants are idempotent.
   */
  async join(
    userId: number,
    code: string,
    dto: JoinDraftDto,
  ): Promise<JoinDraftResponse> {
    const draft = await this.findLiveDraftOrThrow(code);

    // Idempotent re-join (page refresh / returning opponent).
    if (draft.blueTeamPlayerId === userId || draft.redTeamPlayerId === userId) {
      return {
        draft: this.toView(draft),
        team: draft.blueTeamPlayerId === userId ? 'BLUE' : 'RED',
        started: false,
      };
    }

    if (draft.status !== 'WAITING_FOR_PLAYERS') {
      throw new ConflictException('This draft is not accepting players');
    }

    const requested: DraftSide = dto.side ?? this.freeSideOf(draft) ?? 'RED';
    const sideTaken =
      requested === 'BLUE' ? draft.blueTeamPlayerId : draft.redTeamPlayerId;
    if (sideTaken !== null) {
      throw new ConflictException(`The ${requested} side is already taken`);
    }

    // Atomic claim: one conditional UPDATE decides the race, so two
    // simultaneous joiners can never both claim the same side.
    const claim = await this.prisma.draft.updateMany({
      where: {
        id: draft.id,
        status: 'WAITING_FOR_PLAYERS',
        ...(requested === 'BLUE'
          ? { blueTeamPlayerId: null }
          : { redTeamPlayerId: null }),
      },
      data:
        requested === 'BLUE'
          ? { blueTeamPlayerId: userId }
          : { redTeamPlayerId: userId },
    });

    if (claim.count === 0) {
      // Lost the side race — unless a concurrent claim was our own re-join.
      const fresh = await this.prisma.draft.findUnique({
        where: { id: draft.id },
        include: DRAFT_INCLUDE,
      });
      if (
        fresh &&
        (fresh.blueTeamPlayerId === userId || fresh.redTeamPlayerId === userId)
      ) {
        return {
          draft: this.toView(fresh),
          team: fresh.blueTeamPlayerId === userId ? 'BLUE' : 'RED',
          started: false,
        };
      }
      throw new ConflictException(`The ${requested} side is already taken`);
    }

    // Draft starts as soon as both sides are filled (spec: Draft Start Flow).
    const full =
      requested === 'BLUE'
        ? draft.redTeamPlayerId !== null
        : draft.blueTeamPlayerId !== null;

    if (!full) {
      const fresh = await this.prisma.draft.findUniqueOrThrow({
        where: { id: draft.id },
        include: DRAFT_INCLUDE,
      });
      return { draft: this.toView(fresh), team: requested, started: false };
    }

    const start = await this.prisma.draft.updateMany({
      where: { id: draft.id, status: 'WAITING_FOR_PLAYERS' },
      data: { status: 'IN_PROGRESS', currentTurn: 1 },
    });
    const final = await this.prisma.draft.findUniqueOrThrow({
      where: { id: draft.id },
      include: DRAFT_INCLUDE,
    });

    if (start.count === 1) {
      // Push the fresh IN_PROGRESS snapshot to everyone already in the room
      // (the waiting creator), so their UI switches from "waiting" to live.
      await this.gateway.broadcastDraftUpdate(draft.id);
    }

    return {
      draft: this.toView(final),
      team: requested,
      started: start.count === 1,
    };
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /**
   * Resolve a joinable/viewable draft by code. Expired and stale waiting
   * drafts resolve to 404 with a generic message (EC-004), after lazily
   * cleaning the stale row up.
   */
  private async findLiveDraftOrThrow(code: string): Promise<DraftWithPlayers> {
    const draft = await this.prisma.draft.findUnique({
      where: { code },
      include: DRAFT_INCLUDE,
    });
    if (!draft || draft.status === 'EXPIRED') {
      throw new NotFoundException('Draft not found');
    }
    if (
      draft.status === 'WAITING_FOR_PLAYERS' &&
      Date.now() - draft.createdAt.getTime() > WAITING_DRAFT_TTL_MS
    ) {
      await this.hardDeleteDraft(draft.id);
      throw new NotFoundException('Draft not found');
    }
    return draft;
  }

  /**
   * Hard-delete a draft row and its live session. Bans/picks cascade in the
   * schema; a missing row (concurrent cleanup) is ignored.
   */
  private async hardDeleteDraft(draftId: number): Promise<void> {
    await this.prisma.draft.delete({ where: { id: draftId } }).catch(() => undefined);
    await this.sessions.deleteSession(draftId);
  }

  /** The only free side of a waiting draft, or null when both are taken. */
  private freeSideOf(draft: {
    blueTeamPlayerId: number | null;
    redTeamPlayerId: number | null;
  }): DraftSide | null {
    if (draft.blueTeamPlayerId === null) {
      return 'BLUE';
    }
    if (draft.redTeamPlayerId === null) {
      return 'RED';
    }
    return null;
  }

  private toView(draft: DraftWithPlayers): DraftView {
    return {
      id: draft.id,
      code: draft.code,
      status: draft.status,
      fearlessMode: draft.fearlessMode,
      currentTurn: draft.currentTurn,
      bluePlayer: draft.blueTeamPlayer
        ? {
            id: draft.blueTeamPlayer.id,
            username: draft.blueTeamPlayer.username,
          }
        : null,
      redPlayer: draft.redTeamPlayer
        ? {
            id: draft.redTeamPlayer.id,
            username: draft.redTeamPlayer.username,
          }
        : null,
      createdAt: draft.createdAt.toISOString(),
    };
  }

  /** Uniformly random code from the unambiguous alphabet. */
  private randomCode(): string {
    let code = '';
    for (let i = 0; i < DRAFT_CODE_LENGTH; i++) {
      code += DRAFT_CODE_ALPHABET[crypto.randomInt(DRAFT_CODE_ALPHABET.length)];
    }
    return code;
  }
}
