import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ChampionsModule } from '../champions/champions.module';
import { ConnectionHealthService } from './connection-health.service';
import { DraftEventsGateway } from './draft-events.gateway';
import { DraftSessionService } from './draft-session.service';
import { TurnManagerService } from './turn-manager.service';
import { WsJwtGuard } from './ws-jwt.guard';

/**
 * Real-time draft event infrastructure (T-006).
 *
 * PrismaModule and RedisModule are global, so only AuthModule (for the JWT
 * verification shared with the HTTP API) needs importing here. The Socket.IO
 * server attaches to the existing HTTP server (default path `/socket.io`).
 */
@Module({
  imports: [AuthModule, ChampionsModule],
  providers: [
    DraftEventsGateway,
    DraftSessionService,
    ConnectionHealthService,
    WsJwtGuard,
    TurnManagerService,
  ],
  exports: [
    DraftSessionService,
    ConnectionHealthService,
    DraftEventsGateway,
    TurnManagerService,
  ],
})
export class DraftEventsModule {}
