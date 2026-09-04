import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import express, { type Express, type RequestHandler } from 'express'
import request from 'supertest'
import { Redis } from 'ioredis'
import { createRateLimiter, resetRateLimiterRegistry } from './rate-limit.js'

/**
 * #420: exercises rate-limit-redis's ACTUAL Lua script against a REAL Redis —
 * the one thing the fake `client.call` in rate-limit.test.ts can never prove,
 * because that fake answers whatever the test tells it to. This file builds
 * its own `ioredis` client and injects it via `createRateLimiter`'s `client`
 * option; it deliberately does NOT go through `getRedisClient()`, which
 * returns `null` under `NODE_ENV === 'test'` by design (see config/redis.ts)
 * — a design this file does not change.
 *
 * Guarded by a real PING probe (with a timeout), not by "is REDIS_URL set?":
 * CI always sets REDIS_URL, and a developer with a stale env var but no
 * server running must SKIP, not FAIL.
 */

const MESSAGE = 'Demasiadas solicitudes. Intenta de nuevo mas tarde.'
const REDIS_URL = process.env.REDIS_URL

/** Mounts a limiter in front of a trivial 200 route. */
function appWith(limiter: RequestHandler): Express {
  const app = express()
  app.get('/probe', limiter, (_req, res) => {
    res.status(200).json({ success: true })
  })
  return app
}

/** A short, timed PING — never hangs the suite on a stale REDIS_URL. */
async function isRedisReachable(url: string): Promise<boolean> {
  const probe = new Redis(url, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
    connectTimeout: 1000,
  })
  // A dead/unreachable target emits 'error' events for every failed
  // (re)connect attempt; the probe result comes from the awaited PING below,
  // not from these, so they are deliberately swallowed here.
  probe.on('error', () => undefined)
  try {
    const pong = await Promise.race([
      probe.ping(),
      new Promise<never>((_resolve, reject) =>
        setTimeout(() => reject(new Error('redis probe timed out')), 1500)
      ),
    ])
    return pong === 'PONG'
  } catch {
    return false
  } finally {
    probe.disconnect()
  }
}

/** Every key matching `pattern`, gathered via SCAN (never KEYS on a shared instance). */
async function scanKeys(client: Redis, pattern: string): Promise<string[]> {
  const found: string[] = []
  let cursor = '0'
  do {
    const [nextCursor, keys] = await client.scan(cursor, 'MATCH', pattern, 'COUNT', 200)
    cursor = nextCursor
    found.push(...keys)
  } while (cursor !== '0')
  return found
}

/** Deletes only the keys matching `pattern`, via SCAN + targeted DEL. */
async function deleteKeysByPattern(client: Redis, pattern: string): Promise<void> {
  const keys = await scanKeys(client, pattern)
  if (keys.length > 0) {
    await client.del(...keys)
  }
}

const redisReachable = REDIS_URL ? await isRedisReachable(REDIS_URL) : false

// #420 acceptance: `pnpm --filter @dental/api test` must pass on a machine
// with no Redis running. This is the mechanism — skip, don't fail, when the
// probe above cannot reach REDIS_URL. Verified manually by pointing
// REDIS_URL at a dead port and confirming this suite reports "skipped", not
// "failed" (see the tester's report for that run).
describe.skipIf(!redisReachable)('rate-limit-redis against real Redis (#420)', () => {
  // Unique per test run so concurrent runs (and a developer's dev stack on
  // this same shared Redis, per docker-compose.dev.yml) never collide, and so
  // cleanup can target exactly — and only — the keys this file created.
  // NEVER FLUSHALL: this instance is shared with a developer's running dev
  // stack.
  const runId = `it${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  let client: Redis

  beforeAll(async () => {
    if (!REDIS_URL) throw new Error('REDIS_URL must be set once reachability is confirmed')
    client = new Redis(REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      // Generous relative to production's 500ms (config/redis.ts): that
      // value is tuned to fail fast against an actually-dead primary, which
      // is not what this client is for. Connecting eagerly below removes the
      // connect-vs-first-command race that caused this to matter in
      // practice; the timeout stays here only as a backstop.
      commandTimeout: 2000,
    })
    // Connect up front so the reachable-Redis tests below race nothing: a
    // lazy first command racing its own connection handshake under host load
    // was flaking this suite with spurious "Command timed out" primary
    // failures that had nothing to do with the behaviour under test.
    await client.connect()
  })

  afterAll(async () => {
    await deleteKeysByPattern(client, `rl:${runId}*`)
    client.disconnect()
  })

  it('increments one shared counter in Redis and returns 429 at the ceiling', async () => {
    resetRateLimiterRegistry()
    const { limiter } = createRateLimiter({
      windowMs: 60_000,
      limit: 2,
      keyPrefix: `${runId}-basic`,
      message: MESSAGE,
      client,
    })
    const app = appWith(limiter)

    expect((await request(app).get('/probe')).status).toBe(200)
    expect((await request(app).get('/probe')).status).toBe(200)

    const third = await request(app).get('/probe')
    expect(third.status).toBe(429)
    expect(third.body.error.code).toBe('RATE_LIMITED')

    // Only a real server can prove this: the Lua script actually wrote one
    // shared counter under this prefix, and it reflects every request above.
    const keys = await scanKeys(client, `rl:${runId}-basic:*`)
    expect(keys).toHaveLength(1)
    const stored = await client.get(keys[0])
    expect(Number(stored)).toBe(3)
  })

  it('expires the window in Redis and allows requests again once it elapses', async () => {
    resetRateLimiterRegistry()
    const windowMs = 400
    const { limiter } = createRateLimiter({
      windowMs,
      limit: 1,
      keyPrefix: `${runId}-window`,
      message: MESSAGE,
      client,
    })
    const app = appWith(limiter)

    expect((await request(app).get('/probe')).status).toBe(200)
    expect((await request(app).get('/probe')).status).toBe(429)

    // The window has NOT expired yet: still blocked.
    expect((await request(app).get('/probe')).status).toBe(429)

    await new Promise((resolve) => setTimeout(resolve, windowMs + 250))

    // Only a real server's PTTL/expiry can prove this: the bucket actually
    // reset, not just "the fake said so".
    expect((await request(app).get('/probe')).status).toBe(200)
  })

  it('keeps two limiters in disjoint keyspaces against a real Redis keyspace (prefix disjointness)', async () => {
    resetRateLimiterRegistry()
    const sameIdentity = '203.0.113.9'
    const prefixA = `${runId}-disjoint-a`
    const prefixB = `${runId}-disjoint-b`

    const build = (keyPrefix: string): RequestHandler =>
      createRateLimiter({
        windowMs: 60_000,
        limit: 2,
        keyPrefix,
        message: MESSAGE,
        keyGenerator: () => sameIdentity,
        client,
      }).limiter

    const appA = appWith(build(prefixA))
    const appB = appWith(build(prefixB))

    // Exhaust A.
    expect((await request(appA).get('/probe')).status).toBe(200)
    expect((await request(appA).get('/probe')).status).toBe(200)
    expect((await request(appA).get('/probe')).status).toBe(429)

    // B, driven by the same identity, is untouched — this is only meaningful
    // proof against a real, shared keyspace (a fake keeps a Map per test).
    expect((await request(appB).get('/probe')).status).toBe(200)
    expect((await request(appB).get('/probe')).status).toBe(200)
    expect((await request(appB).get('/probe')).status).toBe(429)

    // Each app saw 3 total requests (2 allowed + the 429 itself also
    // increments); disjointness means each key reflects only its OWN app's
    // 3, never the other's.
    const [valueA, valueB] = await Promise.all([
      client.get(`rl:${prefixA}:${sameIdentity}`),
      client.get(`rl:${prefixB}:${sameIdentity}`),
    ])
    expect(Number(valueA)).toBe(3)
    expect(Number(valueB)).toBe(3)
  })

  it('degrades rather than failing open against a genuinely dead Redis address, and stays limited', async () => {
    resetRateLimiterRegistry()
    // A real dead endpoint, not a rejecting fake: nothing is listening here.
    const deadClient = new Redis('redis://127.0.0.1:19999', {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      commandTimeout: 500,
      retryStrategy: () => null,
    })
    deadClient.on('error', () => undefined)

    try {
      const { limiter } = createRateLimiter({
        windowMs: 60_000,
        limit: 2,
        keyPrefix: `${runId}-dead`,
        message: MESSAGE,
        client: deadClient,
      })
      const app = appWith(limiter)

      // Requests succeed rather than erroring...
      const first = await request(app).get('/probe')
      const second = await request(app).get('/probe')
      expect(first.status).toBe(200)
      expect(second.status).toBe(200)

      // ...and, with FallbackStore in place, they are still limited by the
      // per-process memory secondary — not an unlimited pass-through.
      const third = await request(app).get('/probe')
      expect(third.status).toBe(429)
      for (const response of [first, second, third]) {
        expect(response.status).not.toBe(500)
      }
    } finally {
      deadClient.disconnect()
    }
  })
})
