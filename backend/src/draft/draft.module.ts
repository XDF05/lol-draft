import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DraftEventsModule } from '../draft-events/draft-events.module';
import { DraftCleanupService } from './draft-cleanup.service';
import { DraftCreationController } from './draft-creation.controller';
import { DraftService } from './draft.service';
import { PublicDraftController } from './public-draft.controller';

/**
 * Draft room creation flow (T-008).
 *
 * DraftEventsModule provides the gateway (for broadcasting the draft-start
 * snapshot to the room) and the live Redis session service; Prisma and Redis
 * modules are global. AuthModule provides the shared JwtAuthGuard.
 */
@Module({
  imports: [AuthModule, DraftEventsModule],
  controllers: [DraftCreationController, PublicDraftController],
  providers: [DraftService, DraftCleanupService],
})
export class DraftModule {}
