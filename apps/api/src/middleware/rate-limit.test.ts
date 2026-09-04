import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import express, { type Express, type RequestHandler } from 'express'
import request from 'supertest'
import {
  rateLimit,
  MemoryStore,
  type Store,
  type IncrementResponse,
  type ClientRateLimitInfo,
} from 'express-rate-limit'
import { createRateLimiter, resetRateLimiterRegistry, FallbackStore } from './rate-limit.js'
import { getRedisClient } from '../config/redis.js'
import { env } from '../config/env.js'
import { logger } from '../utils/logger.js'

const WINDOW_MS = 60_000
const MESSAGE = 'Demasiadas solicitudes. Intenta de nuevo mas tarde.'

/** Mounts a limiter in front of a trivial 200 route. */
function appWith(limiter: RequestHandler): Express {
  const app = express()
  app.get('/probe', limiter, (_req, res) => {
    res.status(200).json({ success: true })
  })
  return app
}

interface FakeRedis {
  client: { call: (...args: string[]) => Promise<unknown> }
  /** Every command argv the store sent, in order. */
  calls: string[][]
}

/**
 * A stand-in for the ioredis client that speaks just enough of the protocol
 * rate-limit-redis@5 uses: `SCRIPT LOAD` (answered with a sha) and `EVALSHA`
 * (answered with `[hits, resetMs]`). Hit counts are tracked per Redis key, so
 * the limit genuinely trips and, crucially, two limiters only share a counter
 * if they genuinely share a key.
 */
function createFakeRedis(): FakeRedis {
  const calls: string[][] = []
  const hits = new Map<string, number>()

  const call = async (...args: string[]): Promise<unknown> => {
    calls.push(args)
    const command = args[0]
    if (command === 'SCRIPT') return 'sha-of-the-lua-script'
    if (command === 'EVALSHA') {
      // increment: [EVALSHA, sha, "1", key, resetOnChange, windowMs]
      // get:       [EVALSHA, sha, "1", key]
      const key = args[3]
      const isIncrement = args.length > 4
      const next = (hits.get(key) ?? 0) + (isIncrement ? 1 : 0)
      hits.set(key, next)
      return [next, WINDOW_MS]
    }
    return 'OK'
  }

  return { client: { call }, calls }
}

/**
 * A minimal express-rate-limit Store double for testing FallbackStore's own
 * logic in isolation (breaker timing, delegation, error swallowing) — a level
 * below the fake Redis protocol above, and independent of MemoryStore's real
 * bucket/expiry logic. `fail` is mutable so a single instance can simulate a
 * primary going down and later recovering.
 */
interface SpyStore extends Store {
  fail: boolean
  initCalls: number
  getCalls: number
  incrementCalls: number
  decrementCalls: number
  resetKeyCalls: number
  resetAllCalls: number
}

function makeSpyStore(name: string, fail = false): SpyStore {
  const hits = new Map<string, number>()
  const maybeFail = (op: string): void => {
    if (store.fail) throw new Error(`${name} ${op} failed`)
  }

  const store: SpyStore = {
    localKeys: false,
    fail,
    initCalls: 0,
    getCalls: 0,
    incrementCalls: 0,
    decrementCalls: 0,
    resetKeyCalls: 0,
    resetAllCalls: 0,
    init() {
      store.initCalls++
      maybeFail('init')
    },
    async get(key: string): Promise<ClientRateLimitInfo | undefined> {
      store.getCalls++
      maybeFail('get')
      return { totalHits: hits.get(key) ?? 0, resetTime: undefined }
    },
    async increment(key: string): Promise<IncrementResponse> {
      store.incrementCalls++
      maybeFail('increment')
      const next = (hits.get(key) ?? 0) + 1
      hits.set(key, next)
      return { totalHits: next, resetTime: undefined }
    },
    async decrement(key: string): Promise<void> {
      store.decrementCalls++
      maybeFail('decrement')
      hits.set(key, Math.max(0, (hits.get(key) ?? 0) - 1))
    },
    async resetKey(key: string): Promise<void> {
      store.resetKeyCalls++
      maybeFail('resetKey')
      hits.delete(key)
    },
    async resetAll(): Promise<void> {
      store.resetAllCalls++
      maybeFail('resetAll')
      hits.clear()
    },
  }
  return store
}

/** Pulls the `rl:<prefix>:<id>` key out of a recorded argv, if it has one. */
function redisKeyOf(argv: string[]): string | undefined {
  return argv.find((arg) => /^rl:[^:]+:/.test(arg))
}

/** Every distinct rate-limit key a fake observed. */
function keysSeen(fake: FakeRedis): string[] {
  return [...new Set(fake.calls.map(redisKeyOf).filter((k): k is string => k !== undefined))]
}

beforeEach(() => {
  // The prefix registry is process-wide and rejects duplicates; this file
  // builds many limiters, so each case starts from an empty registry.
  resetRateLimiterRegistry()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('createRateLimiter', () => {
  it('falls back to MemoryStore when no client is available, and 429s past the limit', async () => {
    const { limiter, store }: { limiter: RequestHandler; store: Store } = createRateLimiter({
      windowMs: WINDOW_MS,
      limit: 3,
      keyPrefix: 'memory-fallback',
      message: MESSAGE,
      client: null,
    })
    const app = appWith(limiter)

    for (let i = 0; i < 3; i++) {
      const allowed = await request(app).get('/probe')
      expect(allowed.status).toBe(200)
    }

    const blocked = await request(app).get('/probe')
    expect(blocked.status).toBe(429)
    expect(blocked.body).toEqual({
      success: false,
      error: {
        message: MESSAGE,
        code: 'RATE_LIMITED',
        retryAfter: expect.any(Number),
      },
    })
    // Seconds, not milliseconds, and never zero: a client told to retry after
    // 0 retries immediately and gets another 429.
    const { retryAfter } = blocked.body.error as { retryAfter: number }
    expect(Number.isInteger(retryAfter)).toBe(true)
    expect(retryAfter).toBeGreaterThan(0)
    expect(retryAfter).toBeLessThanOrEqual(WINDOW_MS / 1000)

    expect(store).toBeInstanceOf(MemoryStore)
  })

  it('drives the Redis store through FallbackStore when a client is injected, and 429s at the configured limit', async () => {
    const fake = createFakeRedis()
    const { limiter, store } = createRateLimiter({
      windowMs: WINDOW_MS,
      limit: 2,
      keyPrefix: 'redis-path',
      message: MESSAGE,
      client: fake.client,
    })
    const app = appWith(limiter)

    // #420: a client turns the store into a FallbackStore wrapping the
    // Redis-backed store, not a bare RedisStore — the assertions below (the
    // client really being driven) are what proves the Redis path still
    // works underneath it.
    expect(store).toBeInstanceOf(FallbackStore)
    expect(store).not.toBeInstanceOf(MemoryStore)

    expect((await request(app).get('/probe')).status).toBe(200)
    expect((await request(app).get('/probe')).status).toBe(200)

    const third = await request(app).get('/probe')
    expect(third.status).toBe(429)
    expect(third.body.error.code).toBe('RATE_LIMITED')

    // The traffic really went through the injected client, not a local map.
    expect(fake.calls.some((argv) => argv[0] === 'SCRIPT' && argv[1] === 'LOAD')).toBe(true)
    expect(fake.calls.filter((argv) => argv[0] === 'EVALSHA').length).toBeGreaterThanOrEqual(3)
    expect(keysSeen(fake).every((key) => key.startsWith('rl:redis-path:'))).toBe(true)
  })

  // WHY THIS TEST EXISTS.
  //
  // Under Redis the ONLY thing separating two limiters is the key prefix: they
  // share one keyspace, so two limiters built with the same prefix share one
  // bucket for the same IP and silently collapse the deliberately separate
  // buckets #416 shipped (forgot-password vs reset-password, etc.). The
  // anti-starvation test in routes/auth.test.ts (:661) cannot catch that
  // regression: it runs on MemoryStore, where separation is structural — two
  // distinct store instances with two distinct maps — and holds even if every
  // limiter in the app were given an identical prefix. This test proves the
  // prefix reaches the key; the registry in rate-limit.ts (exercised below)
  // proves no two call-sites can pick the same one. Do not weaken this into a
  // "the Redis path works" smoke test.
  it('keeps two limiters in disjoint keyspaces for the same client IP (prefix disjointness)', async () => {
    const sameIp = '203.0.113.7'
    const fakeA = createFakeRedis()
    const fakeB = createFakeRedis()

    const build = (keyPrefix: string, fake: FakeRedis) =>
      createRateLimiter({
        windowMs: WINDOW_MS,
        limit: 2,
        keyPrefix,
        message: MESSAGE,
        keyGenerator: () => sameIp,
        client: fake.client,
      }).limiter

    const appA = appWith(build('aaa', fakeA))
    const appB = appWith(build('bbb', fakeB))

    // Drive both limiters from the same identity.
    for (let i = 0; i < 3; i++) {
      await request(appA).get('/probe')
      await request(appB).get('/probe')
    }

    const keysA = keysSeen(fakeA)
    const keysB = keysSeen(fakeB)

    expect(keysA).toEqual([`rl:aaa:${sameIp}`])
    expect(keysB).toEqual([`rl:bbb:${sameIp}`])

    // Disjointness, stated as sets: nothing limiter A touched is anything
    // limiter B touched, in either direction.
    expect(keysA.every((key) => key.startsWith('rl:aaa:'))).toBe(true)
    expect(keysA.some((key) => key.startsWith('rl:bbb:'))).toBe(false)
    expect(keysB.every((key) => key.startsWith('rl:bbb:'))).toBe(true)
    expect(keysB.some((key) => key.startsWith('rl:aaa:'))).toBe(false)
    expect(keysA.filter((key) => keysB.includes(key))).toEqual([])
  })

  it('shares one bucket only when the prefixes match (the failure mode the test above guards)', async () => {
    // Same fake client for both limiters, so the keyspace is genuinely shared,
    // and a fixed key so both limiters see one identity. Distinct prefixes must
    // keep the counters independent even then.
    const fake = createFakeRedis()
    const build = (keyPrefix: string) =>
      createRateLimiter({
        windowMs: WINDOW_MS,
        limit: 2,
        keyPrefix,
        message: MESSAGE,
        keyGenerator: () => '198.51.100.4',
        client: fake.client,
      }).limiter

    const appA = appWith(build('alpha'))
    const appB = appWith(build('beta'))

    // Exhaust A.
    expect((await request(appA).get('/probe')).status).toBe(200)
    expect((await request(appA).get('/probe')).status).toBe(200)
    expect((await request(appA).get('/probe')).status).toBe(429)

    // B is untouched by A's exhaustion.
    expect((await request(appB).get('/probe')).status).toBe(200)
    expect((await request(appB).get('/probe')).status).toBe(200)
    expect((await request(appB).get('/probe')).status).toBe(429)

    expect(keysSeen(fake).sort()).toEqual(['rl:alpha:198.51.100.4', 'rl:beta:198.51.100.4'])
  })


  it('rejects a second limiter registered with an already-used keyPrefix', () => {
    // The guard that makes keyPrefix uniqueness real. Both tests above
    // hard-code distinct prefixes, so they only prove the factory PROPAGATES a
    // prefix; a call-site copy-pasting an existing one would sail past them and
    // silently share a bucket.
    const build = () =>
      createRateLimiter({
        windowMs: WINDOW_MS,
        limit: 1,
        keyPrefix: 'duplicated-prefix',
        message: MESSAGE,
        client: null,
      })

    expect(() => build()).not.toThrow()
    expect(() => build()).toThrow(/already registered/)
  })

  it('degrades to the in-process memory secondary when the Redis client rejects, and still enforces the limit (#420)', async () => {
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => undefined)
    const brokenClient = {
      call: async () => {
        throw new Error('ECONNREFUSED: redis is down')
      },
    }

    const { limiter } = createRateLimiter({
      windowMs: WINDOW_MS,
      limit: 2,
      keyPrefix: 'broken-redis',
      message: MESSAGE,
      client: brokenClient,
    })
    const app = appWith(limiter)

    const first = await request(app).get('/probe')
    const second = await request(app).get('/probe')
    expect(first.status).toBe(200)
    expect(second.status).toBe(200)

    // This is the single most important assertion in #420: a dead Redis
    // primary must still produce a 429 at the ceiling, served by the
    // per-process memory secondary — NOT the pre-#420 unlimited pass-through
    // (that old behaviour is exactly what this test used to assert; do not
    // restore it).
    const third = await request(app).get('/probe')
    expect(third.status).toBe(429)
    expect(third.body).toEqual({
      success: false,
      error: { message: MESSAGE, code: 'RATE_LIMITED', retryAfter: expect.any(Number) },
    })

    // Degrade, not fail-open: passOnStoreError still backstops any error this
    // store does not itself originate, but must never surface as a 500 —
    // that would turn a Redis outage into a password-recovery outage.
    for (const response of [first, second, third]) {
      expect(response.status).not.toBe(500)
    }

    expect(errorSpy).toHaveBeenCalled()
  })
})

describe('FallbackStore', () => {
  it('degrades to the secondary store when the primary rejects, and keeps requests limited', async () => {
    const primary = makeSpyStore('primary', true)
    const secondary = new MemoryStore()
    // breakerWindowMs: 0 isolates this test from breaker suppression (that
    // is the next test's job) — every request genuinely retries, and fails,
    // the primary, so the assertion below proves the request path, not just
    // the breaker's memory.
    const store = new FallbackStore({ primary, secondary, breakerWindowMs: 0 })
    const limiter = rateLimit({
      windowMs: WINDOW_MS,
      limit: 2,
      standardHeaders: true,
      legacyHeaders: false,
      store,
      passOnStoreError: true,
    })
    const app = appWith(limiter)

    expect((await request(app).get('/probe')).status).toBe(200)
    expect((await request(app).get('/probe')).status).toBe(200)
    // The primary is dead for the whole test, yet the ceiling still bites —
    // this is the property that distinguishes "degrade" from "fail open".
    expect((await request(app).get('/probe')).status).toBe(429)

    expect(primary.incrementCalls).toBeGreaterThanOrEqual(3)
  })

  it('opens a circuit breaker after a primary failure, skipping the primary until the window elapses', async () => {
    vi.useFakeTimers()
    try {
      const primary = makeSpyStore('primary', true)
      const secondary = makeSpyStore('secondary')
      const store = new FallbackStore({ primary, secondary, breakerWindowMs: 1_000 })

      await store.increment('k')
      expect(primary.incrementCalls).toBe(1)
      expect(secondary.incrementCalls).toBe(1)

      // Breaker is open: further calls must not pay the primary's cost at
      // all, not even to fail — that is the whole point of the breaker.
      await store.increment('k')
      await store.increment('k')
      expect(primary.incrementCalls).toBe(1)
      expect(secondary.incrementCalls).toBe(3)

      // Window elapses and the primary has recovered.
      vi.advanceTimersByTime(1_001)
      primary.fail = false
      await store.increment('k')
      expect(primary.incrementCalls).toBe(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('logs the primary-down/primary-up transition once, not on every request', async () => {
    vi.useFakeTimers()
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => undefined)
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined)
    try {
      const primary = makeSpyStore('primary', true)
      const secondary = makeSpyStore('secondary')
      const store = new FallbackStore({ primary, secondary, breakerWindowMs: 1_000 })

      await store.increment('k')
      await store.increment('k')
      await store.increment('k')
      expect(errorSpy).toHaveBeenCalledTimes(1)

      vi.advanceTimersByTime(1_001)
      primary.fail = false
      await store.increment('k')
      expect(warnSpy).toHaveBeenCalledTimes(1)

      await store.increment('k')
      await store.increment('k')
      expect(warnSpy).toHaveBeenCalledTimes(1)

      primary.fail = true
      await store.increment('k')
      expect(errorSpy).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('never throws, even when both the primary and the secondary fail', async () => {
    const primary = makeSpyStore('primary', true)
    const secondary = makeSpyStore('secondary', true)
    const store = new FallbackStore({ primary, secondary })

    await expect(store.get('k')).resolves.toBeUndefined()
    await expect(store.increment('k')).resolves.toEqual({ totalHits: 0, resetTime: undefined })
    await expect(store.decrement('k')).resolves.toBeUndefined()
    await expect(store.resetKey('k')).resolves.toBeUndefined()
    await expect(store.resetAll()).resolves.toBeUndefined()
  })

  it('reaches both stores on init, and both stores on resetAll', async () => {
    const primary = makeSpyStore('primary')
    const secondary = makeSpyStore('secondary')
    const store = new FallbackStore({ primary, secondary })

    // express-rate-limit calls store.init() synchronously while building the
    // middleware (see rateLimit() in express-rate-limit), so building one is
    // enough to exercise it without a request.
    rateLimit({ windowMs: WINDOW_MS, limit: 1, store })
    expect(primary.initCalls).toBe(1)
    expect(secondary.initCalls).toBe(1)

    await store.resetAll()
    expect(primary.resetAllCalls).toBe(1)
    expect(secondary.resetAllCalls).toBe(1)
  })

  it('reports localKeys as false — no single backend can be assumed authoritative statically', () => {
    const store = new FallbackStore({
      primary: makeSpyStore('primary'),
      secondary: makeSpyStore('secondary'),
    })
    expect(store.localKeys).toBe(false)
  })
})

describe('getRedisClient', () => {
  it('returns null under NODE_ENV=test even though REDIS_URL is set', () => {
    // The whole test strategy rests on this: test.env DOES define REDIS_URL
    // and a Redis IS reachable in CI (ci.yml runs a redis:7-alpine service),
    // so "is REDIS_URL set?" cannot be the signal. Tests deliberately stay on
    // MemoryStore for determinism and isolation - see config/redis.ts.
    expect(env.NODE_ENV).toBe('test')
    expect(env.REDIS_URL).toBeTruthy()
    expect(getRedisClient()).toBeNull()
  })
})
