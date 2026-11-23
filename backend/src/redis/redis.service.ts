import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import Redis from 'ioredis';

/**
 * Thin wrapper around an ioredis client.
 *
 * Used for:
 * - Refresh token storage (auth sessions) with TTL
 * - Rate limit counters
 * - Champion data caching (version-pinned, no TTL) — added in T-005
 */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  readonly client: Redis;

  constructor() {
    const host = process.env.REDIS_HOST ?? '127.0.0.1';
    const port = Number(process.env.REDIS_PORT ?? 6379);
    this.client = new Redis({
      host,
      port,
      maxRetriesPerRequest: null,
      keyPrefix: '',
    });
    this.client.on('error', (err) => {
      this.logger.error(`Redis error: ${err.message}`);
    });
  }

  async onModuleInit(): Promise<void> {
    // ioredis connects lazily/retries in the background; log readiness.
    this.client.on('ready', () => {
      this.logger.log('Redis connection ready');
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit().catch(() => undefined);
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  /** Set a key; pass seconds for a TTL (e.g. `set(key, value, 900)`). */
  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds !== undefined) {
      await this.client.set(key, value, 'EX', ttlSeconds);
    } else {
      await this.client.set(key, value);
    }
  }

  async del(key: string): Promise<number> {
    return this.client.del(key);
  }

  /**
   * Atomically read and delete a key.
   *
   * Used for single-use refresh-token rotation: two concurrent refresh
   * requests cannot both observe the same token before it is invalidated.
   */
  async getDel(key: string): Promise<string | null> {
    return this.client.getdel(key);
  }

  /** INCR a counter and set its TTL on first hit. Returns the new count. */
  async incrementWithTtl(key: string, ttlSeconds: number): Promise<number> {
    const count = await this.client.incr(key);
    if (count === 1) {
      await this.client.expire(key, ttlSeconds);
    }
    return count;
  }
}
