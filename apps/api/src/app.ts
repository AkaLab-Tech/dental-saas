import express, { type Express } from 'express'
import cors from 'cors'
import { healthRouter } from './routes/health.js'
import { authRouter } from './routes/auth.js'
import { tenantsRouter } from './routes/tenants.js'
import { adminRouter } from './routes/admin/index.js'
import { patientsRouter } from './routes/patients.js'
import { doctorsRouter } from './routes/doctors.js'
import { appointmentsRouter } from './routes/appointments.js'
import { usersRouter } from './routes/users.js'
import { labworksRouter } from './routes/labworks.js'
import { budgetsRouter } from './routes/budgets.js'
import { publicBudgetsRouter } from './routes/public-budgets.js'
import { expensesRouter } from './routes/expenses.js'
import { statsRouter } from './routes/stats.js'
import billingRouter from './routes/billing.js'
import { settingsRouter } from './routes/settings.js'
import exportRouter from './routes/export.js'
import { attachmentsRouter, fileRouter } from './routes/attachments.js'
import { errorHandler } from './middleware/error-handler.js'
import { requireAuthWithTenant, requireAuthWithTokenParam, requireTenant } from './middleware/auth.js'
import { logger } from './utils/logger.js'
import { env } from './config/env.js'

export const app: Express = express()

// Coolify/Traefik terminates TLS and proxies to this app as a single hop, so
// req.ip must trust exactly one layer of X-Forwarded-For. `true` would let any
// client spoof the header and defeat IP-based rate limiting; revisit this
// value if the proxy topology ever grows another hop.
app.set('trust proxy', 1)

// Middleware
// The public budgets route below applies its own scoped CORS policy (the
// apps/web origin, not the app-panel CORS_ORIGIN). It must be excluded here,
// otherwise this global handler answers its OPTIONS preflights terminally
// with the wrong Allow-Origin before the request ever reaches the route.
const globalCors = cors({ origin: env.CORS_ORIGIN })
app.use((req, res, next) => {
  if (req.path.startsWith('/api/public/budgets')) return next()
  return globalCors(req, res, next)
})
app.use(express.json())

// Serialize BigInt values as numbers in JSON responses (e.g. storageUsedBytes)
app.set('json replacer', (_key: string, value: unknown) =>
  typeof value === 'bigint' ? Number(value) : value
)

// Request logging
app.use((req, _res, next) => {
  logger.info({ method: req.method, url: req.url }, 'Incoming request')
  next()
})

// Public routes
app.use('/api/health', healthRouter)
app.use('/api/auth', authRouter)
app.use('/api/tenants', tenantsRouter)
app.use('/api', billingRouter) // /api/plans is public, /api/billing/* requires auth
// Scoped CORS for the public share-link endpoint: allows the apps/web origin
// (which the global CORS_ORIGIN, set to the app panel origin, does not cover)
// without widening the global policy. Data behind this route is public-by-token.
app.use('/api/public/budgets', cors({ origin: env.PUBLIC_WEB_URL }), publicBudgetsRouter)

// Admin routes (super admin only)
app.use('/api/admin', adminRouter)

// Protected routes (require authentication + tenant)
app.use('/api/patients', requireAuthWithTenant, patientsRouter)
app.use('/api/doctors', requireAuthWithTenant, doctorsRouter)
app.use('/api/appointments', requireAuthWithTenant, appointmentsRouter)
app.use('/api/users', requireAuthWithTenant, usersRouter)
app.use('/api/labworks', requireAuthWithTenant, labworksRouter)
app.use('/api/budgets', requireAuthWithTenant, budgetsRouter)
app.use('/api/expenses', requireAuthWithTenant, expensesRouter)
app.use('/api/stats', requireAuthWithTenant, statsRouter)
app.use('/api/attachments/file', requireAuthWithTokenParam, requireTenant, fileRouter)
app.use('/api/attachments', requireAuthWithTenant, attachmentsRouter)
app.use('/api', settingsRouter) // /api/settings
app.use('/api', exportRouter) // /api/export

// 404 handler for unmapped routes
app.use((_req, res) => {
  res.status(404).json({
    success: false,
    error: {
      message: 'Not Found',
      code: 'NOT_FOUND',
    },
  })
})

// Error handling
app.use(errorHandler)
