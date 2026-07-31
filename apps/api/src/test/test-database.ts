/**
 * Guards against running the test suite on a non-test database.
 *
 * The suite truncates tables in ~150 places, so pointing it at a development
 * or production database destroys data. Anything that is not obviously a test
 * database is rejected before Prisma opens a connection.
 */

/** Used when no DATABASE_URL is provided. Matches the URL in test.env. */
export const DEFAULT_TEST_DATABASE_URL =
  'postgresql://dental:localdev123@127.0.0.1:5432/dental_test?schema=public'

const TEST_DATABASE_NAME = /(^|[_-])test$/

export function databaseNameOf(databaseUrl: string): string {
  return decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\//, ''))
}

/**
 * Returns the connection string the test suite must use, or throws when the
 * configured one does not target a test database.
 */
export function resolveTestDatabaseUrl(databaseUrl?: string): string {
  const resolved = databaseUrl || DEFAULT_TEST_DATABASE_URL
  const { host } = new URL(resolved)
  const name = databaseNameOf(resolved)

  if (!TEST_DATABASE_NAME.test(name) && process.env.ALLOW_NON_TEST_DB !== '1') {
    throw new Error(
      `Refusing to run the API test suite against database "${name}" on ${host}: ` +
        `it does not look like a test database (expected a name ending in "test").\n` +
        `The suite deletes every row it finds, so it must never target a development or production database.\n` +
        `Fix: unset DATABASE_URL to fall back to ${DEFAULT_TEST_DATABASE_URL}, or point it at a test database ` +
        `and create it with "pnpm --filter @dental/database db:test:setup".\n` +
        `Escape hatch (destroys data): re-run with ALLOW_NON_TEST_DB=1.`
    )
  }

  return resolved
}
