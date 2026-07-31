/**
 * Bootstraps the database used by the API test suite: creates it when absent,
 * then applies migrations. Idempotent — safe to re-run.
 *
 * Target resolution mirrors apps/api/src/test/setup.ts: an already-set
 * DATABASE_URL wins, otherwise the repo-root test.env value is used.
 */
import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config as loadEnv } from 'dotenv'
import { Client } from 'pg'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = resolve(packageRoot, '../..')

loadEnv({ path: resolve(repoRoot, 'test.env') })

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  throw new Error('DATABASE_URL is not set and test.env did not provide one.')
}

const url = new URL(databaseUrl)
const databaseName = decodeURIComponent(url.pathname.replace(/^\//, ''))

if (!/(^|[_-])test$/.test(databaseName) && process.env.ALLOW_NON_TEST_DB !== '1') {
  throw new Error(
    `Refusing to bootstrap "${databaseName}" on ${url.host}: it does not look like a test database.\n` +
      `Unset DATABASE_URL to use the value from test.env, or point it at a database whose name ends in "test".`
  )
}

// CREATE DATABASE cannot run inside the target database, so connect to the
// always-present maintenance database instead.
const maintenanceUrl = new URL(databaseUrl)
maintenanceUrl.pathname = '/postgres'
maintenanceUrl.search = ''

const client = new Client({ connectionString: maintenanceUrl.toString() })
await client.connect()
const existing = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [databaseName])
if (existing.rowCount === 0) {
  await client.query(`CREATE DATABASE "${databaseName}"`)
  console.log(`Created database "${databaseName}" on ${url.host}`)
} else {
  console.log(`Database "${databaseName}" already exists on ${url.host}`)
}
await client.end()

execFileSync('pnpm', ['run', 'db:migrate:deploy'], {
  cwd: packageRoot,
  stdio: 'inherit',
  env: { ...process.env, DATABASE_URL: databaseUrl },
})
