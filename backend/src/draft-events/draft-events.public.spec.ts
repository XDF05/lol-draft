import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { io as Client, Socket as ClientSocket } from 'socket.io-client';
import request from 'supertest';
import { AuthModule } from '../auth/auth.module';
import { DraftModule } from '../draft/draft.module';
import { DraftEventsModule } from './draft-events.module';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { RiotApiService } from '../champions/riot-api.service';
import { DraftHttpExceptionFilter } from '../common/filters/draft-http-exception.filter';
import { WAITING_DRAFT_TTL_MS } from '../draft/draft.constants';

/** Await a single named socket event. */
function once(socket: ClientSocket, event: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      socket.off(event, onEvent);
      reject(new Error(`timeout waiting for ${event}`));
    }, 10000);
    const onEvent = (data: any) => {
      clearTimeout(t);
      resolve(data);
    };
    socket.once(event, onEvent);
  });
}

/** Connect an anonymous spectator socket (Origin overridden to pass CORS). */
async function connect(app: INestApplication): Promise<ClientSocket> {
  const server = app.getHttpServer();
  const address = server.address() as { port: number };
  const url = `http://localhost:${address.port}`;
  const socket = Client(url, {
    transports: ['websocket', 'polling'],
    // The gateway CORS allowlist only permits localhost:3000 / 127.0.0.1:3000.
    // socket.io-client derives Origin from the connection URL, which would be
    // an ephemeral port and get CORS-rejected, so we pin Origin to an allowed
    // origin purely for the test harness.
    extraHeaders: { Origin: 'http://localhost:3000' },
  } as unknown as Record<string, unknown>);
  await once(socket, 'connect');
  return socket;
}

describe('Spectator public access (end-to-end)', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let redis: RedisService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule, AuthModule, DraftModule, DraftEventsModule],
    })
      // Stub the Data Dragon-backed champion service so spectator tests do
      // not depend on the external CDN.
      .overrideProvider(RiotApiService)
      .useValue({
        getChampions: jest.fn().mockResolvedValue({
          count: 3,
          data: [
            { id: 'Ahri', name: 'Ahri', iconUrl: 'https://cdn/14.1.1/img/champion/Ahri.png' },
            { id: 'Akali', name: 'Akali', iconUrl: 'https://cdn/14.1.1/img/champion/Akali.png' },
            { id: 'Annie', name: 'Annie', iconUrl: 'https://cdn/14.1.1/img/champion/Annie.png' },
          ],
        }),
      })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(new DraftHttpExceptionFilter());
    await app.init();
    await app.listen(0); // ephemeral port; client connects to the returned port

    prisma = app.get(PrismaService);
    redis = app.get(RedisService);

    await prisma.user.deleteMany();
    await prisma.draft.deleteMany();
    await redis.client.flushall();
  });

  afterAll(async () => {
    await app.close();
    await moduleRef.close();
  });

  beforeEach(async () => {
    await prisma.user.deleteMany();
    await prisma.draft.deleteMany();
    await redis.client.flushall();
  });

  async function createDraftInDb(overrides: any = {}) {
    const owner = await prisma.user.create({
      data: {
        username: `owner${Date.now()}`,
        email: `owner${Date.now()}@example.com`,
        passwordHash: 'hash',
      },
    });
    const opponent = await prisma.user.create({
      data: {
        username: `opponent${Date.now()}`,
        email: `opponent${Date.now()}@example.com`,
        passwordHash: 'hash',
      },
    });
    return prisma.draft.create({
      data: {
        code: overrides.code ?? `PUB${Date.now() % 100000}`,
        status: overrides.status ?? 'IN_PROGRESS',
        blueTeamPlayerId: owner.id,
        redTeamPlayerId: opponent.id,
        currentTurn: overrides.currentTurn ?? 21,
        completedAt: overrides.completedAt ?? null,
        ...overrides,
      },
    });
  }

  describe('public.join (anonymous spectator)', () => {
    it('lets an anonymous spectator join a valid draft and receive the public snapshot', async () => {
      const draft = await createDraftInDb({
        code: 'PUB1234',
        status: 'COMPLETE',
        completedAt: new Date(),
      });
      await prisma.ban.create({
        data: {
          draftId: draft.id,
          championId: 'Ahri',
          phase: 1,
          playerId: 1,
          team: 'BLUE',
          locked: true,
        },
      });
      await prisma.pick.create({
        data: { draftId: draft.id, championId: 'Akali', playerId: 1, team: 'BLUE', locked: true },
      });

      const socket = await connect(app);

      // Anonymous spectator: no auth token, joins via public.join only.
      const ack = await new Promise<any>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('public.join timeout')), 10000);
        socket.emit(
          'public.join',
          { draftCode: 'PUB1234' },
          (data: any) => {
            clearTimeout(t);
            resolve(data);
          },
        );
      });

      expect(ack.ok).toBe(true);
      expect(ack.draftId).toBe(draft.id);
      expect(ack.code).toBe('PUB1234');
      expect(ack.status).toBe('COMPLETE');

      socket.disconnect();
    });

    it('rejects an unknown draft code with "Draft not found"', async () => {
      const socket = await connect(app);

      const err = await new Promise<any>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('timeout')), 10000);
        socket.emit(
          'public.join',
          { draftCode: 'NOPECODE' },
          (data: any) => {
            clearTimeout(t);
            resolve(data);
          },
        );
        socket.on('exception', (data: any) => {
          clearTimeout(t);
          resolve(data);
        });
      });

      expect(err.message).toContain('Draft not found');
      socket.disconnect();
    });

    it('sanitizes public draft updates — no pending (staged) selections reach spectators', async () => {
      const draft = await createDraftInDb({
        code: 'PUB5678',
        status: 'IN_PROGRESS',
        currentTurn: 7,
      });
      // Add a pending (unstaged) selection to the live session — this must be
      // stripped from the public snapshot.
      await redis.client.set(
        `draft:${draft.id}:session`,
        JSON.stringify({
          draftId: draft.id,
          code: draft.code,
          status: 'IN_PROGRESS',
          currentTurn: 7,
          bans: [],
          picks: [],
          pending: { BLUE: { type: 'PICK', championId: 'Ahri' } },
          skips: { BLUE: 0, RED: 0 },
          updatedAt: new Date().toISOString(),
        }),
      );

      const socket = await connect(app);

      const update = await new Promise<any>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('draft.update timeout')), 10000);
        socket.emit(
          'public.join',
          { draftCode: 'PUB5678' },
          (data: any) => {
            clearTimeout(t);
            resolve(data);
          },
        );
        socket.once('draft.update', (data: any) => {
          clearTimeout(t);
          resolve(data);
        });
      });

      // The public snapshot must not expose the pending selection.
      expect(update.pending).toEqual({});
      expect(update.pending.BLUE).toBeUndefined();

      socket.disconnect();
    });

    it('receives completed results when joining a completed draft', async () => {
      const draft = await createDraftInDb({
        code: 'PUBRESULTS',
        status: 'COMPLETE',
        completedAt: new Date(),
      });

      const socket = await connect(app);
      const ack = await new Promise<any>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('timeout')), 10000);
        socket.emit('public.join', { draftCode: 'PUBRESULTS' }, (d: any) => {
          clearTimeout(t);
          resolve(d);
        });
      });
      expect(ack.ok).toBe(true);
      expect(ack.status).toBe('COMPLETE');
      socket.disconnect();
    });
  });

  describe('reconnect behavior', () => {
    it('a spectator can reconnect to the same draft and receive the current snapshot', async () => {
      const draft = await createDraftInDb({
        code: 'PUBRECONN',
        status: 'COMPLETE',
        completedAt: new Date(),
      });

      const socket1 = await connect(app);
      const ack1 = await new Promise<any>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('timeout')), 10000);
        socket1.emit('public.join', { draftCode: 'PUBRECONN' }, (d: any) => {
          clearTimeout(t);
          resolve(d);
        });
      });
      expect(ack1.ok).toBe(true);
      socket1.disconnect();

      // Reconnect as a new socket and join again — the draft is still there.
      const socket2 = await connect(app);
      const ack2 = await new Promise<any>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('timeout')), 10000);
        socket2.emit('public.join', { draftCode: 'PUBRECONN' }, (d: any) => {
          clearTimeout(t);
          resolve(d);
        });
      });
      expect(ack2.ok).toBe(true);
      expect(ack2.code).toBe('PUBRECONN');

      socket2.disconnect();
    });
  });

  describe('public access via HTTP (no authentication)', () => {
    it('serves the public snapshot over HTTP without a bearer token', async () => {
      const draft = await createDraftInDb({
        code: 'PUBHTTP',
        status: 'COMPLETE',
        completedAt: new Date(),
      });
      await prisma.pick.create({
        data: { draftId: draft.id, championId: 'Akali', playerId: 1, team: 'BLUE', locked: true },
      });

      const res = await request(app.getHttpServer())
        .get('/public/draft/PUBHTTP')
        .expect(200);

      expect(res.body.code).toBe('PUBHTTP');
      expect(res.body.status).toBe('COMPLETE');
      expect(res.body.pending).toBeUndefined();
    });

    it('returns 404 for an unknown draft code without leaking details', async () => {
      await request(app.getHttpServer())
        .get('/public/draft/UNKNOWN')
        .expect(404);
    });
  });
});
