import { createHash } from 'node:crypto'
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

/**
 * Every prefix handed to createRateLimiter in this process.
 *
 * Requiring keyPrefix only forces presence, not uniqueness: a new call-site
 * that copy-pastes `keyPrefix: 'forgot-password'` would pass every test in
 * this file and then silently share one Redis bucket with the real
 * forgot-password limiter. This registry is what makes uniqueness
 * load-bearing — a duplicate throws at module-evaluation time, so the mistake
 * fails the boot (and CI, which imports the routers) instead of quietly
 * halving somebody's limit in production.
 *
 * Safe under vitest because it is per-module-instance: vitest isolates the
 * module graph per test file, so a limiter registered by routes/auth.ts in one
 * file never collides with another file's. Tests that build many limiters in
 * one file call resetRateLimiterRegistry() between cases.
 */
const registeredKeyPrefixes = new Set<string>()

/** Test-only: clears the prefix registry so a file can build limiters freely. */
export function resetRateLimiterRegistry(): void {
  registeredKeyPrefixes.clear()
}

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
  /**
   * Excludes a request from ever consuming (or refunding) budget, evaluated
   * BEFORE keyGenerator runs. Use this — not a fallback value inside
   * keyGenerator — when a request cannot yield a meaningful key (#418): a
   * constant key mixes unrelated callers into one bucket, and a keyGenerator
   * that throws takes the whole route down.
   */
  skip?: ValueDeterminingMiddleware<boolean>
  /**
   * When true, a request `requestWasSuccessful` deems successful refunds the
   * hit it just consumed (express-rate-limit@8.5.2 calls store.decrement on
   * the response 'finish' event). Both stores here implement decrement:
   * MemoryStore decrements its in-memory counter, RedisStore issues DECR.
   */
  skipSuccessfulRequests?: boolean
  /**
   * Overrides the "successful" predicate used by skipSuccessfulRequests.
   * express-rate-limit's default is `res.statusCode < 400`, which would also
   * refund a 400 INVALID_PAYLOAD or a 500 — neither is a credential guess, so
   * a login limiter must supply its own predicate (#418).
   */
  requestWasSuccessful?: ValueDeterminingMiddleware<boolean>
  /** Injection point for tests; defaults to the shared client. */
  client?: RedisLike | null
}

/**
 * Builds the per-account rate-limit key for a login attempt (#418): the email
 * is lowercased and trimmed, optionally scoped (e.g. by clinicSlug, since the
 * same address can exist in two tenants), then SHA-256 hashed and truncated —
 * raw addresses are PII that would otherwise sit in Redis MONITOR output and
 * snapshots, when only equality is needed here.
 *
 * Deliberately case-insensitive even though the lookup beside it (User.email
 * is a case-sensitive column, see routes/auth.ts and routes/admin/auth.ts) is
 * not — tracked as #424, NOT fixed by this key. That mismatch cannot mint
 * extra rate-limit budget: a case variant that would fail the lookup anyway
 * still collapses into this same bucket.
 */
export function hashLoginAccountKey(email: string, scope?: string): string {
  const normalized = email.toLowerCase().trim()
  const subject = scope ? `${scope}:${normalized}` : normalized
  return createHash('sha256').update(subject).digest('hex').slice(0, 32)
}

// #418: shared ceilings for every login rate limiter (tenant + super admin).
// Failure counts, not request counts (skipSuccessfulRequests below), so a
// whole clinic behind one NAT address spends nothing on successful logins.
export const LOGIN_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000
export const LOGIN_IP_RATE_LIMIT = 20
export const LOGIN_ACCOUNT_RATE_LIMIT = 10

export function createRateLimiter({
  windowMs,
  limit,
  keyPrefix,
  message,
  keyGenerator,
  skip,
  skipSuccessfulRequests,
  requestWasSuccessful,
  client = getRedisClient(),
}: CreateRateLimiterOptions): { limiter: RequestHandler; store: Store } {
  if (registeredKeyPrefixes.has(keyPrefix)) {
    throw new Error(
      `Rate limiter keyPrefix "${keyPrefix}" is already registered. Two limiters ` +
        'sharing a prefix share one Redis bucket per client; give this one its own prefix.'
    )
  }
  registeredKeyPrefixes.add(keyPrefix)

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
    skip,
    skipSuccessfulRequests,
    requestWasSuccessful,
    // Fail OPEN. For the original callers of this factory (forgot/reset
    // password) these are anti-automation and resource protection, not
    // authentication controls (see the threat model in routes/auth.ts), so
    // failing closed would turn a Redis outage into a password-recovery and
    // public-budget outage for no security gain.
    //
    // #418 login limiters reuse this factory and DO NOT get that reasoning
    // for free: they are the standard control against credential brute force,
    // so fail-open here means a Redis outage silently removes the only
    // guessing limit on tenant and super-admin credentials alike. Fail-closed
    // is worse — it would turn a Redis outage into a total login outage,
    // locking out every clinic during business hours and the super admin out
    // of the incident they are fixing. The real fix is #420 (a FallbackStore
    // that degrades to a per-process MemoryStore instead of passing through
    // unlimited); until that lands, login ships fail-open too, as a
    // deliberate and temporary trade-off, not an inherited default.
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
