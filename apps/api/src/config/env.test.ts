import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { env } from './env.js'

describe('env config', () => {
  it('should have default PORT of 5001', () => {
    expect(env.PORT).toBe(5001)
  })

  it('should have NODE_ENV set to test when running tests', () => {
    expect(env.NODE_ENV).toBe('test')
  })

  it('should have default CORS_ORIGIN of *', () => {
    expect(env.CORS_ORIGIN).toBe('*')
  })
})

// Coverage for the DATABASE_URL production refine (added alongside API
// startup hardening): a misconfigured production container should fail fast
// at env-parse time instead of on the first query. env.ts validates
// process.env synchronously at module load and calls process.exit(1) on
// failure, so each case here mutates process.env, resets the module cache,
// and re-imports the module fresh (mirrors the pattern used in
// services/email.service.test.ts).
describe('env config — DATABASE_URL production refine', () => {
  const ORIGINAL_ENV = { ...process.env }

  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
    vi.restoreAllMocks()
  })

  it('rejects a missing DATABASE_URL when NODE_ENV=production', async () => {
    process.env.NODE_ENV = 'production'
    delete process.env.DATABASE_URL
    process.env.CORS_ORIGIN = 'https://app.example.com' // avoid also tripping the CORS refine

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation(((code?: number) => {
        throw new Error(`process.exit: ${code}`)
      }) as never)

    await expect(import('./env.js')).rejects.toThrow('process.exit: 1')

    expect(exitSpy).toHaveBeenCalledWith(1)
    expect(errorSpy).toHaveBeenCalledWith(
      '❌ Invalid environment variables:',
      expect.objectContaining({
        DATABASE_URL: expect.arrayContaining([
          'DATABASE_URL is required in production. Please configure the database connection string.',
        ]),
      })
    )
  })

  it('rejects an empty-string DATABASE_URL when NODE_ENV=production', async () => {
    process.env.NODE_ENV = 'production'
    process.env.DATABASE_URL = ''
    process.env.CORS_ORIGIN = 'https://app.example.com'

    vi.spyOn(console, 'error').mockImplementation(() => {})
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation(((code?: number) => {
        throw new Error(`process.exit: ${code}`)
      }) as never)

    await expect(import('./env.js')).rejects.toThrow('process.exit: 1')
    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  it('allows a present DATABASE_URL when NODE_ENV=production', async () => {
    process.env.NODE_ENV = 'production'
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/db'
    process.env.CORS_ORIGIN = 'https://app.example.com'

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit should not have been called')
    })

    const { env: prodEnv } = await import('./env.js')

    expect(prodEnv.NODE_ENV).toBe('production')
    expect(prodEnv.DATABASE_URL).toBe('postgresql://user:pass@localhost:5432/db')
    expect(exitSpy).not.toHaveBeenCalled()
  })

  it('still allows a missing DATABASE_URL outside production (dev/test behavior unchanged)', async () => {
    process.env.NODE_ENV = 'test'
    delete process.env.DATABASE_URL

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit should not have been called')
    })

    const { env: testEnv } = await import('./env.js')

    expect(testEnv.NODE_ENV).toBe('test')
    expect(testEnv.DATABASE_URL).toBeUndefined()
    expect(exitSpy).not.toHaveBeenCalled()
  })
})
