import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { AuthModule } from './auth/auth.module';
import { ChampionsModule } from './champions/champions.module';
import { DraftEventsModule } from './draft-events/draft-events.module';
import { DraftModule } from './draft/draft.module';

@Module({
  imports: [
    PrismaModule,
    RedisModule,
    AuthModule,
    ChampionsModule,
    DraftEventsModule,
    DraftModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
