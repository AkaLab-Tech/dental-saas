import type { Request, RequestHandler, Response } from 'express'
import {
  rateLimit,
  MemoryStore,
  type Store,
  type RateLimitInfo,
  type ValueDeterminingMiddleware,
} from 'express-rate-limit'
import RedisStore, { type RedisReply } from 'rate-limit-redis'
import { getRedisClient } from '../config/redis.js'
import { logger } from '../utils/logger.js'

type RedisLike = { call: (...args: string[]) => Promise<unknown> }

/**
 * A store that supports wiping every bucket. MemoryStore does; RedisStore
 * (rate-limit-redis v5) does NOT — it exposes only init/get/increment/
 * decrement/resetKey.
 */
export type ResettableStore = Store & { resetAll: () => Promise<void> | void }

export interface CreateRateLimiterOptions {
  windowMs: number
  limit: number
  /**
   * REQUIRED, never defaulted. Under MemoryStore two limiters are separated
   * simply by being distinct instances; under Redis the ONLY separator is the
   * key prefix. Two limiters sharing a prefix share one bucket for the same
   * IP, which silently collapses the deliberately-separate buckets #416
   * introduced — and no MemoryStore-backed test can catch that, because there
   * the separation is structural.
   */
  keyPrefix: string
  message: string
  /** Defaults to express-rate-limit's IP keying. */
  keyGenerator?: ValueDeterminingMiddleware<string>
  /** Injection point for tests; defaults to the shared client. */
  client?: RedisLike | null
}

export function createRateLimiter({
  windowMs,
  limit,
  keyPrefix,
  message,
  keyGenerator,
  client = getRedisClient(),
}: CreateRateLimiterOptions): { limiter: RequestHandler; store: Store } {
  const store: Store = client
    ? new RedisStore({
        prefix: `rl:${keyPrefix}:`,
        sendCommand: (...args: string[]) => client.call(...args) as Promise<RedisReply>,
      })
    : new MemoryStore()

  const limiter = rateLimit({
    windowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    store,
    keyGenerator,
    // Fail OPEN. These limiters are anti-automation and resource protection,
    // not authentication controls (see the threat model in routes/auth.ts).
    // Failing closed would turn a Redis outage into a password-recovery and
    // public-budget outage — express-rate-limit rethrows store errors by
    // default, which the error handler turns into 500s. Degrading to the
    // pre-#416 behaviour is the lesser harm; routing express-rate-limit's own
    // logger into pino makes that silent loss an incident, not a mystery.
    passOnStoreError: true,
    logger: {
      error: (err, msg) => logger.error({ err }, msg),
      warn: (err, msg) => logger.warn({ err }, msg),
    },
    handler: (req: Request & { rateLimit?: RateLimitInfo }, res: Response) => {
      const resetTime = req.rateLimit?.resetTime
      const retryAfter = resetTime
        ? Math.max(1, Math.ceil((resetTime.getTime() - Date.now()) / 1000))
        : Math.ceil(windowMs / 1000)
      res.status(429).json({
        success: false,
        error: { message, code: 'RATE_LIMITED', retryAfter },
      })
    },
  })

  return { limiter, store }
}
