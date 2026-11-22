import { Test, TestingModule } from '@nestjs/testing';
import { WsException } from '@nestjs/websockets';
import { DraftEventsGateway } from './draft-events.gateway';
import { PrismaService } from '../prisma/prisma.service';
import { DraftSessionService } from './draft-session.service';
import { ConnectionHealthService } from './connection-health.service';
import { TurnManagerService } from './turn-manager.service';
import { WsJwtGuard } from './ws-jwt.guard';
import { Team } from './socket-events';

/** Minimal Socket mock: only what handlePickSwap reads. */
function mockClient(userId: number, draftId: number, team: Team) {
  return {
    data: {
      user: { id: userId, username: `user${userId}` },
      draftId,
    },
  } as any;
}

/** A locked pick row owned by a team. */
function pickRow(
  id: number,
  championId: string,
  team: Team,
  locked = true,
) {
  return { id, draftId: 1, championId, playerId: 1, team, locked };
}

describe('DraftEventsGateway — Finalization swaps (unit)', () => {
  let gateway: DraftEventsGateway;
  let moduleRef: TestingModule;

  const mockPrisma = {
    pick: {
      findMany: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const mockSessions = {
    replacePicks: jest.fn(),
  };

  const mockHealth = {
    stats: jest.fn(),
  };

  const mockTurnManager = {
    claimTurnAction: jest.fn(),
  };

  const mockWsJwtGuard = {
    authenticate: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    moduleRef = await Test.createTestingModule({
      providers: [
        DraftEventsGateway,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: DraftSessionService, useValue: mockSessions },
        { provide: ConnectionHealthService, useValue: mockHealth },
        { provide: TurnManagerService, useValue: mockTurnManager },
        { provide: WsJwtGuard, useValue: mockWsJwtGuard },
      ],
    }).compile();

    gateway = moduleRef.get(DraftEventsGateway);

    // Mock the broadcast helper so tests don't depend on a real Socket.IO server.
    (gateway as any).broadcast = jest.fn();
    // Override requireDraftContext so we control draftId/session/team per test.
    (gateway as any).requireDraftContext = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('pick.swap — team-internal constraints', () => {
    const blueTeam = [
      pickRow(1, 'Ahri', 'BLUE'),
      pickRow(2, 'Akali', 'BLUE'),
    ];
    const redTeam = [
      pickRow(3, 'Zed', 'RED'),
      pickRow(4, 'Katarina', 'RED'),
    ];

    it('swaps two of the caller\'s own locked picks and broadcasts the new order', async () => {
      const client = mockClient(10, 1, 'BLUE');
      const session = {
        draftId: 1,
        code: 'CODE1',
        status: 'IN_PROGRESS',
        currentTurn: 21,
        bans: [],
        picks: [...blueTeam, ...redTeam],
        pending: {},
        skips: { BLUE: 0, RED: 0 },
        updatedAt: new Date().toISOString(),
      };

      (gateway as any).requireDraftContext.mockResolvedValue({
        draftId: 1,
        session,
        team: 'BLUE',
        user: { id: 10, username: 'user10' },
      });

      // Call 1: validation finds the original picks; call 2: reordered rows.
      mockPrisma.pick.findMany
        .mockResolvedValueOnce([...blueTeam, ...redTeam])
        .mockResolvedValueOnce([
          pickRow(1, 'Akali', 'BLUE'),
          pickRow(2, 'Ahri', 'BLUE'),
          ...redTeam,
        ]);
      mockPrisma.pick.update.mockResolvedValue({});
      // Transaction resolves without error.
      mockPrisma.$transaction.mockResolvedValue([undefined, undefined, undefined]);
      mockSessions.replacePicks.mockResolvedValue(session);

      const result = await gateway.handlePickSwap(client, {
        fromPickId: 1,
        toPickId: 2,
      });

      expect(result.ok).toBe(true);
      // The transaction parks pick 1 on a temp id, writes Akali into 2, then Ahri into 1.
      expect(mockPrisma.pick.update).toHaveBeenCalledTimes(3);
      expect(mockPrisma.pick.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { championId: expect.stringMatching(/^__swap_/) },
      });
      expect(mockPrisma.pick.update).toHaveBeenCalledWith({
        where: { id: 2 },
        data: { championId: 'Ahri' },
      });
      expect(mockPrisma.pick.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { championId: 'Akali' },
      });
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      expect(mockSessions.replacePicks).toHaveBeenCalledWith(
        1,
        expect.arrayContaining([
          expect.objectContaining({ id: 1, championId: 'Akali', team: 'BLUE', locked: true }),
          expect.objectContaining({ id: 2, championId: 'Ahri', team: 'BLUE', locked: true }),
          expect.objectContaining({ id: 3, championId: 'Zed', team: 'RED', locked: true }),
          expect.objectContaining({ id: 4, championId: 'Katarina', team: 'RED', locked: true }),
        ]),
      );
      expect((gateway as any).broadcast).toHaveBeenCalledWith(
        1,
        'pick.reordered',
        expect.anything(),
      );
      expect((gateway as any).broadcast).toHaveBeenCalledWith(
        1,
        'draft.update',
        session,
      );
    });

    it('rejects swapping the same pick with itself', async () => {
      const client = mockClient(10, 1, 'BLUE');
      const session = {
        draftId: 1, code: 'CODE1', status: 'IN_PROGRESS', currentTurn: 21,
        bans: [], picks: [...blueTeam, ...redTeam], pending: {},
        skips: { BLUE: 0, RED: 0 }, updatedAt: new Date().toISOString(),
      };
      (gateway as any).requireDraftContext.mockResolvedValue({
        draftId: 1, session, team: 'BLUE', user: { id: 10, username: 'user10' },
      });

      await expect(
        gateway.handlePickSwap(client, { fromPickId: 1, toPickId: 1 }),
      ).rejects.toBeInstanceOf(WsException);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects swapping picks not part of this draft', async () => {
      const client = mockClient(10, 1, 'BLUE');
      const session = {
        draftId: 1, code: 'CODE1', status: 'IN_PROGRESS', currentTurn: 21,
        bans: [], picks: [...blueTeam, ...redTeam], pending: {},
        skips: { BLUE: 0, RED: 0 }, updatedAt: new Date().toISOString(),
      };
      (gateway as any).requireDraftContext.mockResolvedValue({
        draftId: 1, session, team: 'BLUE', user: { id: 10, username: 'user10' },
      });
      // Only one of the two ids exists in this draft.
      mockPrisma.pick.findMany.mockResolvedValue([blueTeam[0]]);

      await expect(
        gateway.handlePickSwap(client, { fromPickId: 1, toPickId: 999 }),
      ).rejects.toBeInstanceOf(WsException);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects swapping a pick belonging to the opposing team', async () => {
      const client = mockClient(10, 1, 'BLUE');
      const session = {
        draftId: 1, code: 'CODE1', status: 'IN_PROGRESS', currentTurn: 21,
        bans: [], picks: [...blueTeam, ...redTeam], pending: {},
        skips: { BLUE: 0, RED: 0 }, updatedAt: new Date().toISOString(),
      };
      (gateway as any).requireDraftContext.mockResolvedValue({
        draftId: 1, session, team: 'BLUE', user: { id: 10, username: 'user10' },
      });
      mockPrisma.pick.findMany.mockResolvedValue([...blueTeam, ...redTeam]);

      // BLUE caller tries to swap RED's pick (id 3) with their own (id 1).
      await expect(
        gateway.handlePickSwap(client, { fromPickId: 1, toPickId: 3 }),
      ).rejects.toBeInstanceOf(WsException);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects swapping unlocked picks', async () => {
      const client = mockClient(10, 1, 'BLUE');
      const unlockedPick = { ...pickRow(1, 'Ahri', 'BLUE'), locked: false };
      const session = {
        draftId: 1, code: 'CODE1', status: 'IN_PROGRESS', currentTurn: 21,
        bans: [], picks: [unlockedPick, pickRow(2, 'Akali', 'BLUE'), ...redTeam],
        pending: {}, skips: { BLUE: 0, RED: 0 }, updatedAt: new Date().toISOString(),
      };
      (gateway as any).requireDraftContext.mockResolvedValue({
        draftId: 1, session, team: 'BLUE', user: { id: 10, username: 'user10' },
      });
      mockPrisma.pick.findMany.mockResolvedValue([
        unlockedPick, pickRow(2, 'Akali', 'BLUE'), ...redTeam,
      ]);

      await expect(
        gateway.handlePickSwap(client, { fromPickId: 1, toPickId: 2 }),
      ).rejects.toBeInstanceOf(WsException);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('allows repeated swaps during Finalization (unlimited swaps)', async () => {
      const client = mockClient(10, 1, 'BLUE');
      const baseSession = {
        draftId: 1, code: 'CODE1', status: 'IN_PROGRESS', currentTurn: 21,
        bans: [], picks: [...blueTeam, ...redTeam], pending: {},
        skips: { BLUE: 0, RED: 0 }, updatedAt: new Date().toISOString(),
      };

      (gateway as any).requireDraftContext.mockResolvedValue({
        draftId: 1, session: baseSession, team: 'BLUE', user: { id: 10, username: 'user10' },
      });
      mockPrisma.pick.findMany.mockResolvedValue([...blueTeam, ...redTeam]);
      mockPrisma.pick.update.mockResolvedValue({});
      mockPrisma.$transaction.mockResolvedValue([undefined, undefined, undefined]);
      mockSessions.replacePicks.mockResolvedValue(baseSession);

      // First swap: exchange Ahri (1) and Akali (2).
      await gateway.handlePickSwap(client, { fromPickId: 1, toPickId: 2 });
      // Second swap: exchange them back (repeated swap allowed).
      await gateway.handlePickSwap(client, { fromPickId: 1, toPickId: 2 });

      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(2);
      expect(mockSessions.replacePicks).toHaveBeenCalledTimes(2);
      // Broadcast happens once per successful swap.
      expect((gateway as any).broadcast).toHaveBeenCalledTimes(4); // 2 events × 2 swaps
    });

    it('rejects swaps outside of Finalization', async () => {
      const client = mockClient(10, 1, 'BLUE');
      const notFinalization = {
        draftId: 1, code: 'CODE1', status: 'IN_PROGRESS', currentTurn: 7,
        bans: [], picks: [...blueTeam, ...redTeam], pending: {},
        skips: { BLUE: 0, RED: 0 }, updatedAt: new Date().toISOString(),
      };
      (gateway as any).requireDraftContext.mockResolvedValue({
        draftId: 1, session: notFinalization, team: 'BLUE', user: { id: 10, username: 'user10' },
      });

      await expect(
        gateway.handlePickSwap(client, { fromPickId: 1, toPickId: 2 }),
      ).rejects.toBeInstanceOf(WsException);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });
  });
});
