import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from './auth.service';

/**
 * Validates `Authorization: Bearer <jwt>` and attaches
 * `request.user = { id, username }` for downstream handlers.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const header: string | undefined = request.headers?.['authorization'];

    if (!header || !header.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }

    const token = header.slice('Bearer '.length).trim();
    const payload = this.authService.verifyAccessToken(token);

    request.user = { id: payload.sub, username: payload.username };
    return true;
  }
}
