import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AuthModule } from '../auth/auth.module';
import { DraftModule } from './draft.module';
import { DraftCleanupService } from './draft-cleanup.service';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { DraftHttpExceptionFilter } from '../common/filters/draft-http-exception.filter';
import { WAITING_DRAFT_TTL_MS } from './draft.constants';

let userCounter = 0;
function uniqueUsername(prefix = 'user') {
  return `${prefix}${++userCounter}`;
}

async function registerAndLogin(app: INestApplication, username?: string) {
  const user = username ?? uniqueUsername();
  const email = `${user}@example.com`;
  await request(app.getHttpServer())
    .post('/auth/register')
    .send({ username: user, email, password: 'Password123!' })
    .expect(201);
  const res = await request(app.getHttpServer())
    .post('/auth/login')
    .send({ username: user, password: 'Password123!' })
    .expect(201);
  return { username: user, token: res.body.access_token };
}

describe('Draft room lifecycle (integration)', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let redis!: RedisService;
  let cleanup: DraftCleanupService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule, AuthModule, DraftModule],
    }).compile();

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

    prisma = app.get(PrismaService);
    redis = app.get(RedisService);
    cleanup = app.get(DraftCleanupService);

    await prisma.user.deleteMany();
    await prisma.draft.deleteMany();
  });

  afterAll(async () => {
    await app.close();
    await moduleRef.close();
  });

  // The login rate-limit counter is IP-scoped and shared across tests, so
  // reset it before every test to keep each case independent.
  beforeEach(async () => {
    await redis.client
      .keys('rate_limit:login:*')
      .then((keys) => Promise.all(keys.map((key) => redis.client.del(key))));
  });

  describe('POST /draft/create', () => {
    it('creates a waiting draft and assigns the creator to the chosen side', async () => {
      const { username, token } = await registerAndLogin(app);

      const res = await request(app.getHttpServer())
        .post('/draft/create')
        .set('Authorization', `Bearer ${token}`)
        .send({ side: 'BLUE' })
        .expect(201);

      expect(res.body.code).toMatch(/^[A-HJ-NP-Z2-9]{7}$/);
      expect(res.body.status).toBe('WAITING_FOR_PLAYERS');
      expect(res.body.message).toContain('Draft created');
    });

    it('rejects unauthenticated creation with 401', async () => {
      await request(app.getHttpServer())
        .post('/draft/create')
        .send({ side: 'BLUE' })
        .expect(401);
    });
  });

  describe('POST /draft/:code/join', () => {
    it('lets the second player claim the free side and start the draft', async () => {
      const creator = await registerAndLogin(app);
      const create = await request(app.getHttpServer())
        .post('/draft/create')
        .set('Authorization', `Bearer ${creator.token}`)
        .send({ side: 'BLUE' })
        .expect(201);
      const code = create.body.code;

      const joiner = await registerAndLogin(app, 'joiner');
      const res = await request(app.getHttpServer())
        .post(`/draft/${code}/join`)
        .set('Authorization', `Bearer ${joiner.token}`)
        .send({ side: 'RED' })
        .expect(201);

      expect(res.body.team).toBe('RED');
      expect(res.body.started).toBe(true);
      expect(res.body.draft.status).toBe('IN_PROGRESS');
      expect(res.body.draft.currentTurn).toBe(1);
    });

    it('rejects claiming an occupied side with 409', async () => {
      const creator = await registerAndLogin(app);
      const create = await request(app.getHttpServer())
        .post('/draft/create')
        .set('Authorization', `Bearer ${creator.token}`)
        .send({ side: 'BLUE' })
        .expect(201);
      const code = create.body.code;

      // Second player takes RED.
      const joiner = await registerAndLogin(app);
      await request(app.getHttpServer())
        .post(`/draft/${code}/join`)
        .set('Authorization', `Bearer ${joiner.token}`)
        .send({ side: 'RED' })
        .expect(201);

      // A third player cannot claim RED again.
      const third = await registerAndLogin(app);
      await request(app.getHttpServer())
        .post(`/draft/${code}/join`)
        .set('Authorization', `Bearer ${third.token}`)
        .send({ side: 'RED' })
        .expect(409);
    });

    it('is idempotent: re-joining returns the same team without restarting', async () => {
      const creator = await registerAndLogin(app);
      const create = await request(app.getHttpServer())
        .post('/draft/create')
        .set('Authorization', `Bearer ${creator.token}`)
        .send({ side: 'BLUE' })
        .expect(201);
      const code = create.body.code;

      const first = await request(app.getHttpServer())
        .post(`/draft/${code}/join`)
        .set('Authorization', `Bearer ${creator.token}`)
        .send({ side: 'BLUE' })
        .expect(201);

      expect(first.body.team).toBe('BLUE');
      expect(first.body.started).toBe(false);
      expect(first.body.draft.status).toBe('WAITING_FOR_PLAYERS');

      // Re-join again — still the same team, still waiting.
      const second = await request(app.getHttpServer())
        .post(`/draft/${code}/join`)
        .set('Authorization', `Bearer ${creator.token}`)
        .send({ side: 'BLUE' })
        .expect(201);

      expect(second.body.team).toBe('BLUE');
      expect(second.body.started).toBe(false);
    });

    it('awards the contested side to exactly one of two simultaneous joiners', async () => {
      const creator = await registerAndLogin(app);
      const create = await request(app.getHttpServer())
        .post('/draft/create')
        .set('Authorization', `Bearer ${creator.token}`)
        .send({ side: 'BLUE' })
        .expect(201);
      const code = create.body.code;

      // Creator took BLUE; RED is the only free side. Two users race for RED.
      const racer1 = await registerAndLogin(app, 'racer1');
      const racer2 = await registerAndLogin(app, 'racer2');

      const results = await Promise.all([
        request(app.getHttpServer())
          .post(`/draft/${code}/join`)
          .set('Authorization', `Bearer ${racer1.token}`)
          .send({ side: 'RED' }),
        request(app.getHttpServer())
          .post(`/draft/${code}/join`)
          .set('Authorization', `Bearer ${racer2.token}`)
          .send({ side: 'RED' }),
      ]);

      const codes = results.map((r) => r.body.code ?? null);
      const statuses = results.map((r) => r.status);
      const won = statuses.filter((s) => s === 201).length;
      const lost = statuses.filter((s) => s === 409).length;

      expect(won).toBe(1);
      expect(lost).toBe(1);
      // Exactly one side assignment exists in the database.
      const draft = await prisma.draft.findUnique({ where: { code } });
      expect(draft!.blueTeamPlayerId).toBeDefined();
      expect(draft!.redTeamPlayerId).toBeDefined();
      expect(draft!.blueTeamPlayerId).not.toBe(draft!.redTeamPlayerId);
    });

    it('rejects joining an unknown draft with 404', async () => {
      const { token } = await registerAndLogin(app);
      await request(app.getHttpServer())
        .post('/draft/NOPECODE/join')
        .set('Authorization', `Bearer ${token}`)
        .send({ side: 'RED' })
        .expect(404);
    });
  });

  describe('GET /draft/:code (participant lookup)', () => {
    it('returns the draft view for a participant', async () => {
      const creator = await registerAndLogin(app);
      const create = await request(app.getHttpServer())
        .post('/draft/create')
        .set('Authorization', `Bearer ${creator.token}`)
        .send({ side: 'BLUE' })
        .expect(201);
      const code = create.body.code;

      const res = await request(app.getHttpServer())
        .get(`/draft/${code}`)
        .set('Authorization', `Bearer ${creator.token}`)
        .expect(200);

      expect(res.body.code).toBe(code);
      expect(res.body.status).toBe('WAITING_FOR_PLAYERS');
      expect(res.body.bluePlayer.username).toBe(creator.username);
      expect(res.body.redPlayer).toBeNull();
    });
  });

  describe('GET /public/draft/:code (spectator lookup)', () => {
    it('returns public state for a completed draft without authentication', async () => {
      // Insert a COMPLETE draft directly so the public snapshot can be
      // verified without driving the full 21-turn socket flow.
      const creator = await prisma.user.create({
        data: {
          username: uniqueUsername('creator'),
          email: `${uniqueUsername()}@example.com`,
          passwordHash: 'hash',
        },
      });
      const opponent = await prisma.user.create({
        data: {
          username: uniqueUsername('opponent'),
          email: `${uniqueUsername()}@example.com`,
          passwordHash: 'hash',
        },
      });
      const draft = await prisma.draft.create({
        data: {
          code: 'PUBLIC1AB',
          status: 'COMPLETE',
          blueTeamPlayerId: creator.id,
          redTeamPlayerId: opponent.id,
          currentTurn: 21,
          completedAt: new Date(),
        },
      });
      await prisma.ban.create({
        data: {
          draftId: draft.id,
          championId: 'Ahri',
          phase: 1,
          playerId: creator.id,
          team: 'BLUE',
          locked: true,
        },
      });
      await prisma.pick.create({
        data: {
          draftId: draft.id,
          championId: 'Akali',
          playerId: creator.id,
          team: 'BLUE',
          locked: true,
        },
      });

      const res = await request(app.getHttpServer())
        .get('/public/draft/PUBLIC1AB')
        .expect(200);

      expect(res.body.code).toBe('PUBLIC1AB');
      expect(res.body.status).toBe('COMPLETE');
      expect(res.body.completedAt).toBeDefined();
      expect(res.body.bans.some((b: any) => b.championId === 'Ahri')).toBe(true);
      expect(res.body.picks.some((p: any) => p.championId === 'Akali')).toBe(true);
      // No pending (unlocked) selections are exposed publicly.
      expect(res.body.pending).toBeUndefined();
    });

    it('returns 404 for an unknown draft code without leaking details', async () => {
      await request(app.getHttpServer())
        .get('/public/draft/UNKNOWN')
        .expect(404);
    });
  });

  describe('waiting draft cleanup', () => {
    it('deletes a waiting draft older than the 5-minute TTL on sweep', async () => {
      const owner = await prisma.user.create({
        data: {
          username: uniqueUsername('stale'),
          email: `${uniqueUsername()}@example.com`,
          passwordHash: 'hash',
        },
      });
      const stale = await prisma.draft.create({
        data: {
          code: 'STALECD1',
          status: 'WAITING_FOR_PLAYERS',
          blueTeamPlayerId: owner.id,
          createdAt: new Date(Date.now() - WAITING_DRAFT_TTL_MS - 1000),
        },
      });

      // The lazy-read cleanup path: reading a stale waiting draft removes it
      // and resolves as not found.
      await cleanup.sweep(Date.now() + 10 * 60 * 1000);

      const row = await prisma.draft.findUnique({ where: { id: stale.id } });
      expect(row).toBeNull();
      // A read of the stale code resolves to 404 (no information leaked).
      await request(app.getHttpServer())
        .get('/public/draft/STALECD1')
        .expect(404);
    });
  });
});
