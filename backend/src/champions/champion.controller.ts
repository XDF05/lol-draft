import { Controller, Get } from '@nestjs/common';
import { RiotApiService } from './riot-api.service';
import { ChampionsResponse } from './entities/champion.entity';

@Controller('champions')
export class ChampionController {
  constructor(private readonly riotApiService: RiotApiService) {}

  /**
   * Public champion pool (no auth required — local-only deployment, see
   * main.ts CORS policy). Returns `{ count, data }`; responds 503 with
   * "Champion pool unavailable" when neither the cache nor the Riot API can
   * serve it (EC-003).
   */
  @Get()
  getChampions(): Promise<ChampionsResponse> {
    return this.riotApiService.getChampions();
  }
}
