import { Logger } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';
import type { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';
import Redis from 'ioredis';

/**
 * Redis-backed throttler storage so rate-limit counters are SHARED across every
 * API instance and survive restarts / cold starts. The default in-memory
 * ThrottlerStorageService keeps a per-process counter, so on a multi-instance
 * host (or during a deploy rollout) requests spread across instances and the
 * limit is never actually reached — verified live on Render: 8+ rapid bad
 * logins never returned 429. A single shared counter fixes that.
 *
 * Fail-open by design: if Redis is unreachable, `increment` returns an
 * under-limit record instead of throwing, so a Redis outage degrades to
 * "no throttling" (today's behaviour) and can NEVER cause an auth outage.
 *
 * `ttl`/`blockDuration` arrive in milliseconds; `timeToExpire`/
 * `timeToBlockExpire` must be returned in SECONDS (matches the built-in
 * ThrottlerStorageService, which the X-RateLimit-Reset header relies on).
 */
export class RedisThrottlerStorage implements ThrottlerStorage {
  private readonly logger = new Logger(RedisThrottlerStorage.name);

  // Fixed-window counter + separate block key. Mirrors the community
  // @nest-lab/throttler-storage-redis Lua so semantics match the built-in store.
  private readonly script = `
    local totalHits = redis.call('INCR', KEYS[1])
    local pttl = redis.call('PTTL', KEYS[1])
    if pttl <= 0 then
      redis.call('PEXPIRE', KEYS[1], ARGV[1])
      pttl = tonumber(ARGV[1])
    end
    local blocked = redis.call('EXISTS', KEYS[2])
    local blockPttl = 0
    if blocked == 1 then
      blockPttl = redis.call('PTTL', KEYS[2])
    elseif totalHits > tonumber(ARGV[2]) then
      redis.call('SET', KEYS[2], '1', 'PX', ARGV[3])
      blocked = 1
      blockPttl = tonumber(ARGV[3])
    end
    return { totalHits, pttl, blocked, blockPttl }
  `;

  constructor(private readonly redis: Redis) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const hitKey = `throttle:${throttlerName}:${key}`;
    const blockKey = `throttle-block:${throttlerName}:${key}`;
    try {
      const res = (await this.redis.eval(
        this.script,
        2,
        hitKey,
        blockKey,
        ttl,
        limit,
        blockDuration,
      )) as [number, number, number, number];
      return {
        totalHits: res[0],
        timeToExpire: Math.ceil(res[1] / 1000),
        isBlocked: res[2] === 1,
        timeToBlockExpire: Math.ceil(res[3] / 1000),
      };
    } catch (err) {
      // Fail open: never let a Redis hiccup block legitimate auth traffic.
      this.logger.warn(`Redis throttler unavailable, allowing request: ${(err as Error).message}`);
      return { totalHits: 1, timeToExpire: Math.ceil(ttl / 1000), isBlocked: false, timeToBlockExpire: 0 };
    }
  }
}
