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

/**
 * Participant reconnection grace period (R-013): the draft expires only when
 * a participant's LAST socket stays disconnected beyond the grace window;
 * returning within the window cancels the expiry timer.
 *
 * The gateway reads DRAFT_GRACE_PERIOD_MS at construction, so the shortened
 * window is set before the testing module compiles and restored afterwards.
 */
const GRACE_PERIOD_MS = 600;
const ORIGINAL_GRACE_PERIOD_MS = process.env.DRAFT_GRACE_PERIOD_MS;

let userCounter = 0;
const openSockets: ClientSocket[] = [];

function uniqueUsername(prefix = 'grace') {
  return `${prefix}${++userCounter}`;
}

async function registerAndLogin(app: INestApplication) {
  const username = uniqueUsername();
  const email = `${username}@example.com`;
  await request(app.getHttpServer())
    .post('/auth/register')
    .send({ username, email, password: 'Password123!' })
    .expect(201);
  const login = await request(app.getHttpServer())
    .post('/auth/login')
    .send({ username, password: 'Password123!' })
    .expect(201);
  return { username, token: login.body.access_token as string };
}

/** Await one Socket.IO event. */
function once(socket: ClientSocket, event: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, onEvent);
      reject(new Error(`timeout waiting for ${event}`));
    }, 10_000);
    const onEvent = (data: any) => {
      clearTimeout(timer);
      resolve(data);
    };
    socket.once(event, onEvent);
  });
}

/** Connect an authenticated participant socket (Origin pinned for CORS). */
async function connectSocket(
  app: INestApplication,
  token: string,
): Promise<ClientSocket> {
  const address = app.getHttpServer().address() as { port: number };
  const socket = Client(`http://localhost:${address.port}`, {
    autoConnect: false,
    transports: ['websocket', 'polling'],
    extraHeaders: { Origin: 'http://localhost:3000' },
    auth: { token },
  });
  const connected = once(socket, 'connect');
  const ready = once(socket, 'connection.ready');
  socket.connect();
  await connected;
  await ready;
  openSockets.push(socket);
  return socket;
}

/** Emit and await the acknowledgement (fails the test on a gateway error). */
function emitAck(
  socket: ClientSocket,
  event: string,
  payload: unknown,
): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`timeout waiting for ${event} ack`)),
      10_000,
    );
    socket.emit(event, payload, (ack: any) => {
      clearTimeout(timer);
      resolve(ack);
    });
  });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('Participant reconnection grace period (integration)', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let redis: RedisService;

  beforeAll(async () => {
    process.env.DRAFT_GRACE_PERIOD_MS = String(GRACE_PERIOD_MS);

    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule, AuthModule, DraftModule, DraftEventsModule],
    })
      // No external CDN dependency: turn 1 is a ban turn, but stub the pool
      // so a timeout fallback can never reach Data Dragon either.
      .overrideProvider(RiotApiService)
      .useValue({
        getChampions: jest.fn().mockResolvedValue({
          count: 1,
          data: [
            {
              id: 'Ahri',
              name: 'Ahri',
              iconUrl: 'https://cdn.example/champion/Ahri.png',
            },
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
    await app.listen(0);

    prisma = app.get(PrismaService);
    redis = app.get(RedisService);
  });

  afterAll(async () => {
    await app.close();
    await moduleRef.close();
    if (ORIGINAL_GRACE_PERIOD_MS === undefined) {
      delete process.env.DRAFT_GRACE_PERIOD_MS;
    } else {
      process.env.DRAFT_GRACE_PERIOD_MS = ORIGINAL_GRACE_PERIOD_MS;
    }
  });

  beforeEach(async () => {
    await prisma.user.deleteMany();
    await prisma.draft.deleteMany();
    await redis.client.flushall();
  });

  afterEach(() => {
    for (const socket of openSockets) {
      socket.disconnect();
    }
    openSockets.length = 0;
  });

  /** Create a live draft with both participants joined over sockets. */
  async function startLiveDraft() {
    const blue = await registerAndLogin(app);
    const red = await registerAndLogin(app);
    const create = await request(app.getHttpServer())
      .post('/draft/create')
      .set('Authorization', `Bearer ${blue.token}`)
      .send({ side: 'BLUE' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/draft/${create.body.code}/join`)
      .set('Authorization', `Bearer ${red.token}`)
      .send({ side: 'RED' })
      .expect(201);
    const draft = await prisma.draft.findUniqueOrThrow({
      where: { code: create.body.code },
    });

    const blueSocket = await connectSocket(app, blue.token);
    const redSocket = await connectSocket(app, red.token);
    expect(
      (await emitAck(blueSocket, 'draft.join', { code: create.body.code })).ok,
    ).toBe(true);
    expect(
      (await emitAck(redSocket, 'draft.join', { code: create.body.code })).ok,
    ).toBe(true);

    return { code: create.body.code, draft, blue, red, blueSocket, redSocket };
  }

  it('expires the draft when a participant stays disconnected past the grace period', async () => {
    const { draft, blueSocket, redSocket } = await startLiveDraft();

    const expiredEvent = once(redSocket, 'draft.expired');
    blueSocket.disconnect(); // Blue's last socket is gone.

    const payload = await expiredEvent;
    expect(payload.reason).toContain('disconnected');

    const row = await prisma.draft.findUniqueOrThrow({
      where: { id: draft.id },
    });
    expect(row.status).toBe('EXPIRED');
    // The live session is dropped with the expired draft.
    expect(await redis.client.get(`draft:${draft.id}:session`)).toBeNull();
  });

  it('cancels the expiry timer when the participant returns within the grace period', async () => {
    const { code, draft, blue, blueSocket, redSocket } = await startLiveDraft();

    const expiryEvents: any[] = [];
    redSocket.on('draft.expired', (payload: any) => {
      expiryEvents.push(payload);
    });

    blueSocket.disconnect();
    // Return well inside the grace window and rejoin the room.
    await sleep(GRACE_PERIOD_MS / 3);
    const returningBlue = await connectSocket(app, blue.token);
    expect((await emitAck(returningBlue, 'draft.join', { code })).ok).toBe(
      true,
    );

    // Wait past the original deadline: a cancelled timer must not fire.
    await sleep(GRACE_PERIOD_MS + 200);

    const row = await prisma.draft.findUniqueOrThrow({
      where: { id: draft.id },
    });
    expect(row.status).toBe('IN_PROGRESS');
    expect(expiryEvents).toEqual([]);
    expect(await redis.client.get(`draft:${draft.id}:session`)).not.toBeNull();
  });
});
