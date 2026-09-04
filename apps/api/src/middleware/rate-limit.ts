import { createHash } from 'node:crypto'
import type { Request, RequestHandler, Response } from 'express'
import {
  rateLimit,
  MemoryStore,
  type Store,
  type Options,
  type ClientRateLimitInfo,
  type IncrementResponse,
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

/**
 * #420: how long, in ms, FallbackStore stops calling a failing primary after
 * it rejects. Without this, every request during an outage would still pay
 * the primary's `commandTimeout` (500ms, see config/redis.ts) before falling
 * through — this breaker skips straight to the secondary instead.
 */
export const FALLBACK_STORE_BREAKER_WINDOW_MS = 5_000

export interface FallbackStoreOptions {
  /** Preferred store — the Redis-backed store in production. */
  primary: Store
  /** Store used while the primary is failing or the breaker is open. */
  secondary: Store
  /**
   * Overrides FALLBACK_STORE_BREAKER_WINDOW_MS. Exists so tests can exercise
   * breaker-open and breaker-recovered behaviour without sleeping the real
   * window.
   */
  breakerWindowMs?: number
}

/**
 * #420: wraps a primary store (Redis-backed in production) with a secondary
 * store (a per-process MemoryStore) that takes over when the primary is
 * unavailable, so a Redis outage degrades the limit rather than removing it.
 *
 * Every operation prefers the primary. On rejection it opens a short circuit
 * breaker (see FALLBACK_STORE_BREAKER_WINDOW_MS) so a dead primary is not
 * retried — and does not pay its command timeout — on every single request;
 * while the breaker is open, calls go straight to the secondary. A
 * transition between primary and secondary service is logged once, not on
 * every request that follows it.
 *
 * Known, accepted limitations of degrading to a per-process MemoryStore
 * (rather than, say, a second Redis or a shared external store):
 *   - The secondary starts every counter at zero when an outage begins, and
 *     that state is discarded once the primary recovers. An attacker gets
 *     one fresh budget per primary-down/primary-up transition — bounded, and
 *     far short of the unlimited window a bare fail-open leaves.
 *   - Counting is per-process, so with N API instances an outage allows up
 *     to N times the configured ceiling (each instance keeps its own
 *     MemoryStore). Also bounded, and exactly the pre-#419 behaviour by
 *     definition, since #419 predates cross-process coordination entirely.
 *
 * This store never throws or rejects: if the secondary also fails, the
 * failure is logged and swallowed, and the operation resolves to a value
 * that lets the request through — today's behaviour, kept as the last
 * resort. `passOnStoreError: true` (see createRateLimiter below) stays in
 * place as a backstop for any error this store does not originate.
 */
export class FallbackStore implements Store {
  // Which backend actually served a request cannot be known statically —
  // this is the conservative answer express-rate-limit uses to detect
  // double-counting misconfigurations.
  localKeys = false

  private readonly primary: Store
  private readonly secondary: Store
  private readonly breakerWindowMs: number
  private breakerOpenUntil = 0
  private onSecondary = false

  constructor({
    primary,
    secondary,
    breakerWindowMs = FALLBACK_STORE_BREAKER_WINDOW_MS,
  }: FallbackStoreOptions) {
    this.primary = primary
    this.secondary = secondary
    this.breakerWindowMs = breakerWindowMs
  }

  init(options: Options): void {
    try {
      Promise.resolve(this.primary.init?.(options)).catch((err: unknown) => {
        this.tripBreaker(err)
      })
    } catch (err) {
      this.tripBreaker(err)
    }
    this.secondary.init?.(options)
  }

  async get(key: string): Promise<ClientRateLimitInfo | undefined> {
    return this.delegate(
      (store) => store.get?.(key),
      () => undefined
    )
  }

  async increment(key: string): Promise<IncrementResponse> {
    return this.delegate(
      (store) => store.increment(key),
      () => ({ totalHits: 0, resetTime: undefined })
    )
  }

  async decrement(key: string): Promise<void> {
    await this.delegate(
      (store) => store.decrement(key),
      () => undefined
    )
  }

  async resetKey(key: string): Promise<void> {
    await this.delegate(
      (store) => store.resetKey(key),
      () => undefined
    )
  }

  async resetAll(): Promise<void> {
    await Promise.allSettled([this.primary.resetAll?.(), this.secondary.resetAll?.()])
  }

  async shutdown(): Promise<void> {
    await Promise.allSettled([this.primary.shutdown?.(), this.secondary.shutdown?.()])
  }

  private isBreakerOpen(): boolean {
    return Date.now() < this.breakerOpenUntil
  }

  private tripBreaker(err: unknown): void {
    this.breakerOpenUntil = Date.now() + this.breakerWindowMs
    if (!this.onSecondary) {
      this.onSecondary = true
      logger.error(
        { err },
        'Rate limiter primary store failed; falling back to per-process in-memory store'
      )
    }
  }

  private noteRecovered(): void {
    if (this.onSecondary) {
      this.onSecondary = false
      logger.warn('Rate limiter primary store recovered; resuming Redis-backed limiting')
    }
  }

  /**
   * Runs `op` against the primary unless the breaker is open, falling back to
   * the secondary on rejection. Never throws: if the secondary also rejects,
   * `onSecondaryFailure` supplies a value that lets the caller — and, as a
   * last resort, express-rate-limit's `passOnStoreError` — proceed rather
   * than see a rejected promise.
   */
  private async delegate<T>(
    op: (store: Store) => Promise<T> | T | undefined,
    onSecondaryFailure: () => T
  ): Promise<T> {
    if (!this.isBreakerOpen()) {
      try {
        const result = await op(this.primary)
        this.noteRecovered()
        return result as T
      } catch (err) {
        this.tripBreaker(err)
      }
    }
    try {
      return (await op(this.secondary)) as T
    } catch (err) {
      logger.error({ err }, 'Rate limiter secondary store failed; allowing request through')
      return onSecondaryFailure()
    }
  }
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

// #417: shared ceilings for every password-recovery limiter (tenant + super
// admin). Four buckets across two routers now use these; hard-coding the
// numbers in each router is what would let them drift apart, and a drift
// here is invisible — each endpoint keeps working, just with a different
// budget than its counterpart. Unlike the login ceilings above these count
// REQUESTS, not failures: a successful recovery request is exactly what an
// automation abuser sends, so refunding it would defeat the limiter.
// The rationale for the values, and for why the two endpoints do NOT share
// a bucket, is in routes/auth.ts beside the tenant pair.
export const RECOVERY_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000
export const RECOVERY_RATE_LIMIT = 10

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
    ? new FallbackStore({
        primary: new RedisStore({
          prefix: `rl:${keyPrefix}:`,
          sendCommand: (...args: string[]) => client.call(...args) as Promise<RedisReply>,
        }),
        secondary: new MemoryStore(),
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
    // #420: when `client` is set, `store` above is a FallbackStore, so a
    // primary (Redis) error degrades this limiter to a per-process
    // MemoryStore rather than passing requests through unlimited — a Redis
    // outage keeps requests LIMITED, just with a smaller, per-process,
    // reset-on-recovery budget (see FallbackStore's doc comment for the
    // exact trade-offs). `passOnStoreError: true` no longer does the
    // fail-open work itself; it stays only as a last-resort backstop for an
    // error this store does not originate — e.g. the fallback's own
    // secondary failing too, or an error from a caller-supplied
    // `keyGenerator`/`skip`.
    //
    // For the original callers of this factory (forgot/reset password) that
    // backstop firing at all would still be tolerable: these are
    // anti-automation and resource protection, not authentication controls
    // (see the threat model in routes/auth.ts), so even a total failure
    // letting a request through costs no more than today's occasional
    // false negative.
    //
    // #418 login limiters reuse this factory and do NOT get that slack for
    // free: they are the standard control against credential brute force, so
    // the backstop firing there would silently remove the only guessing
    // limit on tenant and super-admin credentials. That is precisely why
    // FallbackStore matters for login — it makes the backstop fire only on
    // the rare double-failure case instead of on every single Redis hiccup,
    // while still refusing to fail closed and lock every clinic (and the
    // super admin) out during an outage.
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
