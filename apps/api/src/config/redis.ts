import { Redis } from 'ioredis'
import { env } from './env.js'
import { logger } from '../utils/logger.js'

let client: Redis | null | undefined

/**
 * Lazily-built shared Redis client, or `null` when Redis must not be used.
 *
 * Returns `null` when REDIS_URL is unset, and also when NODE_ENV === 'test':
 * the test environments DO define REDIS_URL (test.env, ci.yml) but CI runs no
 * Redis service, so "is REDIS_URL set?" is not a usable signal here.
 *
 * This is NOT the NODE_ENV bypass that task #254 ruled out. #254 forbade
 * disabling the limiter under test, because a limiter nobody exercises is an
 * untested limiter. Here the limiter still runs in tests with its full
 * behaviour, backed by MemoryStore; only the storage backend differs. The
 * Redis path keeps its own coverage through an injected sendCommand. Do not
 * read this as licence to branch actual request-handling behaviour on
 * NODE_ENV.
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
    enableOfflineQueue: false,
  })

  client.on('error', (error: Error) => {
    logger.error({ err: error }, 'Redis client error')
  })

  client.connect().catch((error: Error) => {
    logger.error({ err: error }, 'Redis connection failed; rate limiting falls back to no-op')
  })

  return client
}
