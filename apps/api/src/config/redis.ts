import { Redis } from 'ioredis'
import { env } from './env.js'
import { logger } from '../utils/logger.js'

let client: Redis | null | undefined

/**
 * Lazily-built shared Redis client, or `null` when Redis must not be used.
 *
 * Returns `null` when REDIS_URL is unset, and also when NODE_ENV === 'test'.
 * A Redis IS reachable in both test environments (ci.yml runs a redis:7-alpine
 * service for test-backend and test-e2e; docker-compose.dev.yml runs one
 * locally), so this is a deliberate choice, not an availability workaround:
 *
 *   - Determinism and isolation. MemoryStore gives each limiter a fresh
 *     per-instance bucket with a working resetAll(), so no state bleeds
 *     between cases, between files, or between runs — which a shared Redis
 *     keyspace, keyed only by prefix + IP, would do.
 *   - Local developers can run the backend suite without bringing
 *     docker-compose.dev.yml up.
 *
 * This is NOT the NODE_ENV bypass that task #254 ruled out. #254 forbade
 * disabling the limiter under test, because a limiter nobody exercises is an
 * untested limiter. Here the limiter still runs in tests with its full
 * behaviour, backed by MemoryStore; only the storage backend differs. Do not
 * read this as licence to branch actual request-handling behaviour on
 * NODE_ENV.
 *
 * Known limitation, accepted for now: because of this choice, the Redis path
 * is covered only through the fake sendCommand in middleware/rate-limit.test.ts,
 * so rate-limit-redis's actual Lua script is never executed against a real
 * Redis anywhere in the suite.
 */
export function getRedisClient(): Redis | null {
  if (client !== undefined) return client

  if (!env.REDIS_URL || env.NODE_ENV === 'test') {
    client = null
    return client
  }

  client = new Redis(env.REDIS_URL, {
    lazyConnect: true,
    // A dead Redis must degrade the limiter, never wedge the request or the
    // process: bounded retries make commands reject instead of queueing.
    maxRetriesPerRequest: 1,
    // The offline queue absorbs the startup race only: rateLimit() calls
    // store.init() (a SCRIPT LOAD) synchronously at module load, while
    // connect() is still in flight, and with the queue disabled that first
    // command rejected on every healthy cold boot — an error-level log per
    // limiter, per deploy, under perfectly normal conditions, which trains
    // operators to ignore the very signal that reveals a silently-unlimited
    // limiter. commandTimeout is what preserves the fail-fast/fail-open
    // behaviour the disabled queue was there for: when Redis is genuinely
    // down, queued commands reject on the timeout instead of hanging the
    // request, and passOnStoreError lets it through unlimited.
    enableOfflineQueue: true,
    commandTimeout: 500,
  })

  client.on('error', (error: Error) => {
    logger.error({ err: error }, 'Redis client error')
  })

  client.connect().catch((error: Error) => {
    logger.error({ err: error }, 'Redis connection failed; rate limiting falls back to no-op')
  })

  return client
}
