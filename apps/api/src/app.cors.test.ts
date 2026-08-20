import { describe, it, expect } from 'vitest'
import { api } from './test/http.js'
import { env } from './config/env.js'

// Regression coverage for the CORS wrapper added in app.ts:
//   - the global `cors({ origin: env.CORS_ORIGIN })` is skipped for paths under
//     /api/public/budgets, because it used to terminally answer OPTIONS
//     preflights for every path (including the public budget page) with the
//     wrong Allow-Origin before the scoped middleware ever ran.
//   - /api/public/budgets gets its own scoped `cors({ origin: env.PUBLIC_WEB_URL })`.
// These tests pin both halves of that behavior and prove the skip is narrow
// (every other route still uses the global CORS_ORIGIN policy).
describe('CORS policy (app.ts)', () => {
  describe('/api/public/budgets — scoped to PUBLIC_WEB_URL', () => {
    it('sets Access-Control-Allow-Origin to PUBLIC_WEB_URL on a GET request', async () => {
      const res = await api()
        .get('/api/public/budgets/some-token')
        .set('Origin', env.PUBLIC_WEB_URL)

      expect(res.headers['access-control-allow-origin']).toBe(env.PUBLIC_WEB_URL)
    })

    it('answers an OPTIONS preflight with a success status and the same Allow-Origin', async () => {
      const res = await api()
        .options('/api/public/budgets/some-token')
        .set('Origin', env.PUBLIC_WEB_URL)
        .set('Access-Control-Request-Method', 'GET')

      expect([200, 204]).toContain(res.status)
      expect(res.headers['access-control-allow-origin']).toBe(env.PUBLIC_WEB_URL)
    })

    it('does not reflect an arbitrary Origin — Allow-Origin stays the static PUBLIC_WEB_URL, never the caller-supplied origin', async () => {
      const res = await api()
        .get('/api/public/budgets/some-token')
        .set('Origin', 'http://evil.com')

      expect(res.headers['access-control-allow-origin']).not.toBe('http://evil.com')
      expect(res.headers['access-control-allow-origin']).toBe(env.PUBLIC_WEB_URL)
    })

    it('rejects a spoofed evil Origin the same way on an OPTIONS preflight', async () => {
      const res = await api()
        .options('/api/public/budgets/some-token')
        .set('Origin', 'http://evil.com')
        .set('Access-Control-Request-Method', 'GET')

      expect(res.headers['access-control-allow-origin']).not.toBe('http://evil.com')
      expect(res.headers['access-control-allow-origin']).toBe(env.PUBLIC_WEB_URL)
    })
  })

  describe('other routes — still on the global CORS_ORIGIN policy (skip is narrow to /api/public/budgets)', () => {
    it('GET /api/health keeps the global CORS_ORIGIN policy, not the scoped PUBLIC_WEB_URL one', async () => {
      // Test env leaves CORS_ORIGIN at its default ('*' — see config/env.test.ts),
      // so the global policy always answers with the literal wildcard, never the
      // caller's Origin and never the public-budgets scoped value.
      expect(env.CORS_ORIGIN).toBe('*')

      const res = await api()
        .get('/api/health')
        .set('Origin', env.PUBLIC_WEB_URL)

      expect(res.headers['access-control-allow-origin']).toBe('*')
      expect(res.headers['access-control-allow-origin']).not.toBe(env.PUBLIC_WEB_URL)
    })

    it('GET /api/health still responds normally through the global CORS wrapper', async () => {
      const res = await api().get('/api/health')

      expect(res.status).toBe(200)
      expect(res.body.status).toBe('ok')
    })
  })
})
