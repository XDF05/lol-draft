import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as jwt from 'jsonwebtoken';
import request from 'supertest';
import { AuthModule } from './auth.module';
import { DraftHttpExceptionFilter } from '../common/filters/draft-http-exception.filter';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

const JWT_SECRET =
  process.env.JWT_SECRET ?? 'test-secret-do-not-use-in-production';
let userCounter = 0;

function uniqueUsername(prefix = 'user') {
  return `${prefix}${++userCounter}`;
}

function flushRateLimitKeys(redis: RedisService) {
  return redis.client
    .keys('rate_limit:login:*')
    .then((keys) => Promise.all(keys.map((key) => redis.client.del(key))));
}

describe('AuthController (integration)', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let redis: RedisService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule, AuthModule],
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

    // Start from a clean user table in the isolated test database.
    await prisma.user.deleteMany();
  });

  beforeEach(async () => {
    // The login rate-limit counter is IP-scoped and shared across tests, so
    // reset it before every test to keep each case independent.
    await flushRateLimitKeys(redis);
  });

  afterAll(async () => {
    await app.close();
    await moduleRef.close();
  });

  describe('POST /auth/register', () => {
    it('registers a new user and returns its public identity without the hash', async () => {
      const username = uniqueUsername('alice');
      const res = await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          username,
          email: `${username}@example.com`,
          password: 'Password123!',
        })
        .expect(201);

      expect(res.body).toMatchObject({
        username,
        email: `${username}@example.com`,
      });
      expect(res.body.id).toEqual(expect.any(Number));
      expect(res.body.passwordHash).toBeUndefined();
      expect(res.body.createdAt).toBeDefined();
    });

    it('rejects a duplicate username with 409', async () => {
      const username = uniqueUsername('bob');
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          username,
          email: `${username}@example.com`,
          password: 'Password123!',
        })
        .expect(201);

      const res = await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          username,
          email: 'different@example.com',
          password: 'Password123!',
        })
        .expect(409);

      expect(res.body.statusCode).toBe(409);
      expect(res.body.code).toBe('CONFLICT');
      expect(res.body.message).toBe('Username or email is already registered');
    });

    it('rejects a duplicate email with 409', async () => {
      const username = uniqueUsername('carol');
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          username,
          email: 'shared@example.com',
          password: 'Password123!',
        })
        .expect(201);

      await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          username: uniqueUsername('carol2'),
          email: 'shared@example.com',
          password: 'Password123!',
        })
        .expect(409);
    });

    it('rejects invalid registration payloads with 400', async () => {
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ username: 'x', email: 'not-an-email', password: 'short' })
        .expect(400);
    });
  });

  describe('POST /auth/login', () => {
    it('issues an access token and refresh token for valid credentials', async () => {
      const username = uniqueUsername('dave');
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          username,
          email: `${username}@example.com`,
          password: 'Password123!',
        });

      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ username, password: 'Password123!' })
        .expect(201);

      expect(res.body.access_token).toBeDefined();
      expect(res.body.refresh_token).toBeDefined();
      expect(res.body.expiresIn).toBe(15 * 60);

      const decoded = jwt.verify(
        res.body.access_token,
        JWT_SECRET,
      ) as unknown as { sub: number; username: string };
      expect(decoded.username).toBe(username);
    });

    it('rejects an invalid password with 401', async () => {
      const username = uniqueUsername('erin');
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          username,
          email: `${username}@example.com`,
          password: 'Password123!',
        });

      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ username, password: 'WrongPassword123!' })
        .expect(401);
    });

    it('rejects login for an unknown user with 401', async () => {
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ username: 'does-not-exist', password: 'Password123!' })
        .expect(401);
    });

    it('applies the five-attempt login rate limit', async () => {
      const username = uniqueUsername('frank');

      for (let i = 0; i < 5; i++) {
        await request(app.getHttpServer())
          .post('/auth/login')
          .send({ username, password: 'WrongPassword123!' })
          .expect(401);
      }

      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ username, password: 'WrongPassword123!' })
        .expect(429);

      expect(res.body.statusCode).toBe(429);
      expect(res.body.message).toContain('Too many login attempts');
    });
  });

  describe('POST /auth/refresh', () => {
    it('rotates the refresh token and returns a new pair', async () => {
      const username = uniqueUsername('grace');
      const login = await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          username,
          email: `${username}@example.com`,
          password: 'Password123!',
        })
        .then(() =>
          request(app.getHttpServer())
            .post('/auth/login')
            .send({ username, password: 'Password123!' }),
        );
      const refreshToken = login.body.refresh_token;

      const res = await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refresh_token: refreshToken })
        .expect(201);

      expect(res.body.access_token).toBeDefined();
      expect(res.body.refresh_token).toBeDefined();
      expect(res.body.refresh_token).not.toBe(refreshToken);
    });

    it('rejects reuse of a rotated refresh token with 401', async () => {
      const username = uniqueUsername('heidi');
      const login = await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          username,
          email: `${username}@example.com`,
          password: 'Password123!',
        })
        .then(() =>
          request(app.getHttpServer())
            .post('/auth/login')
            .send({ username, password: 'Password123!' }),
        );
      const refreshToken = login.body.refresh_token;

      await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refresh_token: refreshToken })
        .expect(201);

      // The old token was single-use and deleted on rotation.
      await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refresh_token: refreshToken })
        .expect(401);
    });

    it('rejects an unknown refresh token with 401', async () => {
      await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refresh_token: 'unknown-token' })
        .expect(401);
    });
  });

  describe('GET /auth/me', () => {
    it('returns the current user for a valid bearer token', async () => {
      const username = uniqueUsername('ivan');
      const login = await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          username,
          email: `${username}@example.com`,
          password: 'Password123!',
        })
        .then(() =>
          request(app.getHttpServer())
            .post('/auth/login')
            .send({ username, password: 'Password123!' }),
        );

      const res = await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${login.body.access_token}`)
        .expect(200);

      expect(res.body).toEqual({ id: expect.any(Number), username });
    });

    it('rejects an expired access token with 401', async () => {
      const token = jwt.sign({ sub: 1, username: 'expired' }, JWT_SECRET, {
        expiresIn: 1,
      });
      await new Promise((resolve) => setTimeout(resolve, 1100));

      await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(401);
    });

    it('rejects a malformed bearer token with 401', async () => {
      await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', 'Bearer not-a-token')
        .expect(401);
    });

    it('rejects a request with no bearer token with 401', async () => {
      await request(app.getHttpServer()).get('/auth/me').expect(401);
    });
  });
});
