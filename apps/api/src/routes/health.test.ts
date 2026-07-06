import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'

// Unit coverage for the DB-error branch of GET /api/health, which the
// existing health.integration.test.ts (real DB, always healthy) can't
// exercise. We mock @dental/database's prisma.$queryRaw at the seam the
// route actually depends on, so we can control both the success and
// failure paths deterministically.
const queryRawMock = vi.fn()

vi.mock('@dental/database', () => ({
  prisma: {
    $queryRaw: (...args: unknown[]) => queryRawMock(...args),
  },
  Prisma: {
    JsonNull: { __brand: 'JsonNull' }, // referenced by doctor.service.ts at import time
  },
}))

describe('GET /api/health (unit, mocked DB)', () => {
  beforeEach(() => {
    queryRawMock.mockReset()
  })

  it('returns 200 {status: ok} when SELECT 1 succeeds', async () => {
    queryRawMock.mockResolvedValue([{ '?column?': 1 }])
    const { app } = await import('../app.js')

    const response = await request(app).get('/api/health')

    expect(response.status).toBe(200)
    expect(response.body.status).toBe('ok')
    expect(typeof response.body.timestamp).toBe('string')
    expect(typeof response.body.uptime).toBe('number')
    expect(queryRawMock).toHaveBeenCalledTimes(1)
  })

  it('returns 503 {status: unhealthy} when SELECT 1 throws', async () => {
    queryRawMock.mockRejectedValue(new Error('connection terminated unexpectedly'))
    const { app } = await import('../app.js')

    const response = await request(app).get('/api/health')

    expect(response.status).toBe(503)
    expect(response.body.status).toBe('unhealthy')
    expect(typeof response.body.timestamp).toBe('string')
    expect(typeof response.body.uptime).toBe('number')
    expect(queryRawMock).toHaveBeenCalledTimes(1)
  })
})
