import {
  CanActivate,
  ExecutionContext,
  HttpException,
  Injectable,
} from '@nestjs/common';
import { RedisService } from '../redis/redis.service';

const WINDOW_SECONDS = 60;
const MAX_ATTEMPTS = 5; // T-003: rate limiting — 5 login attempts per minute

/**
 * Sliding-window (fixed 60s) counter in Redis, keyed by client IP.
 * The first request of a window starts the TTL; more than 5 login
 * attempts within the window get HTTP 429.
 */
@Injectable()
export class LoginRateLimitGuard implements CanActivate {
  constructor(private readonly redis: RedisService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const ip: string = request.ip ?? 'unknown';

    const count = await this.redis.incrementWithTtl(
      `rate_limit:login:${ip}`,
      WINDOW_SECONDS,
    );
    if (count > MAX_ATTEMPTS) {
      throw new HttpException('Too many login attempts. Try again later.', 429);
    }
    return true;
  }
}
