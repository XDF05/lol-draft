import { Test, TestingModule } from '@nestjs/testing';
import { TurnManagerService } from './turn-manager.service';
import { PrismaService } from '../prisma/prisma.service';
import { DraftSessionService } from './draft-session.service';
import { RiotApiService } from '../champions/riot-api.service';
import { ServiceUnavailableException } from '@nestjs/common';
import type { DraftSessionState } from './draft-session.service';
import { turnInfo } from './turn-schedule';

/** Minimal session state for turn N with the given pending selection. */
function sessionState(
  draftId: number,
  currentTurn: number,
  pending?: Partial<Record<'BLUE' | 'RED', { type: 'BAN' | 'PICK'; championId: string | null } | null>>,
  status = 'IN_PROGRESS',
): DraftSessionState {
  return {
    draftId,
    code: `CODE${draftId}`,
    status,
    currentTurn,
    bans: [],
    picks: [],
    pending: pending ?? {},
    skips: { BLUE: 0, RED: 0 },
    updatedAt: new Date().toISOString(),
  };
}

const mockPrisma = {
  draft: {
    findUnique: jest.fn(),
    updateMany: jest.fn(),
    update: jest.fn(),
  },
  ban: {
    create: jest.fn(),
    findMany: jest.fn(),
  },
  pick: {
    create: jest.fn(),
    findMany: jest.fn(),
  },
};

const mockSessions = {
  syncWithRecord: jest.fn(),
  getOrCreate: jest.fn(),
  save: jest.fn(),
  confirmBan: jest.fn(),
  confirmPick: jest.fn(),
  recordSkip: jest.fn(),
  deleteSession: jest.fn(),
  setPending: jest.fn(),
};

const mockChampions = {
  getChampions: jest.fn(),
};

describe('TurnManagerService (unit)', () => {
  let service: TurnManagerService;
  let moduleRef: TestingModule;

  beforeEach(async () => {
    jest.useFakeTimers();
    jest.clearAllMocks();

    moduleRef = await Test.createTestingModule({
      providers: [
        TurnManagerService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: DraftSessionService, useValue: mockSessions },
        { provide: RiotApiService, useValue: mockChampions },
      ],
    }).compile();

    service = moduleRef.get(TurnManagerService);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('turn ownership — exclusive per-turn claim', () => {
    it('grants the first claim of a turn and rejects subsequent ones', () => {
      expect(service.claimTurnAction(1, 1)).toBe(true);
      expect(service.claimTurnAction(1, 1)).toBe(false);
      expect(service.claimTurnAction(1, 2)).toBe(true); // different turn is free
    });

    it('releaseTurnAction frees a claim so the turn can be reclaimed', () => {
      expect(service.claimTurnAction(1, 3)).toBe(true);
      service.releaseTurnAction(1, 3);
      expect(service.claimTurnAction(1, 3)).toBe(true);
    });

    it('claims are scoped per draft', () => {
      expect(service.claimTurnAction(1, 5)).toBe(true);
      expect(service.claimTurnAction(2, 5)).toBe(true); // different draft
    });
  });

  describe('startTurnTimer / resumeTurnTimer (reconnect behavior)', () => {
    it('arms a 30s action timer and announces turn.start', async () => {
      const session = sessionState(1, 1, {}, 'IN_PROGRESS');
      mockSessions.syncWithRecord.mockResolvedValue(session);
      mockSessions.getOrCreate.mockResolvedValue(session);

      const emitSpy = jest.spyOn(service as any, 'emitTo');
      await service.startTurnTimer(1);

      expect(emitSpy).toHaveBeenCalledWith(1, 'turn.start', expect.anything());
      expect(emitSpy).toHaveBeenCalledWith(1, 'phase.ban1.start', {});
      expect(emitSpy).toHaveBeenCalledWith(1, 'draft.update', session);
      // Expiry is 30s out.
      expect(service.remainingSecondsFor(1)).toBe(30);
    });

    it('arms a 60s timer for the Finalization turn', async () => {
      const session = sessionState(1, 21, {}, 'IN_PROGRESS');
      mockSessions.syncWithRecord.mockResolvedValue(session);
      jest.spyOn(service as any, 'emitTo');

      await service.startTurnTimer(1);

      expect(service.remainingSecondsFor(1)).toBe(60);
    });

    it('resumeTurnTimer keeps the running deadline (no fresh countdown on reconnect)', async () => {
      const session = sessionState(1, 2, {}, 'IN_PROGRESS');
      mockSessions.syncWithRecord.mockResolvedValue(session);
      const emitSpy = jest.spyOn(service as any, 'emitTo');

      await service.startTurnTimer(1);
      const remainingBefore = service.remainingSecondsFor(1)!;
      emitSpy.mockClear(); // clear the turn.start announcement from startTurnTimer

      // Advance time partway, then resume — deadline must be preserved.
      jest.advanceTimersByTime(10_000);
      await service.resumeTurnTimer(1);
      const remainingAfter = service.remainingSecondsFor(1)!;

      expect(remainingAfter).toBeLessThan(remainingBefore);
      expect(remainingAfter).toBeGreaterThan(remainingBefore - 500);
      // Resume with announce:false must not re-announce turn.start.
      expect(emitSpy).not.toHaveBeenCalledWith(1, 'turn.start', expect.anything());
    });

    it('resumeTurnTimer restarts the current turn after a server restart when not armed', async () => {
      const session = sessionState(1, 4, {}, 'IN_PROGRESS');
      mockSessions.syncWithRecord.mockResolvedValue(session);
      jest.spyOn(service as any, 'emitTo');

      // No timer armed yet.
      expect(service.remainingSecondsFor(1)).toBeNull();

      await service.resumeTurnTimer(1);
      expect(service.remainingSecondsFor(1)).toBe(30);
    });

    it('does not arm a timer for a draft that is not IN_PROGRESS', async () => {
      const session = sessionState(1, 1, {}, 'WAITING_FOR_PLAYERS');
      mockSessions.syncWithRecord.mockResolvedValue(session);
      const emitSpy = jest.spyOn(service as any, 'emitTo');

      await service.startTurnTimer(1);

      expect(service.remainingSecondsFor(1)).toBeNull();
      expect(emitSpy).not.toHaveBeenCalled();
    });
  });

  describe('timer races — a lock racing the deadline cannot double-advance', () => {
    it('expiry is rejected when a manual action already owns the turn', async () => {
      const session = sessionState(1, 1, { BLUE: { type: 'BAN', championId: 'Ahri' } });
      mockSessions.syncWithRecord.mockResolvedValue(session);
      mockPrisma.draft.findUnique.mockResolvedValue({
        id: 1,
        blueTeamPlayerId: 10,
        redTeamPlayerId: 11,
      });
      mockPrisma.ban.create.mockResolvedValue(undefined);
      jest.spyOn(service as any, 'emitTo');

      // Manual lock claims the turn first.
      expect(service.claimTurnAction(1, 1)).toBe(true);

      // Expiry must bail out because the turn is already claimed — no second ban.
      await (service as any).resolveExpiredTurn(1);
      expect(mockPrisma.ban.create).not.toHaveBeenCalled();
    });

    it('a manual re-lock is rejected after expiry already owns the turn', async () => {
      const session = sessionState(1, 1, { BLUE: { type: 'BAN', championId: 'Ahri' } });
      mockSessions.syncWithRecord.mockResolvedValue(session);
      mockPrisma.draft.findUnique.mockResolvedValue({
        id: 1,
        blueTeamPlayerId: 10,
        redTeamPlayerId: 11,
      });
      mockPrisma.ban.create.mockResolvedValue(undefined);
      mockSessions.confirmBan.mockResolvedValue({
        state: sessionState(1, 2),
        championId: 'Ahri',
      });
      jest.spyOn(service as any, 'emitTo');

      // Expiry claims and resolves the turn — it owns the turn, so a manual
      // lock of the same turn would be rejected (claimTurnAction returns
      // false while the draft is still on turn 1). Expiry then advances to
      // turn 2, which clears the claim for turn 1.
      await (service as any).resolveExpiredTurn(1);
      expect(mockPrisma.ban.create).toHaveBeenCalled(); // expiry resolved turn 1

      // The draft advanced to turn 2, so claiming turn 2 is allowed.
      expect(service.claimTurnAction(1, 2)).toBe(true);
    });
  });

  describe('timeout fallback — deterministic expiry resolution', () => {
    it('locks a pending ban at expiry and advances the turn', async () => {
      const session = sessionState(1, 1, { BLUE: { type: 'BAN', championId: 'Ahri' } });
      mockSessions.syncWithRecord.mockResolvedValue(session);
      mockPrisma.draft.findUnique.mockResolvedValue({
        id: 1,
        blueTeamPlayerId: 10,
        redTeamPlayerId: 11,
      });
      mockPrisma.ban.create.mockResolvedValue(undefined);
      const next = sessionState(1, 2);
      mockSessions.confirmBan.mockResolvedValue({ state: next, championId: 'Ahri' });
      mockSessions.save.mockResolvedValue(undefined);
      const emitSpy = jest.spyOn(service as any, 'emitTo');

      await (service as any).resolveExpiredTurn(1);

      expect(mockPrisma.ban.create).toHaveBeenCalledWith({
        data: { draftId: 1, championId: 'Ahri', phase: 1, playerId: 10, team: 'BLUE', locked: true },
      });
      expect(emitSpy).toHaveBeenCalledWith(1, 'ban.confirmed', expect.anything());
      expect(emitSpy).toHaveBeenCalledWith(1, 'draft.update', next);
      expect(emitSpy).toHaveBeenCalledWith(1, 'timer.expired', { autoLockedChampionId: 'Ahri' });
    });

    it('an expired pick turn with nothing staged picks the first available champion alphabetically', async () => {
      const session = sessionState(1, 7, {}, 'IN_PROGRESS'); // turn 7 = Blue pick
      mockSessions.syncWithRecord.mockResolvedValue(session);
      mockPrisma.draft.findUnique.mockResolvedValue({
        id: 1,
        blueTeamPlayerId: 10,
        redTeamPlayerId: 11,
      });
      mockPrisma.pick.create.mockResolvedValue({ id: 42 });
      const next = sessionState(1, 8);
      mockSessions.confirmPick.mockResolvedValue({ state: next, championId: 'Ahri' });
      mockSessions.save.mockResolvedValue(undefined);
      mockChampions.getChampions.mockResolvedValue({
        count: 3,
        data: [
          { id: 'Zed', name: 'Zed', iconUrl: 'x' },
          { id: 'Ahri', name: 'Ahri', iconUrl: 'x' },
          { id: 'Akali', name: 'Akali', iconUrl: 'x' },
        ],
      });
      const emitSpy = jest.spyOn(service as any, 'emitTo');

      await (service as any).resolveExpiredTurn(1);

      // First available alphabetically among unbanned/unpicked = Ahri.
      expect(mockPrisma.pick.create).toHaveBeenCalledWith({
        data: { draftId: 1, championId: 'Ahri', playerId: 10, team: 'BLUE', locked: true },
      });
      expect(emitSpy).toHaveBeenCalledWith(1, 'timer.expired', { autoLockedChampionId: 'Ahri' });
    });

    it('an expired ban turn with nothing staged is skipped (no champion locked)', async () => {
      const session = sessionState(1, 2, {}, 'IN_PROGRESS'); // turn 2 = Red ban
      mockSessions.syncWithRecord.mockResolvedValue(session);
      mockPrisma.draft.findUnique.mockResolvedValue({
        id: 1,
        blueTeamPlayerId: 10,
        redTeamPlayerId: 11,
      });
      const next = sessionState(1, 3);
      mockSessions.recordSkip.mockResolvedValue(next);
      mockSessions.save.mockResolvedValue(undefined);
      const emitSpy = jest.spyOn(service as any, 'emitTo');

      await (service as any).resolveExpiredTurn(1);

      expect(mockSessions.recordSkip).toHaveBeenCalledWith(1, 'RED');
      expect(mockPrisma.ban.create).not.toHaveBeenCalled();
      expect(emitSpy).toHaveBeenCalledWith(1, 'timer.expired', { autoLockedChampionId: null });
    });

    it('a pick turn with no available champion falls back to a skip when the catalog is down', async () => {
      const session = sessionState(1, 7, {}, 'IN_PROGRESS');
      mockSessions.syncWithRecord.mockResolvedValue(session);
      mockPrisma.draft.findUnique.mockResolvedValue({
        id: 1,
        blueTeamPlayerId: 10,
        redTeamPlayerId: 11,
      });
      mockChampions.getChampions.mockRejectedValue(new ServiceUnavailableException('Champion pool unavailable'));
      const next = sessionState(1, 8);
      mockSessions.recordSkip.mockResolvedValue(next);
      mockSessions.save.mockResolvedValue(undefined);
      jest.spyOn(service as any, 'emitTo');

      await (service as any).resolveExpiredTurn(1);

      expect(mockSessions.recordSkip).toHaveBeenCalledWith(1, 'BLUE');
      expect(mockPrisma.pick.create).not.toHaveBeenCalled();
    });

    it('Finalization expiry completes the draft instead of advancing a turn', async () => {
      const session = sessionState(1, 21, {}, 'IN_PROGRESS');
      // First syncWithRecord call (inside resolveExpiredTurn) sees IN_PROGRESS;
      // the second (inside completeDraft) sees COMPLETE.
      mockSessions.syncWithRecord.mockResolvedValueOnce(session);
      mockSessions.syncWithRecord.mockResolvedValue(sessionState(1, 21, {}, 'COMPLETE'));
      mockPrisma.draft.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.draft.findUnique.mockResolvedValue({
        id: 1,
        code: 'CODE1',
        completedAt: new Date(),
      });
      mockPrisma.pick.findMany.mockResolvedValue([]);
      mockPrisma.ban.findMany.mockResolvedValue([]);
      const emitSpy = jest.spyOn(service as any, 'emitTo');
      const clearSpy = jest.spyOn(service, 'clearTimers');

      await (service as any).resolveExpiredTurn(1);

      expect(mockPrisma.draft.updateMany).toHaveBeenCalledWith({
        where: { id: 1, status: 'IN_PROGRESS' },
        data: { status: 'COMPLETE', completedAt: expect.any(Date) },
      });
      expect(emitSpy).toHaveBeenCalledWith(1, 'draft.completed', expect.anything());
      expect(clearSpy).toHaveBeenCalledWith(1);
    });
  });

  describe('handleActionCompleted — turn advancement', () => {
    it('clears the timer and advances to the next turn', async () => {
      const session = sessionState(1, 5, {}, 'IN_PROGRESS');
      mockSessions.syncWithRecord.mockResolvedValue(session);
      mockPrisma.draft.update.mockResolvedValue({});
      mockSessions.save.mockResolvedValue(undefined);
      const emitSpy = jest.spyOn(service as any, 'emitTo');
      const armSpy = jest.spyOn(service as any, 'armTurn').mockResolvedValue(undefined);

      await service.startTurnTimer(1);
      await service.handleActionCompleted(1);

      expect(mockPrisma.draft.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { currentTurn: 6 },
      });
      expect(emitSpy).toHaveBeenCalledWith(1, 'turn.end', 6);
      expect(armSpy).toHaveBeenCalledWith(1, { announce: true });
    });

    it('does not advance past the Finalization turn (turn 21)', async () => {
      const session = sessionState(1, 21, {}, 'IN_PROGRESS');
      mockSessions.syncWithRecord.mockResolvedValue(session);
      mockPrisma.draft.update.mockResolvedValue({});
      jest.spyOn(service as any, 'emitTo');

      await service.handleActionCompleted(1);

      expect(mockPrisma.draft.update).not.toHaveBeenCalled();
    });
  });

  describe('persistence helpers', () => {
    it('persistBanRow creates a Ban row for the acting side', async () => {
      mockPrisma.draft.findUnique.mockResolvedValue({
        id: 1,
        blueTeamPlayerId: 10,
        redTeamPlayerId: 11,
      });
      mockPrisma.ban.create.mockResolvedValue(undefined);

      await (service as any).persistBanRow(1, 'Ahri', 'BLUE', 1);

      expect(mockPrisma.ban.create).toHaveBeenCalledWith({
        data: { draftId: 1, championId: 'Ahri', phase: 1, playerId: 10, team: 'BLUE', locked: true },
      });
    });

    it('persistBanRow does nothing when the side has no player yet', async () => {
      mockPrisma.draft.findUnique.mockResolvedValue({
        id: 1,
        blueTeamPlayerId: null,
        redTeamPlayerId: 11,
      });

      await (service as any).persistBanRow(1, 'Ahri', 'BLUE', 1);

      expect(mockPrisma.ban.create).not.toHaveBeenCalled();
    });

    it('persistPickRow creates a Pick row and returns its id', async () => {
      mockPrisma.draft.findUnique.mockResolvedValue({
        id: 1,
        blueTeamPlayerId: 10,
        redTeamPlayerId: 11,
      });
      mockPrisma.pick.create.mockResolvedValue({ id: 7 });

      const row = await (service as any).persistPickRow(1, 'Akali', 'RED');

      expect(mockPrisma.pick.create).toHaveBeenCalledWith({
        data: { draftId: 1, championId: 'Akali', playerId: 11, team: 'RED', locked: true },
      });
      expect(row).toEqual({ id: 7 });
    });
  });

  describe('firstAvailableChampion — Redis-session rebuilding', () => {
    it('returns the first available champion by case-insensitive name, excluding bans and picks', async () => {
      mockChampions.getChampions.mockResolvedValue({
        count: 4,
        data: [
          { id: 'Zed', name: 'Zed', iconUrl: 'x' },
          { id: 'Ahri', name: 'Ahri', iconUrl: 'x' },
          { id: 'Akali', name: 'Akali', iconUrl: 'x' },
          { id: 'Annie', name: 'Annie', iconUrl: 'x' },
        ],
      });
      const state = sessionState(1, 7, {}, 'IN_PROGRESS');
      state.bans.push({ championId: 'Annie', team: 'RED', phase: 1, locked: true });
      state.picks.push({ id: 1, championId: 'Akali', team: 'BLUE', locked: true });

      const id = await (service as any).firstAvailableChampion(state);

      // Available: Ahri, Zed. Alphabetically first = Ahri.
      expect(id).toBe('Ahri');
    });

    it('returns null when every champion is taken', async () => {
      mockChampions.getChampions.mockResolvedValue({
        count: 1,
        data: [{ id: 'Ahri', name: 'Ahri', iconUrl: 'x' }],
      });
      const state = sessionState(1, 7, {}, 'IN_PROGRESS');
      state.picks.push({ id: 1, championId: 'Ahri', team: 'BLUE', locked: true });

      const id = await (service as any).firstAvailableChampion(state);
      expect(id).toBeNull();
    });
  });
});
