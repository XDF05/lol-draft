import { ConflictException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import * as jwt from 'jsonwebtoken';
import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';

const BCRYPT_COST = 12;

const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    create: jest.fn(),
  },
};

const mockRedis = {
  get: jest.fn(),
  getDel: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
};

const JWT_SECRET = 'test-secret-do-not-use-in-production';

function moduleWithOverrides(env: Record<string, string | undefined>) {
  const originalEnv = { ...process.env };
  Object.entries(env).forEach(([key, value]) => {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  });
  return {
    restore: () => {
      process.env = originalEnv;
    },
  };
}

describe('AuthService (unit)', () => {
  let service: AuthService;
  let moduleRef: TestingModule;

  beforeEach(async () => {
    jest.clearAllMocks();
    moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: RedisService, useValue: mockRedis },
      ],
    }).compile();
    service = moduleRef.get(AuthService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('register', () => {
    const dto: RegisterDto = {
      username: 'alice',
      email: 'alice@example.com',
      password: 'Password123!',
    };

    it('creates a user with a bcrypt hash and returns the public identity', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      let capturedHash: string | undefined;
      mockPrisma.user.create.mockImplementation((args) => {
        capturedHash = args.data.passwordHash as string | undefined;
        return Promise.resolve({
          id: 1,
          username: dto.username,
          email: dto.email,
          passwordHash: capturedHash,
          createdAt: new Date(),
        });
      });

      const result = await service.register(dto);

      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { username: dto.username },
      });
      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: dto.email },
      });
      expect(typeof capturedHash).toBe('string');
      // The stored hash must be a real bcrypt hash of the submitted password.
      expect(await bcrypt.compare(dto.password, capturedHash!)).toBe(true);
      expect(result).toEqual({
        id: 1,
        username: dto.username,
        email: dto.email,
        createdAt: expect.any(Date),
      });
      // `toPublicUser` must never expose the password hash.
      expect('passwordHash' in result).toBe(false);
    });

    it('rejects a duplicate username', async () => {
      mockPrisma.user.findUnique.mockImplementation(({ where }) => {
        if (where.username === dto.username) {
          return Promise.resolve({ id: 1, username: dto.username });
        }
        return Promise.resolve(null);
      });

      await expect(service.register(dto)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(mockPrisma.user.create).not.toHaveBeenCalled();
    });

    it('rejects a duplicate email', async () => {
      mockPrisma.user.findUnique.mockImplementation(({ where }) => {
        if (where.email === dto.email) {
          return Promise.resolve({ id: 2, email: dto.email });
        }
        return Promise.resolve(null);
      });

      await expect(service.register(dto)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(mockPrisma.user.create).not.toHaveBeenCalled();
    });
  });

  describe('login', () => {
    const dto: LoginDto = { username: 'alice', password: 'Password123!' };

    it('issues tokens for valid credentials', async () => {
      const hash = await bcrypt.hash(dto.password, BCRYPT_COST);
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 1,
        username: dto.username,
        passwordHash: hash,
      });

      const result = await service.login(dto);

      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { username: dto.username },
      });
      expect(result.access_token).toBeDefined();
      expect(result.refresh_token).toBeDefined();
      expect(result.expiresIn).toBe(15 * 60);

      const decoded = jwt.verify(
        result.access_token,
        JWT_SECRET,
      ) as unknown as { sub: number; username: string };
      expect(decoded.username).toBe(dto.username);
    });

    it('rejects an invalid password', async () => {
      const hash = await bcrypt.hash(dto.password, BCRYPT_COST);
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 1,
        username: dto.username,
        passwordHash: hash,
      });

      await expect(
        service.login({ username: dto.username, password: 'WrongPassword123!' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects an unknown user without leaking existence', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(service.login(dto)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      // A real bcrypt comparison still runs against the timing-equalizer hash.
      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { username: dto.username },
      });
    });
  });

  describe('refresh', () => {
    const dto: RefreshTokenDto = { refresh_token: 'refresh-token-abc' };
    const storedUserId = '1';

    it('rotates the refresh token and issues a new pair', async () => {
      mockRedis.getDel.mockResolvedValue(storedUserId);
      mockPrisma.user.findUnique.mockResolvedValue({ id: 1, username: 'alice' });

      const result = await service.refresh(dto);

      expect(mockRedis.getDel).toHaveBeenCalledWith(
        `auth:refresh:${dto.refresh_token}`,
      );
      expect(mockRedis.del).not.toHaveBeenCalledWith(
        `auth:refresh:${dto.refresh_token}`,
      );
      expect(result.access_token).toBeDefined();
      expect(result.refresh_token).toBeDefined();
      expect(result.expiresIn).toBe(15 * 60);
    });

    it('rejects an unknown or expired refresh token', async () => {
      mockRedis.getDel.mockResolvedValue(null);

      await expect(service.refresh(dto)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
      expect(mockRedis.del).not.toHaveBeenCalled();
    });

    it('rejects a refresh token for a missing user after consuming it', async () => {
      mockRedis.getDel.mockResolvedValue('999');
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(service.refresh(dto)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      // GETDEL consumes even an orphaned token, preventing repeated lookup
      // of a user that no longer exists.
      expect(mockRedis.getDel).toHaveBeenCalledWith(
        `auth:refresh:${dto.refresh_token}`,
      );
    });
  });

  describe('verifyAccessToken', () => {
    it('returns the payload for a valid token', () => {
      const override = moduleWithOverrides({ JWT_SECRET });
      const token = jwt.sign({ sub: 7, username: 'bob' }, JWT_SECRET, {
        expiresIn: 15 * 60,
      });

      const payload = service.verifyAccessToken(token);

      expect(payload).toEqual({
        sub: 7,
        username: 'bob',
        exp: expect.any(Number),
      });
      override.restore();
    });

    it('rejects an expired token', async () => {
      const override = moduleWithOverrides({ JWT_SECRET });
      const token = jwt.sign({ sub: 7, username: 'bob' }, JWT_SECRET, {
        expiresIn: 1,
      });
      await new Promise((resolve) => setTimeout(resolve, 1100));

      expect(() => service.verifyAccessToken(token)).toThrow(
        UnauthorizedException,
      );
      override.restore();
    });

    it('rejects a malformed token', () => {
      const override = moduleWithOverrides({ JWT_SECRET });
      expect(() => service.verifyAccessToken('not.a.valid.token')).toThrow(
        UnauthorizedException,
      );
      override.restore();
    });
  });
});
