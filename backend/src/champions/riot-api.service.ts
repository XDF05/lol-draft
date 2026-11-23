import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { RedisService } from '../redis/redis.service';
import { Champion, ChampionsResponse } from './entities/champion.entity';

/**
 * Fetches the champion pool from Riot's Data Dragon CDN and caches it in
 * Redis.
 *
 * - `champions:data` holds `{ patch, count, data }` with no TTL: cached
 *   names/icons keep being served while the latest Data Dragon patch is
 *   unchanged — a new patch (detected via versions.json) invalidates it.
 * - `champions:versions` remembers the latest patch from
 *   GET {DATA_DRAGON_BASE_URL}/api/versions.json for 1h, so version checks
 *   are cheap and a new patch is picked up at most an hour after release.
 * - On a miss (or a new patch), fetches
 *   GET {DATA_DRAGON_BASE_URL}/cdn/<patch>/data/en_US/champion.json with a
 *   per-attempt timeout, up to 3 retries on exponential backoff (1s, 2s,
 *   4s), bounded by an overall 30-second deadline shared with the version
 *   lookup.
 * - When neither cache nor CDN can provide the pool, throws
 *   ServiceUnavailableException ("Champion pool unavailable") per EC-003.
 */

/** Redis key holding the normalized champion pool (T-005 acceptance criteria). */
export const CHAMPIONS_CACHE_KEY = 'champions:data';
/** Redis key remembering the latest Data Dragon patch currently served. */
export const CHAMPIONS_VERSIONS_KEY = 'champions:versions';
/** Public CDN base URL — works out of the box, override for stubs/tests. */
const DEFAULT_DATA_DRAGON_BASE_URL = 'https://ddragon.leagueoflegends.com';
/** How often we re-check versions.json for a new Data Dragon patch. */
const VERSIONS_TTL_SECONDS = 60 * 60; // 1 hour
/** Retry attempts after the initial one, with these delays between them. */
const MAX_RETRIES = 3;
const RETRY_DELAYS_MS = [1000, 2000, 4000]; // exponential backoff: 1s, 2s, 4s
/** Hard cap on the entire fallback (attempts + waits), per T-005 targets. */
const OVERALL_TIMEOUT_MS = 30_000;
/** Per-attempt HTTP timeout; also clamped by the remaining overall budget. */
const PER_ATTEMPT_TIMEOUT_MS = 8_000;

/** Cached payload: the public response plus the patch it was fetched for. */
interface CachedChampions extends ChampionsResponse {
  patch: string;
}

@Injectable()
export class RiotApiService {
  private readonly logger = new Logger(RiotApiService.name);

  /** Single-flight guard: concurrent cache misses share one fetch+cache cycle. */
  private inflight: Promise<ChampionsResponse> | null = null;

  constructor(private readonly redis: RedisService) {}

  /**
   * Returns the champion pool, served from cache when possible (no external
   * call on a hit). Throws ServiceUnavailableException only when neither the
   * cache nor the CDN can provide data.
   */
  async getChampions(): Promise<ChampionsResponse> {
    const cached = await this.readCache();
    if (cached) {
      // The pool stays valid while the latest Data Dragon patch is unchanged.
      const knownLatest = await this.cachedLatestPatch();
      if (knownLatest === cached.patch) {
        return { count: cached.count, data: cached.data };
      }
    }

    if (!this.inflight) {
      this.inflight = (async () => {
        const deadline = Date.now() + OVERALL_TIMEOUT_MS;
        const latest = await this.resolveLatestPatch(
          cached?.patch ?? null,
          deadline,
        );
        if (cached && cached.patch === latest) {
          // Version unchanged: keep serving the cached names/icons.
          return { count: cached.count, data: cached.data };
        }
        const pool = await this.fetchChampions(latest, deadline);
        // Best-effort: the request still succeeds if the cache write fails.
        await this.writeCache(latest, pool);
        return pool;
      })().finally(() => {
        this.inflight = null;
      });
    }
    return this.inflight;
  }

  /** Cache-hit path — never touches the external CDN. */
  private async readCache(): Promise<CachedChampions | null> {
    let raw: string | null;
    try {
      raw = await this.redis.get(CHAMPIONS_CACHE_KEY);
    } catch (err) {
      // Redis down: degrade to a live fetch instead of failing the request.
      this.logger.warn(
        `Redis read failed, bypassing cache: ${this.describe(err)}`,
      );
      return null;
    }
    if (!raw) {
      return null;
    }
    try {
      const parsed = JSON.parse(raw) as CachedChampions;
      if (
        !parsed ||
        typeof parsed.patch !== 'string' ||
        parsed.patch.length === 0 ||
        !Array.isArray(parsed.data)
      ) {
        return null;
      }
      return parsed;
    } catch {
      this.logger.warn('Cached champion data is corrupted, refetching');
      return null;
    }
  }

  /** Latest patch from the short-lived versions cache, if Redis has it. */
  private async cachedLatestPatch(): Promise<string | null> {
    try {
      const raw = await this.redis.get(CHAMPIONS_VERSIONS_KEY);
      return raw && raw.length > 0 ? raw : null;
    } catch (err) {
      this.logger.warn(
        `Redis read failed, rechecking versions: ${this.describe(err)}`,
      );
      return null;
    }
  }

  private async writeCache(
    patch: string,
    pool: ChampionsResponse,
  ): Promise<void> {
    try {
      // No TTL on purpose: the payload stays valid while `patch` is still
      // the latest Data Dragon version (tracked in champions:versions).
      await this.redis.set(
        CHAMPIONS_CACHE_KEY,
        JSON.stringify({ patch, ...pool }),
      );
    } catch (err) {
      this.logger.warn(
        `Redis write failed, champion data not cached: ${this.describe(err)}`,
      );
    }
  }

  /**
   * Resolves the latest Data Dragon patch: short-lived Redis cache first,
   * then GET /api/versions.json with retries. If the CDN is unreachable and
   * a fallback patch (from the cached pool) is known, keeps serving that
   * instead of failing; otherwise throws ServiceUnavailableException per
   * EC-003.
   */
  private async resolveLatestPatch(
    fallbackPatch: string | null,
    deadline: number,
  ): Promise<string> {
    const cached = await this.cachedLatestPatch();
    if (cached) {
      return cached;
    }

    let latest: string;
    try {
      latest = await this.fetchWithRetries(
        deadline,
        'Data Dragon versions.json',
        (timeoutMs) => this.fetchLatestPatchOnce(timeoutMs),
      );
    } catch (err) {
      if (fallbackPatch) {
        this.logger.warn(
          `Data Dragon versions.json unreachable (${this.describe(err)}); keeping cached patch ${fallbackPatch}`,
        );
        return fallbackPatch;
      }
      throw new ServiceUnavailableException('Champion pool unavailable');
    }

    try {
      await this.redis.set(
        CHAMPIONS_VERSIONS_KEY,
        latest,
        VERSIONS_TTL_SECONDS,
      );
    } catch (err) {
      this.logger.warn(
        `Redis write failed, latest patch not cached: ${this.describe(err)}`,
      );
    }
    return latest;
  }

  /** Fetches champion.json for `patch`; throws SUE when the CDN is down. */
  private async fetchChampions(
    patch: string,
    deadline: number,
  ): Promise<ChampionsResponse> {
    try {
      return await this.fetchWithRetries(
        deadline,
        'Data Dragon champion.json',
        (timeoutMs) => this.fetchChampionsOnce(patch, timeoutMs),
      );
    } catch (err) {
      this.logger.error(
        `Data Dragon unreachable after ${MAX_RETRIES + 1} attempts: ${this.describe(err)}`,
      );
      throw new ServiceUnavailableException('Champion pool unavailable');
    }
  }

  /**
   * Runs `op` with up to MAX_RETRIES retries on exponential backoff, all
   * bounded by the shared overall deadline (T-005 targets): each wait and
   * per-attempt timeout is clamped to the remaining budget. Throws the last
   * error when every attempt fails or the budget runs out.
   */
  private async fetchWithRetries<T>(
    deadline: number,
    label: string,
    op: (timeoutMs: number) => Promise<T>,
  ): Promise<T> {
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        break; // overall timeout reached
      }

      try {
        return await op(Math.min(PER_ATTEMPT_TIMEOUT_MS, remainingMs));
      } catch (err) {
        lastError = err;
        this.logger.warn(
          `${label} attempt ${attempt}/${MAX_RETRIES + 1} failed: ${this.describe(err)}`,
        );
      }

      const delayMs = RETRY_DELAYS_MS[attempt - 1];
      if (delayMs === undefined) {
        break; // no more retries
      }
      const waitMs = Math.min(delayMs, deadline - Date.now());
      if (waitMs <= 0) {
        break;
      }
      await this.sleep(waitMs);
    }

    if (lastError === null) {
      throw new Error(`${label} timed out before any attempt`);
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  private async fetchLatestPatchOnce(timeoutMs: number): Promise<string> {
    const url = `${this.baseUrl()}/api/versions.json`;
    const payload: unknown = await this.getJson(url, timeoutMs);
    if (!Array.isArray(payload) || payload.length === 0) {
      throw new Error(
        'Data Dragon versions.json returned an unexpected payload shape',
      );
    }
    // Newest first per Data Dragon docs; element [0] is the latest patch.
    const latest = payload[0];
    if (typeof latest !== 'string' || latest.trim().length === 0) {
      throw new Error('Data Dragon versions.json has no usable latest patch');
    }
    return latest;
  }

  private async fetchChampionsOnce(
    patch: string,
    timeoutMs: number,
  ): Promise<ChampionsResponse> {
    const url = `${this.baseUrl()}/cdn/${patch}/data/en_US/champion.json`;
    const payload: unknown = await this.getJson(url, timeoutMs);
    return this.normalizeChampions(payload, patch);
  }

  private async getJson(url: string, timeoutMs: number): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`Data Dragon responded with HTTP ${res.status}`);
      }
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Normalizes champion.json into `{ count, data }`. Data Dragon wraps the
   * champions in a `data` object keyed by champion id; only `id`, `name`
   * and the icon are taken (no titles/lore). Icon URLs follow the CDN icon
   * path: <base>/cdn/<patch>/img/champion/<champion>.png.
   */
  private normalizeChampions(
    payload: unknown,
    patch: string,
  ): ChampionsResponse {
    const record = (payload ?? null) as Record<string, unknown> | null;
    const map = record?.data;
    if (map === null || typeof map !== 'object' || Array.isArray(map)) {
      throw new Error(
        'Data Dragon champion.json returned an unexpected payload shape',
      );
    }

    const data: Champion[] = [];
    for (const entry of Object.values(map as Record<string, unknown>)) {
      if (entry === null || typeof entry !== 'object') {
        continue;
      }
      const champ = entry as Record<string, unknown>;
      const id = this.stringValue(champ.id);
      const name = this.stringValue(champ.name);
      if (!id || !name) {
        continue; // skip entries without identity
      }
      data.push({
        id,
        name,
        iconUrl: `${this.baseUrl()}/cdn/${patch}/img/champion/${id}.png`,
      });
    }

    if (data.length === 0) {
      throw new Error('Data Dragon returned no usable champions');
    }
    return { count: data.length, data };
  }

  /** Data Dragon base URL from env; defaults to the public CDN. */
  private baseUrl(): string {
    const raw = (process.env.DATA_DRAGON_BASE_URL ?? '').trim();
    const base = raw.length > 0 ? raw : DEFAULT_DATA_DRAGON_BASE_URL;
    return base.replace(/\/+$/, '');
  }

  private stringValue(value: unknown): string | null {
    return typeof value === 'string' && value.length > 0 ? value : null;
  }

  private describe(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
