import { app } from './app.js'
import { logger } from './utils/logger.js'
import { env } from './config/env.js'
import { connectDatabase, disconnectDatabase } from '@dental/database'

const SHUTDOWN_FORCE_EXIT_MS = 25_000

async function start(): Promise<void> {
  await connectDatabase()

  const server = app.listen(env.PORT, () => {
    logger.info(`🚀 API server running on http://localhost:${env.PORT}`)
  })

  server.on('error', (error) => {
    logger.error({ err: error }, 'Failed to start API server')
    process.exit(1)
  })

  const shutdown = (signal: string): void => {
    logger.info(`${signal} received, shutting down gracefully`)

    const forceExit = setTimeout(() => {
      logger.error('Graceful shutdown timed out, forcing exit')
      process.exit(1)
    }, SHUTDOWN_FORCE_EXIT_MS)

    server.close(() => {
      disconnectDatabase()
        .then(() => {
          clearTimeout(forceExit)
          process.exit(0)
        })
        .catch((error: unknown) => {
          logger.error({ err: error }, 'Error disconnecting database during shutdown')
          clearTimeout(forceExit)
          process.exit(1)
        })
    })
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
}

process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'Unhandled promise rejection')
  process.exit(1)
})

process.on('uncaughtException', (error) => {
  logger.error({ err: error }, 'Uncaught exception')
  process.exit(1)
})

start().catch((error: unknown) => {
  logger.error({ err: error }, 'Failed to start API server')
  process.exit(1)
})

export { app }
