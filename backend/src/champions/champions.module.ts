import { Module } from '@nestjs/common';
import { RedisModule } from '../redis/redis.module';
import { ChampionController } from './champion.controller';
import { RiotApiService } from './riot-api.service';

@Module({
  imports: [RedisModule],
  controllers: [ChampionController],
  providers: [RiotApiService],
  exports: [RiotApiService],
})
export class ChampionsModule {}
