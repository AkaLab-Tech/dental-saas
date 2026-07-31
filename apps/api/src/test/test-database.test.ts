import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  DEFAULT_TEST_DATABASE_URL,
  databaseNameOf,
  resolveTestDatabaseUrl,
} from './test-database.js'

// Pure unit tests: no Prisma, no connection, no network. This guard is the only
// thing standing between ~150 deleteMany/truncate call sites and a developer's
// dental_saas database, so every branch of it is pinned here.

const DEV_DATABASE_URL =
  'postgresql://dental:localdev123@127.0.0.1:5432/dental_saas?schema=public'

describe('databaseNameOf', () => {
  it('extracts the database name from a URL with query params', () => {
    expect(
      databaseNameOf(
        'postgresql://dental:localdev123@127.0.0.1:5432/dental_test?schema=public'
      )
    ).toBe('dental_test')
  })

  it('extracts the database name when there is no query string', () => {
    expect(databaseNameOf('postgresql://dental:pw@127.0.0.1:5432/dental_test')).toBe(
      'dental_test'
    )
  })

  it('decodes percent-encoded characters in the database name', () => {
    // %5F is "_": a URL-encoded name must resolve to the same name as a literal one.
    expect(databaseNameOf('postgresql://dental:pw@127.0.0.1:5432/dental%5Ftest')).toBe(
      'dental_test'
    )
  })

  it('decodes percent-encoded characters with multiple query params', () => {
    expect(
      databaseNameOf('postgresql://u:p@h:5432/my%20db?schema=public&sslmode=require')
    ).toBe('my db')
  })
})

describe('resolveTestDatabaseUrl — fallback', () => {
  it('falls back to the default test URL when DATABASE_URL is undefined', () => {
    expect(resolveTestDatabaseUrl(undefined)).toBe(DEFAULT_TEST_DATABASE_URL)
  })

  it('falls back to the default test URL when DATABASE_URL is an empty string', () => {
    // dotenv yields "" for a declared-but-blank variable; that must not be
    // treated as a configured URL.
    expect(resolveTestDatabaseUrl('')).toBe(DEFAULT_TEST_DATABASE_URL)
  })

  it('points the default at the dental_test database', () => {
    expect(databaseNameOf(DEFAULT_TEST_DATABASE_URL)).toBe('dental_test')
  })
})

describe('resolveTestDatabaseUrl — accepted database names', () => {
  it.each([
    ['dental_test', 'postgresql://dental:pw@127.0.0.1:5432/dental_test?schema=public'],
    ['dental-test', 'postgresql://dental:pw@127.0.0.1:5432/dental-test?schema=public'],
    ['test', 'postgresql://dental:pw@127.0.0.1:5432/test?schema=public'],
  ])('accepts %s and returns the URL unchanged', (_name, url) => {
    expect(resolveTestDatabaseUrl(url)).toBe(url)
  })

  it('accepts a percent-encoded test database name', () => {
    const url = 'postgresql://dental:pw@127.0.0.1:5432/dental%5Ftest'
    expect(resolveTestDatabaseUrl(url)).toBe(url)
  })

  it('accepts a remote CI database as long as the name ends in test', () => {
    const url = 'postgresql://ci:ci@db.example.com:5432/dental_test'
    expect(resolveTestDatabaseUrl(url)).toBe(url)
  })
})

describe('resolveTestDatabaseUrl — rejected database names', () => {
  it('throws for the development database', () => {
    expect(() => resolveTestDatabaseUrl(DEV_DATABASE_URL)).toThrow(
      /Refusing to run the API test suite against database "dental_saas"/
    )
  })

  it.each([
    // The regex anchors on the END of the name, so a name that merely starts
    // with "test" is not a test database.
    ['testing', 'postgresql://u:p@127.0.0.1:5432/testing'],
    ['test_fixtures', 'postgresql://u:p@127.0.0.1:5432/test_fixtures'],
    // Fail-closed: "test" must be the whole name or be preceded by "_"/"-".
    ['mytest', 'postgresql://u:p@127.0.0.1:5432/mytest'],
    ['production', 'postgresql://u:p@db.example.com:5432/production'],
  ])('throws for %s', (name, url) => {
    expect(() => resolveTestDatabaseUrl(url)).toThrow(
      new RegExp(`against database "${name}"`)
    )
  })

  it('names the offending database and host in the error message', () => {
    expect(() => resolveTestDatabaseUrl(DEV_DATABASE_URL)).toThrow(
      'Refusing to run the API test suite against database "dental_saas" on 127.0.0.1:5432'
    )
  })

  it('tells the developer how to recover', () => {
    let message = ''
    try {
      resolveTestDatabaseUrl(DEV_DATABASE_URL)
    } catch (error) {
      message = (error as Error).message
    }

    expect(message).toContain('it does not look like a test database')
    expect(message).toContain(DEFAULT_TEST_DATABASE_URL)
    expect(message).toContain('db:test:setup')
    expect(message).toContain('ALLOW_NON_TEST_DB=1')
  })
})

describe('resolveTestDatabaseUrl — ALLOW_NON_TEST_DB escape hatch', () => {
  // setup.ts runs once per file and the pool is a single fork, so this variable
  // is saved and restored to avoid leaking into other test files.
  const original = process.env.ALLOW_NON_TEST_DB

  beforeEach(() => {
    delete process.env.ALLOW_NON_TEST_DB
  })

  afterEach(() => {
    if (original === undefined) {
      delete process.env.ALLOW_NON_TEST_DB
    } else {
      process.env.ALLOW_NON_TEST_DB = original
    }
  })

  it('returns a non-test URL unchanged when ALLOW_NON_TEST_DB=1', () => {
    process.env.ALLOW_NON_TEST_DB = '1'

    expect(resolveTestDatabaseUrl(DEV_DATABASE_URL)).toBe(DEV_DATABASE_URL)
  })

  it.each(['0', 'true', 'yes', ''])(
    'still throws when ALLOW_NON_TEST_DB=%j (only "1" disarms the guard)',
    (value) => {
      process.env.ALLOW_NON_TEST_DB = value

      expect(() => resolveTestDatabaseUrl(DEV_DATABASE_URL)).toThrow(
        /Refusing to run the API test suite/
      )
    }
  )

  it('throws again once the escape hatch is removed', () => {
    process.env.ALLOW_NON_TEST_DB = '1'
    expect(resolveTestDatabaseUrl(DEV_DATABASE_URL)).toBe(DEV_DATABASE_URL)

    delete process.env.ALLOW_NON_TEST_DB
    expect(() => resolveTestDatabaseUrl(DEV_DATABASE_URL)).toThrow(
      /Refusing to run the API test suite/
    )
  })
})
