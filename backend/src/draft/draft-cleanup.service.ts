import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { DraftSessionService } from '../draft-events/draft-session.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  DRAFT_CLEANUP_INTERVAL_MS,
  EXPIRED_DRAFT_RETENTION_MS,
  WAITING_DRAFT_TTL_MS,
} from './draft.constants';

/**
 * Background draft cleanup (T-015: "Auto-delete draft after session
 * timeout").
 *
 * - Waiting drafts that nobody joined within the TTL are removed (the same
 *   cleanup also runs lazily on read in DraftService).
 * - Expired drafts are retained briefly so connected players/spectators can
 *   render the `draft.expired` notice, then hard-deleted with their bans,
 *   picks (schema cascade) and live Redis session.
 *
 * The conditional delete re-checks the row's status so a draft that starts
 * between the sweep's query and the delete is never removed.
 */
@Injectable()
export class DraftCleanupService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DraftCleanupService.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: DraftSessionService,
  ) {}

  onModuleInit(): void {
    const intervalMs =
      Number(process.env.DRAFT_CLEANUP_INTERVAL_MS) ||
      DRAFT_CLEANUP_INTERVAL_MS;
    this.timer = setInterval(() => {
      void this.sweep().catch((err: unknown) => {
        this.logger.error(
          `cleanup sweep failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      });
    }, intervalMs);
    // The cleanup sweep must not keep the process alive on shutdown.
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Delete stale waiting drafts and expired drafts past retention. */
  async sweep(now = Date.now()): Promise<void> {
    const waitingCutoff = new Date(now - WAITING_DRAFT_TTL_MS);
    const expiredCutoff = new Date(now - EXPIRED_DRAFT_RETENTION_MS);

    const stale = await this.prisma.draft.findMany({
      where: {
        OR: [
          {
            status: 'WAITING_FOR_PLAYERS',
            createdAt: { lt: waitingCutoff },
          },
          {
            status: 'EXPIRED',
            completedAt: { lt: expiredCutoff },
          },
        ],
      },
      select: { id: true },
    });

    let deleted = 0;
    for (const { id } of stale) {
      const result = await this.prisma.draft.deleteMany({
        where: {
          id,
          OR: [
            {
              status: 'WAITING_FOR_PLAYERS',
              createdAt: { lt: waitingCutoff },
            },
            {
              status: 'EXPIRED',
              completedAt: { lt: expiredCutoff },
            },
          ],
        },
      });
      if (result.count === 0) {
        continue;
      }
      deleted += result.count;
      await this.sessions.deleteSession(id);
    }

    if (deleted > 0) {
      this.logger.log(`cleanup: deleted ${deleted} stale draft(s)`);
    }
  }
}
