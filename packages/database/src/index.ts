import { Pool } from 'pg'
import { PrismaClient } from '../generated/prisma/client.js'
import { PrismaPg } from '@prisma/adapter-pg'

// Prevent multiple instances of Prisma Client in development
declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined
  // eslint-disable-next-line no-var
  var prismaPool: Pool | undefined
}

let _prisma: PrismaClient | undefined
let _pool: Pool | undefined

function createPrismaClient(): PrismaClient {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      'DATABASE_URL environment variable is required. ' +
      'Ensure it is set (e.g., via dotenv in your application or environment) ' +
      'before importing @dental/database'
    )
  }

  _pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 5000,
  })

  // Store pool reference for cleanup
  if (process.env.NODE_ENV !== 'production') {
    globalThis.prismaPool = _pool
  }

  const adapter = new PrismaPg(_pool)

  return new PrismaClient({
    adapter,
    log:
      process.env.NODE_ENV === 'development'
        ? ['query', 'error', 'warn']
        : ['error'],
  })
}

function getPrismaClient(): PrismaClient {
  if (!_prisma) {
    _prisma = globalThis.prisma || createPrismaClient()
    if (process.env.NODE_ENV !== 'production') {
      globalThis.prisma = _prisma
    }
  }
  return _prisma as PrismaClient
}

// Lazy initialization - prisma client is created on first access
export const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const client = getPrismaClient()
    return (client as unknown as Record<string | symbol, unknown>)[prop]
  },
  has(_target, prop) {
    const client = getPrismaClient()
    return prop in client
  },
  ownKeys(_target) {
    const client = getPrismaClient()
    return Reflect.ownKeys(client)
  },
  getOwnPropertyDescriptor(_target, prop) {
    const client = getPrismaClient()
    return Reflect.getOwnPropertyDescriptor(client, prop)
  },
})

/**
 * Eagerly opens the database connection instead of waiting for the first
 * query. Lets the caller fail fast at startup if the DB is unreachable,
 * bounded by the pool's connectionTimeoutMillis.
 */
export async function connectDatabase(): Promise<void> {
  await getPrismaClient().$connect()
}

/**
 * Cleanup function to close database connections gracefully.
 * Call this on application shutdown to prevent resource leaks.
 */
export async function disconnectDatabase(): Promise<void> {
  if (_prisma) {
    await _prisma.$disconnect()
    _prisma = undefined
  }
  if (_pool) {
    await _pool.end()
    _pool = undefined
  }
}

// Re-export Prisma types
export * from '../generated/prisma/client.js'
