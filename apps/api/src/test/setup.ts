// Test setup file - sets environment variables before tests run
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config as loadEnv } from 'dotenv'
import { prisma } from '@dental/database'
import { afterAll } from 'vitest'
import { resolveTestDatabaseUrl } from './test-database.js'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')

// Reproducible local defaults. dotenv never overrides an already-set variable,
// so CI and explicit shell exports still win. Safe to run after the
// @dental/database import: its Prisma client is created lazily on first use.
loadEnv({ path: resolve(repoRoot, 'test.env'), quiet: true })

process.env.SETUP_KEY = 'test-setup-key-minimum-16-chars'
process.env.JWT_SECRET = 'test-jwt-secret-minimum-32-characters-here'
process.env.NODE_ENV = 'test'
process.env.DATABASE_URL = resolveTestDatabaseUrl(process.env.DATABASE_URL)

// Ensure Prisma connection is closed after all tests complete
afterAll(async () => {
  await prisma.$disconnect()
})
