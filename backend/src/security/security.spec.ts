import { INestApplication, Logger, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as jwt from 'jsonwebtoken';
import { io as Client, Socket as ClientSocket } from 'socket.io-client';
import request from 'supertest';
import { AppModule } from '../app.module';
import { HTTP_CORS_OPTIONS } from '../common/config/cors';
import { DraftHttpExceptionFilter } from '../common/filters/draft-http-exception.filter';
import { RiotApiService } from '../champions/riot-api.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

let userCounter = 0;
const openSockets: ClientSocket[] = [];

function uniqueUsername(prefix = 'security') {
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
  return {
    username,
    token: login.body.access_token as string,
    refreshToken: login.body.refresh_token as string,
  };
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

/** Connect a participant or anonymous spectator to the test server. */
async function connectSocket(
  app: INestApplication,
  token?: string,
): Promise<ClientSocket> {
  const address = app.getHttpServer().address() as { port: number };
  const socket = Client(`http://localhost:${address.port}`, {
    autoConnect: false,
    transports: ['websocket', 'polling'],
    extraHeaders: { Origin: 'http://localhost:3000' },
    ...(token ? { auth: { token } } : {}),
  });
  const connected = once(socket, 'connect');
  const ready = once(socket, 'connection.ready');
  socket.connect();
  await connected;
  await ready;
  openSockets.push(socket);
  return socket;
}

/** Wait for either a successful acknowledgement or a gateway exception. */
function emitForOutcome(
  socket: ClientSocket,
  event: string,
  payload: unknown,
): Promise<{ ack?: any; exception?: any }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('exception', onException);
      reject(new Error(`timeout waiting for ${event} outcome`));
    }, 10_000);
    const onException = (data: any) => {
      clearTimeout(timer);
      resolve({ exception: data });
    };
    socket.once('exception', onException);
    socket.emit(event, payload, (ack: any) => {
      clearTimeout(timer);
      socket.off('exception', onException);
      resolve({ ack });
    });
  });
}

describe('Security regression suite', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let redis: RedisService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] })
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
    app.enableCors(HTTP_CORS_OPTIONS);
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

  describe('9.2 local-origin CORS and public endpoint boundary', () => {
    it('allows the configured local web origins to read participant responses', async () => {
      const { token } = await registerAndLogin(app);
      const create = await request(app.getHttpServer())
        .post('/draft/create')
        .set('Origin', 'http://localhost:3000')
        .set('Authorization', `Bearer ${token}`)
        .send({ side: 'BLUE' })
        .expect(201);

      const response = await request(app.getHttpServer())
        .get(`/draft/${create.body.code}`)
        .set('Origin', 'http://localhost:3000')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.headers['access-control-allow-origin']).toBe(
        'http://localhost:3000',
      );
      expect(response.headers['access-control-allow-credentials']).toBe('true');
    });

    it('does not let a disallowed browser origin read participant responses', async () => {
      const { token } = await registerAndLogin(app);
      const create = await request(app.getHttpServer())
        .post('/draft/create')
        .set('Authorization', `Bearer ${token}`)
        .send({ side: 'BLUE' })
        .expect(201);

      const response = await request(app.getHttpServer())
        .get(`/draft/${create.body.code}`)
        .set('Origin', 'https://attacker.example')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      // The request itself is processed, but the browser omits an
      // allow-origin header, so attacker JavaScript cannot read the body.
      expect(response.headers['access-control-allow-origin']).toBeUndefined();
      expect(response.body.code).toBe(create.body.code);
    });

    it('does not issue CORS permission for a disallowed preflight', async () => {
      const response = await request(app.getHttpServer())
        .options('/draft/create')
        .set('Origin', 'https://attacker.example')
        .set('Access-Control-Request-Method', 'POST')
        .set('Access-Control-Request-Headers', 'authorization,content-type');

      expect(response.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('keeps participant routes authenticated while public snapshots stay public', async () => {
      const owner = await prisma.user.create({
        data: {
          username: uniqueUsername('owner'),
          email: `${uniqueUsername()}@example.com`,
          passwordHash: 'hash',
        },
      });
      await prisma.draft.create({
        data: {
          code: 'SEC1234',
          status: 'WAITING_FOR_PLAYERS',
          blueTeamPlayerId: owner.id,
        },
      });

      await request(app.getHttpServer()).get('/draft/SEC1234').expect(401);
      await request(app.getHttpServer())
        .get('/public/draft/SEC1234')
        .expect(200);
      await request(app.getHttpServer()).get('/champions').expect(200);
    });
  });

  describe('9.3 session abuse resistance', () => {
    it('rejects expired and malformed access tokens', async () => {
      const expired = jwt.sign(
        { sub: 1, username: 'expired' },
        process.env.JWT_SECRET as string,
        { expiresIn: -1 },
      );

      await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${expired}`)
        .expect(401);
      await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', 'Bearer malformed-token')
        .expect(401);
    });

    it('rejects a reused refresh token and allows only one concurrent rotation', async () => {
      const { refreshToken } = await registerAndLogin(app);

      const rotations = await Promise.all([
        request(app.getHttpServer())
          .post('/auth/refresh')
          .send({ refresh_token: refreshToken }),
        request(app.getHttpServer())
          .post('/auth/refresh')
          .send({ refresh_token: refreshToken }),
      ]);

      expect(
        rotations.filter((response) => response.status === 201),
      ).toHaveLength(1);
      expect(
        rotations.filter((response) => response.status === 401),
      ).toHaveLength(1);

      await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refresh_token: refreshToken })
        .expect(401);
    });

    it('rejects login attempts after the five-attempt limit', async () => {
      const username = uniqueUsername('limited');

      for (let attempt = 0; attempt < 5; attempt++) {
        await request(app.getHttpServer())
          .post('/auth/login')
          .send({ username, password: 'WrongPassword123!' })
          .expect(401);
      }

      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ username, password: 'WrongPassword123!' })
        .expect(429);
    });

    it('logout revokes both the refresh token and current access token', async () => {
      const { token, refreshToken } = await registerAndLogin(app);

      await request(app.getHttpServer())
        .post('/auth/logout')
        .set('Authorization', `Bearer ${token}`)
        .send({ refresh_token: refreshToken })
        .expect(204);

      await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(401);
      await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refresh_token: refreshToken })
        .expect(401);
    });
  });

  describe('9.4 validation and authentication bypass resistance', () => {
    it('rejects SQL-injection-shaped registration input without creating a user', async () => {
      const before = await prisma.user.count();
      const payload = {
        username: 'x\'; DROP TABLE "User";--',
        email: 'injection@example.com',
        password: 'Password123!',
      };

      await request(app.getHttpServer())
        .post('/auth/register')
        .send(payload)
        .expect(400);

      expect(await prisma.user.count()).toBe(before);
    });

    it('treats SQL-injection-shaped draft codes as missing without changing state', async () => {
      const { token } = await registerAndLogin(app);
      const draftsBefore = await prisma.draft.count();

      await request(app.getHttpServer())
        .get(`/draft/${encodeURIComponent("x' OR 1=1;--")}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
      await request(app.getHttpServer())
        .post(`/draft/${encodeURIComponent('x\'; DROP TABLE "Draft";--')}/join`)
        .set('Authorization', `Bearer ${token}`)
        .send({ side: 'RED' })
        .expect(404);

      expect(await prisma.draft.count()).toBe(draftsBefore);
    });

    it('rejects invalid and extra HTTP fields without creating a draft', async () => {
      const { token } = await registerAndLogin(app);
      const draftsBefore = await prisma.draft.count();

      await request(app.getHttpServer())
        .post('/draft/create')
        .set('Authorization', `Bearer ${token}`)
        .send({ side: 'PURPLE' })
        .expect(400);
      await request(app.getHttpServer())
        .post('/draft/create')
        .set('Authorization', `Bearer ${token}`)
        .send({ side: 'BLUE', unexpected: true })
        .expect(400);

      expect(await prisma.draft.count()).toBe(draftsBefore);
    });

    it('rejects missing or malformed HTTP credentials without changing state', async () => {
      const draftsBefore = await prisma.draft.count();

      await request(app.getHttpServer())
        .post('/draft/create')
        .send({ side: 'BLUE' })
        .expect(401);
      await request(app.getHttpServer())
        .post('/draft/create')
        .set('Authorization', 'Bearer malformed-token')
        .send({ side: 'BLUE' })
        .expect(401);

      expect(await prisma.draft.count()).toBe(draftsBefore);
    });

    it('disconnects a socket presenting invalid credentials', async () => {
      const invalidToken = jwt.sign(
        { sub: 1, username: 'attacker' },
        'wrong-signing-secret',
        { expiresIn: 900 },
      );
      const address = app.getHttpServer().address() as { port: number };
      const socket = Client(`http://localhost:${address.port}`, {
        transports: ['websocket', 'polling'],
        extraHeaders: { Origin: 'http://localhost:3000' },
        auth: { token: invalidToken },
      });
      const authError = once(socket, 'auth.error');
      const disconnected = once(socket, 'disconnect');

      const [error] = await Promise.all([authError, disconnected]);
      expect(error.message).toContain('Invalid or expired access token');
      expect(socket.connected).toBe(false);
    });

    it('prevents an anonymous socket from joining a participant room', async () => {
      const owner = await registerAndLogin(app);
      const create = await request(app.getHttpServer())
        .post('/draft/create')
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ side: 'BLUE' })
        .expect(201);
      const draft = await prisma.draft.findUniqueOrThrow({
        where: { code: create.body.code },
      });
      const socket = await connectSocket(app);

      const outcome = await emitForOutcome(socket, 'draft.join', {
        code: create.body.code,
      });

      expect(outcome.exception?.message).toContain(
        'Socket is not authenticated',
      );
      expect(await redis.client.get(`draft:${draft.id}:session`)).toBeNull();
      socket.disconnect();
    });

    it('prevents an authenticated non-participant from joining a participant room', async () => {
      const owner = await registerAndLogin(app);
      const outsider = await registerAndLogin(app);
      const create = await request(app.getHttpServer())
        .post('/draft/create')
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ side: 'BLUE' })
        .expect(201);
      const draft = await prisma.draft.findUniqueOrThrow({
        where: { code: create.body.code },
      });
      const socket = await connectSocket(app, outsider.token);

      const outcome = await emitForOutcome(socket, 'draft.join', {
        code: create.body.code,
      });

      expect(outcome.exception?.message).toContain(
        'You are not a participant of this draft',
      );
      expect(await redis.client.get(`draft:${draft.id}:session`)).toBeNull();
      socket.disconnect();
    });

    it('rejects malformed Socket.IO payloads without changing pending state', async () => {
      const owner = await registerAndLogin(app);
      const create = await request(app.getHttpServer())
        .post('/draft/create')
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ side: 'BLUE' })
        .expect(201);
      const draft = await prisma.draft.findUniqueOrThrow({
        where: { code: create.body.code },
      });
      const socket = await connectSocket(app, owner.token);

      const joined = await emitForOutcome(socket, 'draft.join', {
        code: create.body.code,
      });
      expect(joined.ack?.ok).toBe(true);

      const invalid = await emitForOutcome(socket, 'ban.select', {
        championId: 'x\'; DROP TABLE "Ban";--',
      });
      expect(invalid.exception?.message).toContain(
        'championId contains invalid characters',
      );

      const session = JSON.parse(
        (await redis.client.get(`draft:${draft.id}:session`)) as string,
      );
      expect(session.pending).toEqual({});
      expect(await prisma.ban.count()).toBe(0);
      socket.disconnect();
    });
  });

  describe('9.5 secret and sensitive-detail redaction', () => {
    it('does not emit passwords, tokens, query strings, or draft codes in errors or logs', async () => {
      const { token, refreshToken } = await registerAndLogin(app);
      const messages: string[] = [];
      const collect = (message: unknown, ...optional: unknown[]) => {
        messages.push([message, ...optional].map(String).join(' '));
      };
      const warnSpy = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(collect);
      const errorSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(collect);
      const logSpy = jest
        .spyOn(Logger.prototype, 'log')
        .mockImplementation(collect);

      const password = 'NeverLogThisPassword!';
      const login = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ username: uniqueUsername('logged'), password })
        .expect(401);

      const draftCode = 'SECRET1';
      const draftError = await request(app.getHttpServer())
        .get(`/draft/${draftCode}?access_token=${token}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);

      const loginText = JSON.stringify(login.body);
      const draftText = JSON.stringify(draftError.body);
      const logText = messages.join('\n');

      expect(loginText).not.toContain(password);
      expect(loginText).not.toContain(token);
      expect(loginText).not.toContain(refreshToken);
      expect(draftText).not.toContain(draftCode);
      expect(draftText).not.toContain(token);
      expect(draftError.body.path).toBe('/draft/[redacted]');
      expect(logText).not.toContain(password);
      expect(logText).not.toContain(token);
      expect(logText).not.toContain(refreshToken);
      expect(logText).not.toContain(draftCode);

      warnSpy.mockRestore();
      errorSpy.mockRestore();
      logSpy.mockRestore();
    });
  });
});
