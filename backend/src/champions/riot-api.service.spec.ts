import { ServiceUnavailableException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { RiotApiService } from './riot-api.service';
import { RedisService } from '../redis/redis.service';

const CHAMPIONS_CACHE_KEY = 'champions:data';
const CHAMPIONS_VERSIONS_KEY = 'champions:versions';

const cachedPool = {
  patch: '14.1.1',
  count: 2,
  data: [
    {
      id: 'Ahri',
      name: 'Ahri',
      iconUrl: 'https://cdn/14.1.1/img/champion/Ahri.png',
    },
    {
      id: 'Akali',
      name: 'Akali',
      iconUrl: 'https://cdn/14.1.1/img/champion/Akali.png',
    },
  ],
};

function makeRedis(overrides: Record<string, any> = {}) {
  const store: Record<string, string> = {};
  const get = jest.fn(async (key: string) =>
    key in store ? store[key] : null,
  );
  const set = jest.fn(async (key: string, value: string, _ttl?: number) => {
    store[key] = value;
    return undefined;
  });
  const del = jest.fn(async (key: string) => {
    delete store[key];
    return 1;
  });
  return {
    client: { keys: jest.fn(async () => Object.keys(store)) },
    get,
    set,
    del,
    ...overrides,
  };
}

function makeFetch(
  handler: (
    url: string,
  ) => Promise<{ ok: boolean; status: number; json: () => unknown }>,
) {
  (globalThis as any).fetch = jest.fn(async (url: string) =>
    handler(String(url)),
  );
}

describe('RiotApiService (unit)', () => {
  let service: RiotApiService;
  let moduleRef: TestingModule;
  let redis: ReturnType<typeof makeRedis>;

  beforeEach(async () => {
    jest.clearAllMocks();
    redis = makeRedis();
    moduleRef = await Test.createTestingModule({
      providers: [RiotApiService, { provide: RedisService, useValue: redis }],
    }).compile();
    service = moduleRef.get(RiotApiService);
    // Make retry sleeps instant so failure/backoff paths complete quickly.
    (service as any).sleep = (_ms: number) => Promise.resolve();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('cache hit', () => {
    it('serves the cached pool without calling the CDN', async () => {
      redis.get.mockImplementation((key: string) => {
        if (key === CHAMPIONS_CACHE_KEY) {
          return Promise.resolve(JSON.stringify(cachedPool));
        }
        if (key === CHAMPIONS_VERSIONS_KEY) {
          return Promise.resolve(cachedPool.patch);
        }
        return Promise.resolve(null);
      });
      makeFetch(async () => {
        throw new Error('CDN must not be called on a cache hit');
      });

      const result = await service.getChampions();

      expect(result).toEqual({
        count: cachedPool.count,
        data: cachedPool.data,
      });
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('treats a corrupt cache entry as a miss and refetches', async () => {
      redis.get.mockImplementation((key: string) => {
        if (key === CHAMPIONS_CACHE_KEY) {
          return Promise.resolve('{not valid json');
        }
        if (key === CHAMPIONS_VERSIONS_KEY) {
          return Promise.resolve(null);
        }
        return Promise.resolve(null);
      });
      const fresh = {
        patch: '14.2.1',
        count: 1,
        data: [
          {
            id: 'Ahri',
            name: 'Ahri',
            iconUrl: 'https://cdn/14.2.1/img/champion/Ahri.png',
          },
        ],
      };
      makeFetch(async (url) => {
        if (url.includes('versions.json')) {
          return {
            ok: true,
            status: 200,
            json: async () => ['14.2.1', '14.1.1'],
          };
        }
        if (url.includes('champion.json')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: { Ahri: { id: 'Ahri', name: 'Ahri' } },
            }),
          };
        }
        throw new Error('unexpected url: ' + url);
      });

      const result = await service.getChampions();

      expect(result).toEqual({
        count: 1,
        data: fresh.data.map((c) => ({
          ...c,
          iconUrl: `https://ddragon.leagueoflegends.com/cdn/14.2.1/img/champion/${c.id}.png`,
        })),
      });
      expect(redis.set).toHaveBeenCalledWith(
        CHAMPIONS_CACHE_KEY,
        expect.stringContaining('"patch":"14.2.1"'),
      );
    });
  });

  describe('cache miss → CDN', () => {
    it('fetches versions then champions, normalizes, writes cache, and returns the pool', async () => {
      redis.get.mockResolvedValue(null);
      makeFetch(async (url) => {
        if (url.includes('versions.json')) {
          return {
            ok: true,
            status: 200,
            json: async () => ['14.3.1', '14.2.1'],
          };
        }
        if (url.includes('champion.json')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: {
                Ahri: { id: 'Ahri', name: 'Ahri' },
                Akali: { id: 'Akali', name: 'Akali' },
              },
            }),
          };
        }
        throw new Error('unexpected url: ' + url);
      });

      const result = await service.getChampions();

      expect(result.count).toBe(2);
      expect(result.data.map((c) => c.id)).toEqual(['Ahri', 'Akali']);
      expect(result.data[0].iconUrl).toBe(
        'https://ddragon.leagueoflegends.com/cdn/14.3.1/img/champion/Ahri.png',
      );
      expect(redis.set).toHaveBeenCalledWith(
        CHAMPIONS_VERSIONS_KEY,
        '14.3.1',
        3600,
      );
      expect(redis.set).toHaveBeenCalledWith(
        CHAMPIONS_CACHE_KEY,
        expect.stringContaining('"patch":"14.3.1"'),
      );
    });
  });

  describe('patch change invalidation', () => {
    it('refetches when the cached patch is stale compared to versions.json', async () => {
      redis.get.mockImplementation((key: string) => {
        if (key === CHAMPIONS_CACHE_KEY) {
          return Promise.resolve(JSON.stringify(cachedPool)); // patch 14.1.1
        }
        if (key === CHAMPIONS_VERSIONS_KEY) {
          return Promise.resolve(null);
        }
        return Promise.resolve(null);
      });
      makeFetch(async (url) => {
        if (url.includes('versions.json')) {
          return {
            ok: true,
            status: 200,
            json: async () => ['14.4.1', '14.1.1'],
          };
        }
        if (url.includes('champion.json')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: { Akali: { id: 'Akali', name: 'Akali' } },
            }),
          };
        }
        throw new Error('unexpected url: ' + url);
      });

      const result = await service.getChampions();

      expect(result.count).toBe(1);
      expect(result.data[0].id).toBe('Akali');
      expect(result.data[0].iconUrl).toBe(
        'https://ddragon.leagueoflegends.com/cdn/14.4.1/img/champion/Akali.png',
      );
      expect(redis.set).toHaveBeenCalledWith(
        CHAMPIONS_CACHE_KEY,
        expect.stringContaining('"patch":"14.4.1"'),
      );
    });
  });

  describe('CDN failure handling', () => {
    it('throws ServiceUnavailableException when the CDN is fully unreachable and no cache exists', async () => {
      redis.get.mockResolvedValue(null);
      makeFetch(async () => {
        throw new Error('ECONNREFUSED');
      });

      await expect(service.getChampions()).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    });

    it('serves the cached pool when the CDN is down but a fallback patch is known', async () => {
      redis.get.mockImplementation((key: string) => {
        if (key === CHAMPIONS_CACHE_KEY) {
          return Promise.resolve(JSON.stringify(cachedPool));
        }
        if (key === CHAMPIONS_VERSIONS_KEY) {
          return Promise.resolve(null);
        }
        return Promise.resolve(null);
      });
      makeFetch(async () => {
        throw new Error('ECONNREFUSED');
      });

      const result = await service.getChampions();

      expect(result).toEqual({
        count: cachedPool.count,
        data: cachedPool.data,
      });
      expect(globalThis.fetch).toHaveBeenCalled();
    });
  });

  describe('single-flight guard', () => {
    it('deduplicates concurrent cache misses into one fetch cycle', async () => {
      redis.get.mockResolvedValue(null);
      let calls = 0;
      makeFetch(async (url) => {
        calls++;
        if (url.includes('versions.json')) {
          return { ok: true, status: 200, json: async () => ['14.5.1'] };
        }
        if (url.includes('champion.json')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: { Ahri: { id: 'Ahri', name: 'Ahri' } },
            }),
          };
        }
        throw new Error('unexpected url: ' + url);
      });

      const [a, b] = await Promise.all([
        service.getChampions(),
        service.getChampions(),
      ]);

      expect(a).toEqual(b);
      expect(calls).toBe(2); // one versions.json + one champion.json fetch, shared across both callers
    });
  });
});
