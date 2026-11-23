import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Socket } from 'socket.io';
import { AuthService } from '../auth/auth.service';
import { SocketUser } from './socket-events';

/**
 * Socket-level counterpart of the HTTP `JwtAuthGuard` (T-003).
 *
 * The client presents its JWT either in the Socket.IO handshake
 * (`io(url, { auth: { token } })`) or in an `Authorization: Bearer` header.
 * On success the identity is cached on the socket
 * (`client.data.user = { id, username }`).
 *
 * - `authenticate()` is called from `handleConnection`; a failed handshake is
 *   rejected with an `auth.error` event followed by a forced disconnect.
 * - `canActivate()` allows the guard to be reused with `@UseGuards` on
 *   individual message handlers if needed.
 */
@Injectable()
export class WsJwtGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  /** Validate a socket's credentials; throws UnauthorizedException on failure. */
  async authenticate(client: Socket): Promise<SocketUser> {
    const token =
      (client.handshake.auth?.token as string | undefined)?.trim() ??
      bearerFrom(client.handshake.headers?.authorization);

    if (!token) {
      throw new UnauthorizedException('Missing socket auth token');
    }

    const payload = this.authService.verifyAccessToken(token);
    if (await this.authService.isAccessTokenRevoked(token)) {
      throw new UnauthorizedException('Access token has been revoked');
    }
    return { id: payload.sub, username: payload.username };
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const client = context.switchToWs().getClient<Socket>();
    const user = await this.authenticate(client);
    client.data.user = user;
    return true;
  }
}

function bearerFrom(header: string | undefined): string | undefined {
  if (header && header.startsWith('Bearer ')) {
    return header.slice('Bearer '.length).trim();
  }
  return undefined;
}
