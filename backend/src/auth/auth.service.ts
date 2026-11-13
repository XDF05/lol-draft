import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import * as jwt from 'jsonwebtoken';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RegisterDto } from './dto/register.dto';
import { UserEntity, toPublicUser } from './entities/user.entity';

/** bcrypt cost factor 12 per T-003 security requirements. */
const BCRYPT_COST = 12;
/** Access tokens expire after 15 minutes (900s) per T-003 security requirements. */
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
/** Refresh tokens are stored in Redis with a TTL of 7 days by default. */
const REFRESH_TOKEN_TTL_SECONDS = Number(
  process.env.REFRESH_TOKEN_TTL_SECONDS ?? 7 * 24 * 60 * 60,
);

// Pre-computed so the "unknown user" login path costs the same bcrypt work
// as a real comparison (avoids username-enumeration timing leaks).
const DUMMY_HASH = bcrypt.hashSync('timing-equalizer', BCRYPT_COST);

export interface LoginResult {
  access_token: string;
  refresh_token: string;
  expiresIn: number;
}

export interface AccessTokenPayload {
  sub: number;
  username: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  private get jwtSecret(): string {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      throw new Error('JWT_SECRET environment variable is not set');
    }
    return secret;
  }

  async register(dto: RegisterDto): Promise<UserEntity> {
    const [byUsername, byEmail] = await Promise.all([
      this.prisma.user.findUnique({ where: { username: dto.username } }),
      this.prisma.user.findUnique({ where: { email: dto.email } }),
    ]);
    if (byUsername) {
      throw new ConflictException('Username is already taken');
    }
    if (byEmail) {
      throw new ConflictException('Email is already registered');
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_COST);
    const user = await this.prisma.user.create({
      data: {
        username: dto.username,
        email: dto.email,
        passwordHash,
      },
    });
    return toPublicUser(user);
  }

  async login(dto: LoginDto): Promise<LoginResult> {
    const user = await this.prisma.user.findUnique({
      where: { username: dto.username },
    });

    // Always run a real bcrypt comparison, even for unknown users.
    const valid = await bcrypt.compare(
      dto.password,
      user?.passwordHash ?? DUMMY_HASH,
    );
    if (!user || !valid) {
      throw new UnauthorizedException('Invalid username or password');
    }

    return this.issueTokens(user.id, user.username);
  }

  /**
   * Refresh token rotation: the presented refresh token is single-use.
   * It is deleted from Redis and replaced with a fresh access/refresh pair.
   */
  async refresh(dto: RefreshTokenDto): Promise<LoginResult> {
    const key = this.refreshKey(dto.refresh_token);
    const storedUserId = await this.redis.get(key);
    if (!storedUserId) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: Number(storedUserId) },
    });
    if (!user) {
      throw new UnauthorizedException('Unknown user for refresh token');
    }

    // Rotate: invalidate the old token, then issue a new pair.
    await this.redis.del(key);
    return this.issueTokens(user.id, user.username);
  }

  /** Verify an access token and return its payload (throws on invalid/expired). */
  verifyAccessToken(token: string): AccessTokenPayload {
    let decoded: jwt.JwtPayload & AccessTokenPayload;
    try {
      decoded = jwt.verify(token, this.jwtSecret) as jwt.JwtPayload &
        AccessTokenPayload;
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }
    return { sub: decoded.sub, username: decoded.username };
  }

  private async issueTokens(
    userId: number,
    username: string,
  ): Promise<LoginResult> {
    const accessToken = jwt.sign(
      { sub: userId, username },
      this.jwtSecret,
      { expiresIn: ACCESS_TOKEN_TTL_SECONDS },
    );

    // Opaque refresh token stored in Redis with TTL (single-use).
    const refreshToken = crypto.randomBytes(48).toString('hex');
    await this.redis.set(
      this.refreshKey(refreshToken),
      String(userId),
      REFRESH_TOKEN_TTL_SECONDS,
    );

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    };
  }

  private refreshKey(token: string): string {
    return `auth:refresh:${token}`;
  }
}
