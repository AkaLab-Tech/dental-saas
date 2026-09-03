import { Router, type IRouter, type Request } from 'express'
import { z } from 'zod'
import { prisma } from '@dental/database'
import { type Language } from '@dental/shared'
import {
  hashPassword,
  verifyPassword,
  generateTokens,
  generateProfileToken,
  verifyAccessToken,
  verifyRefreshToken,
  hashToken,
  getExpiryDate,
  cleanupOldRefreshTokens,
} from '../services/auth.service.js'
import { requireAuth, hasMinRole } from '../middleware/auth.js'
import {
  createRateLimiter,
  hashLoginAccountKey,
  LOGIN_RATE_LIMIT_WINDOW_MS,
  LOGIN_IP_RATE_LIMIT,
  LOGIN_ACCOUNT_RATE_LIMIT,
  type ResettableStore,
} from '../middleware/rate-limit.js'
import { sendWelcomeEmail, sendPasswordResetEmail } from '../services/email.service.js'
import { logger } from '../utils/logger.js'
import { env } from '../config/env.js'
import {
  TOKEN_EXPIRY_MINUTES,
  generateResetToken,
  getTokenExpiryDate,
  buildTenantResetUrl,
} from '../utils/password-reset.js'

const authRouter: IRouter = Router()

// Task #254: rate limiting for password recovery. This is NOT a defense
// against reset-token brute force — the token is 256 bits of
// crypto.randomBytes (../utils/password-reset.ts), stored only as a hash on
// a unique column, single-use, and time-limited, so guessing it is
// infeasible at any request rate a per-endpoint limiter could meaningfully
// slow down. What this DOES defend: anti-automation (scripted mass password
// resets), anti-enumeration (repeated probing of which emails/slugs exist),
// and general resource protection (email-sending and DB load from either
// endpoint being hammered).
//
// forgot-password and reset-password get SEPARATE buckets, deliberately not
// shared: forgot-password is cheap and unauthenticated, so sharing a budget
// with it would let it starve reset-password for every legitimate user
// behind the same IP (e.g. an office NAT address). limit: 10 rather than a
// tight number because the legitimate flow already spends 2 requests
// (request the email, submit the new password) and a shared office IP can
// have several people using it; a low ceiling here would lock out a
// low-single-digit-typo user with no way to self-recover.
//
// Task #253: the buckets live in Redis when a client is available, so the
// separation above survives across API instances. The stores are still
// exported so tests can reset them between cases without disabling the
// limiter under NODE_ENV === 'test'. Under test the factory always yields a
// MemoryStore (config/redis.ts returns no client there), which is the only
// context that calls resetAll() — RedisStore has none, hence the narrowing.
const forgotPassword = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  keyPrefix: 'forgot-password',
  message: 'Too many password recovery attempts. Please try again later.',
})
const resetPasswordLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  keyPrefix: 'reset-password',
  message: 'Too many password recovery attempts. Please try again later.',
})

export const forgotPasswordRateLimitStore = forgotPassword.store as ResettableStore
export const resetPasswordRateLimitStore = resetPasswordLimiter.store as ResettableStore

const forgotPasswordRateLimit = forgotPassword.limiter
const resetPasswordRateLimit = resetPasswordLimiter.limiter

// #418: two independent limiters on tenant login, applied IP-first then
// account. One limiter cannot key on both dimensions at once — a single
// keyGenerator yields a single key, so composing (IP, account) into one key
// gives the worst of both (a botnet gets a fresh bucket per source against
// one victim; a single IP gets a fresh bucket per account it targets).
//
// Both count only rejected credentials, not every non-2xx: skipSuccessfulRequests
// alone would also refund on a 400 INVALID_PAYLOAD or a 500, so
// requestWasSuccessful narrows "successful" to "not a 401". Note that
// CLINIC_NOT_ACTIVE (below) is also a 401, so a legitimate user of a
// deactivated clinic spends account budget too — accepted as a small,
// self-limiting population; widening the predicate to inspect the error code
// would couple the limiter to response bodies.
function tenantLoginAccountKey(req: Request): string | undefined {
  const body = req.body as unknown
  if (!body || typeof body !== 'object') return undefined
  const { email, clinicSlug } = body as Record<string, unknown>
  if (typeof email !== 'string' || typeof clinicSlug !== 'string') return undefined
  return hashLoginAccountKey(email, clinicSlug)
}

const loginIpLimiter = createRateLimiter({
  windowMs: LOGIN_RATE_LIMIT_WINDOW_MS,
  limit: LOGIN_IP_RATE_LIMIT,
  keyPrefix: 'login-ip-tenant',
  message: 'Too many login attempts. Please try again later.',
  skipSuccessfulRequests: true,
  requestWasSuccessful: (_req, res) => res.statusCode !== 401,
})
// Account-keyed limiting is a lockout vector by construction: anyone who knows
// an address can spend that account's failure budget from any origin. Accepted
// deliberately. The ceiling is generous (10 failures / 15 min), it throttles
// rather than hard-locks, and it expires on its own without a support contact.
// The alternative — dropping the account dimension — leaves credential stuffing
// across a botnet (one guess per IP, thousands of accounts) entirely
// uncontrolled, which is precisely the attack the IP bucket structurally cannot
// see. A hard lockout was rejected for the mirror-image reason: it turns a known
// email address into a denial-of-service primitive against its owner.
const loginAccountLimiter = createRateLimiter({
  windowMs: LOGIN_RATE_LIMIT_WINDOW_MS,
  limit: LOGIN_ACCOUNT_RATE_LIMIT,
  keyPrefix: 'login-account-tenant',
  message: 'Too many login attempts. Please try again later.',
  skipSuccessfulRequests: true,
  requestWasSuccessful: (_req, res) => res.statusCode !== 401,
  // A malformed payload (no email/clinicSlug) is not a credential guess and
  // must not create a bucket at all — skip, don't key on a fallback constant.
  skip: (req) => tenantLoginAccountKey(req) === undefined,
  keyGenerator: (req) => tenantLoginAccountKey(req) ?? '',
})

export const loginIpRateLimitStore = loginIpLimiter.store as ResettableStore
export const loginAccountRateLimitStore = loginAccountLimiter.store as ResettableStore

const loginIpRateLimit = loginIpLimiter.limiter
const loginAccountRateLimit = loginAccountLimiter.limiter

// Password schema with strong requirements
const passwordSchema = z
  .string()
  .min(8, { message: 'Password must be at least 8 characters long' })
  .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^\w\s]).+$/, {
    message:
      'Password must include at least one uppercase letter, one lowercase letter, one number, and one special character',
  })

const SUPPORTED_LANGUAGES: Language[] = ['es', 'en', 'ar']

// Validation schemas
const registerSchema = z.object({
  email: z.string().email(),
  password: passwordSchema,
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  // For new clinic registration
  clinicName: z.string().min(2).optional(),
  clinicSlug: z.string().min(3).max(50).regex(/^[a-z0-9-]+$/, {
    message: 'Slug must contain only lowercase letters, numbers, and hyphens',
  }),
  // Cosmetic client-side detected language; validated/normalized in the handler
  // so malformed input never fails registration.
  language: z.unknown().optional(),
})

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  clinicSlug: z.string().min(1),
})

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
})

// Password recovery schemas
const forgotPasswordSchema = z.object({
  email: z.string().email(),
  clinicSlug: z.string().min(1),
})

const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: passwordSchema,
})

// POST /api/auth/register
authRouter.post('/register', async (req, res, next) => {
  try {
    const parse = registerSchema.safeParse(req.body)
    if (!parse.success) {
      return res.status(400).json({
        success: false,
        error: { message: 'Invalid payload', code: 'INVALID_PAYLOAD', details: parse.error.errors },
      })
    }

    const { email, password, firstName, lastName, clinicName, clinicSlug, language: requestedLanguage } =
      parse.data
    const resolvedLanguage: Language = SUPPORTED_LANGUAGES.includes(requestedLanguage as Language)
      ? (requestedLanguage as Language)
      : 'es'

    // Check if tenant with this slug exists
    let tenant = await prisma.tenant.findUnique({ where: { slug: clinicSlug } })
    let isNewTenant = false

    if (!tenant) {
      // Create new tenant - user will be OWNER
      isNewTenant = true
      
      // Get enterprise plan for new tenants (free unlimited during beta)
      const enterprisePlan = await prisma.plan.findUnique({ where: { name: 'enterprise' } })
      if (!enterprisePlan) {
        return res.status(500).json({
          success: false,
          error: { message: 'System configuration error. Please contact support.', code: 'PLAN_NOT_FOUND' },
        })
      }
      
      // Create tenant with subscription and default settings in a transaction
      tenant = await prisma.tenant.create({
        data: {
          name: clinicName || `${firstName} Clinic`,
          slug: clinicSlug,
          subscription: {
            create: {
              planId: enterprisePlan.id,
              status: 'ACTIVE',
              currentPeriodStart: new Date(),
              // Set far future date for unlimited access during beta
              currentPeriodEnd: new Date('2099-12-31'),
            },
          },
          settings: {
            create: {
              language: resolvedLanguage,
              // Use defaults from schema
              businessHours: {
                1: { start: '09:00', end: '18:00' },
                2: { start: '09:00', end: '18:00' },
                3: { start: '09:00', end: '18:00' },
                4: { start: '09:00', end: '18:00' },
                5: { start: '09:00', end: '18:00' },
              },
              workingDays: [1, 2, 3, 4, 5],
            },
          },
        },
      })
    } else if (!tenant.isActive) {
      return res.status(400).json({
        success: false,
        error: { message: 'This clinic is not active', code: 'TENANT_INACTIVE' },
      })
    }

    // Check if email already exists for this tenant
    const existingUser = await prisma.user.findUnique({
      where: { tenantId_email: { tenantId: tenant.id, email } },
    })
    if (existingUser) {
      return res.status(409).json({
        success: false,
        error: { message: 'Email already registered', code: 'EMAIL_EXISTS' },
      })
    }

    // Hash password and create user
    const passwordHash = await hashPassword(password)
    const user = await prisma.user.create({
      data: {
        tenantId: tenant.id,
        email,
        passwordHash,
        firstName,
        lastName,
        role: isNewTenant ? 'OWNER' : 'STAFF', // First user is OWNER, others are STAFF
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        tenantId: true,
        createdAt: true,
      },
    })

    // Generate tokens
    const tokens = generateTokens({
      userId: user.id,
      tenantId: user.tenantId || '',
      email: user.email,
      role: user.role,
    })

    // Store refresh token hash
    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(tokens.refreshToken),
        expiresAt: getExpiryDate(env.JWT_REFRESH_EXPIRES_IN),
      },
    })

    // Clean up old tokens for this user
    await cleanupOldRefreshTokens(user.id)

    // Update last login
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    })

    // Send welcome email for new tenant owners (async, fire-and-forget)
    if (isNewTenant) {
      const loginUrl = `${env.CORS_ORIGIN}/${clinicSlug}/login`

      // Fetch tenant language setting
      const tenantSettings = await prisma.tenantSettings.findUnique({
        where: { tenantId: tenant.id },
        select: { language: true },
      })
      const language = (tenantSettings?.language || 'es') as Language

      // Don't await - send email in background without blocking response
      sendWelcomeEmail({
        to: email,
        firstName,
        clinicName: tenant.name,
        loginUrl,
        language,
      }).catch(() => {
        // Error is already logged in the email service
      })
    }

    res.status(201).json({
      user: {
        ...user,
        tenant: {
          id: tenant.id,
          name: tenant.name,
          slug: tenant.slug,
          logo: tenant.logo,
          currency: tenant.currency,
        },
      },
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    })
  } catch (e) {
    next(e)
  }
})

// POST /api/auth/login
authRouter.post('/login', loginIpRateLimit, loginAccountRateLimit, async (req, res, next) => {
  try {
    const parse = loginSchema.safeParse(req.body)
    if (!parse.success) {
      return res.status(400).json({
        success: false,
        error: { message: 'Invalid payload', code: 'INVALID_PAYLOAD', details: parse.error.errors },
      })
    }

    const { email, password, clinicSlug } = parse.data

    // Find tenant by slug
    const tenant = await prisma.tenant.findUnique({ where: { slug: clinicSlug } })
    if (!tenant) {
      return res.status(401).json({
        success: false,
        error: { message: 'Invalid credentials', code: 'INVALID_CREDENTIALS' },
      })
    }

    if (!tenant.isActive) {
      // #418: this 401 also consumes login-account budget (see the comment
      // above loginAccountLimiter) — accepted trade-off, not an oversight.
      return res.status(401).json({
        success: false,
        error: { message: 'This clinic is not active', code: 'CLINIC_NOT_ACTIVE' },
      })
    }

    // Find user by email and tenant
    const user = await prisma.user.findUnique({
      where: { tenantId_email: { tenantId: tenant.id, email } },
    })

    if (!user || !user.isActive) {
      return res.status(401).json({
        success: false,
        error: { message: 'Invalid credentials', code: 'INVALID_CREDENTIALS' },
      })
    }

    // Verify password
    const isValid = await verifyPassword(password, user.passwordHash)
    if (!isValid) {
      return res.status(401).json({
        success: false,
        error: { message: 'Invalid credentials', code: 'INVALID_CREDENTIALS' },
      })
    }

    // Generate tokens
    const tokens = generateTokens({
      userId: user.id,
      tenantId: user.tenantId || '',
      email: user.email,
      role: user.role,
    })

    // Store refresh token hash
    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(tokens.refreshToken),
        expiresAt: getExpiryDate(env.JWT_REFRESH_EXPIRES_IN),
      },
    })

    // Clean up old tokens for this user
    await cleanupOldRefreshTokens(user.id)

    // Update last login
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    })

    res.json({
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        tenantId: user.tenantId,
        tenant: {
          id: tenant.id,
          name: tenant.name,
          slug: tenant.slug,
          logo: tenant.logo,
          currency: tenant.currency,
        },
      },
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    })
  } catch (e) {
    next(e)
  }
})

// POST /api/auth/refresh
authRouter.post('/refresh', async (req, res, next) => {
  try {
    const parse = refreshSchema.safeParse(req.body)
    if (!parse.success) {
      return res.status(400).json({
        success: false,
        error: { message: 'Invalid payload', code: 'INVALID_PAYLOAD' },
      })
    }

    const { refreshToken } = parse.data

    // Verify the refresh token JWT is valid
    try {
      verifyRefreshToken(refreshToken)
    } catch {
      return res.status(401).json({
        success: false,
        error: { message: 'Invalid or expired refresh token', code: 'INVALID_REFRESH_TOKEN' },
      })
    }

    // Find the stored token hash
    const tokenHash = hashToken(refreshToken)
    const storedToken = await prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    })

    if (!storedToken) {
      return res.status(401).json({
        success: false,
        error: { message: 'Invalid refresh token', code: 'INVALID_REFRESH_TOKEN' },
      })
    }

    // Check if token is expired
    if (storedToken.expiresAt < new Date()) {
      await prisma.refreshToken.delete({ where: { id: storedToken.id } })
      return res.status(401).json({
        success: false,
        error: { message: 'Refresh token expired', code: 'REFRESH_TOKEN_EXPIRED' },
      })
    }

    const user = storedToken.user
    if (!user.isActive) {
      return res.status(401).json({
        success: false,
        error: { message: 'User account is disabled', code: 'USER_DISABLED' },
      })
    }

    // Generate new tokens (token rotation)
    const tokens = generateTokens({
      userId: user.id,
      tenantId: user.tenantId || '',
      email: user.email,
      role: user.role,
    })

    // Delete old refresh token and create new one atomically
    await prisma.$transaction(async (tx) => {
      await tx.refreshToken.delete({ where: { id: storedToken.id } })
      await tx.refreshToken.create({
        data: {
          userId: user.id,
          tokenHash: hashToken(tokens.refreshToken),
          expiresAt: getExpiryDate(env.JWT_REFRESH_EXPIRES_IN),
        },
      })
    })

    res.json({
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    })
  } catch (e) {
    next(e)
  }
})

// POST /api/auth/logout
authRouter.post('/logout', async (req, res, next) => {
  try {
    const parse = refreshSchema.safeParse(req.body)
    if (!parse.success) {
      // Logout without token is considered successful for idempotency.
      // This allows clients to call logout even if they've lost the token,
      // ensuring a consistent UX without revealing token existence.
      return res.status(204).send()
    }

    const { refreshToken } = parse.data

    // Delete the refresh token if it exists
    const tokenHash = hashToken(refreshToken)
    await prisma.refreshToken.deleteMany({
      where: { tokenHash },
    })

    res.status(204).send()
  } catch (e) {
    next(e)
  }
})

// GET /api/auth/me - Get current user info
authRouter.get('/me', async (req, res, next) => {
  try {
    // Extract token from Authorization header
    const authHeader = req.headers.authorization
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: { message: 'Missing authorization header', code: 'UNAUTHENTICATED' },
      })
    }

    const token = authHeader.slice(7)

    let payload
    try {
      payload = verifyAccessToken(token)
    } catch {
      return res.status(401).json({
        success: false,
        error: { message: 'Invalid or expired token', code: 'INVALID_TOKEN' },
      })
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        tenantId: true,
        avatar: true,
        phone: true,
        pinHash: true,
        emailVerified: true,
        lastLoginAt: true,
        createdAt: true,
        tenant: {
          select: {
            id: true,
            name: true,
            slug: true,
            logo: true,
            currency: true,
          },
        },
      },
    })

    if (!user) {
      return res.status(404).json({
        success: false,
        error: { message: 'User not found', code: 'USER_NOT_FOUND' },
      })
    }

    const { pinHash, ...userData } = user
    res.json({ ...userData, hasPinSet: !!pinHash })
  } catch (e) {
    next(e)
  }
})

// POST /api/auth/forgot-password - Request password reset for tenant user
authRouter.post('/forgot-password', forgotPasswordRateLimit, async (req, res, next) => {
  try {
    const parse = forgotPasswordSchema.safeParse(req.body)
    if (!parse.success) {
      return res.status(400).json({
        success: false,
        error: { message: 'Invalid payload', code: 'INVALID_PAYLOAD', details: parse.error.errors },
      })
    }

    const { email, clinicSlug } = parse.data
    const normalizedEmail = email.toLowerCase().trim()

    // Always respond with success to prevent email enumeration
    const successResponse = {
      success: true,
      message: 'If an account exists with this email, you will receive a password reset link.',
    }

    // Find tenant by slug
    const tenant = await prisma.tenant.findUnique({
      where: { slug: clinicSlug },
    })

    if (!tenant || !tenant.isActive) {
      // Don't reveal that the clinic doesn't exist
      logger.info({ email: normalizedEmail, clinicSlug }, 'Password reset requested for non-existent or inactive clinic')
      return res.status(200).json(successResponse)
    }

    // Find user by email and tenant (must not be SUPER_ADMIN)
    const user = await prisma.user.findUnique({
      where: {
        tenantId_email: { tenantId: tenant.id, email: normalizedEmail },
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        isActive: true,
        role: true,
      },
    })

    if (!user || !user.isActive || user.role === 'SUPER_ADMIN') {
      // Don't reveal that the user doesn't exist or is inactive
      logger.info({ email: normalizedEmail, clinicSlug }, 'Password reset requested for non-existent or ineligible user')
      return res.status(200).json(successResponse)
    }

    // Invalidate any existing tokens for this user
    await prisma.passwordResetToken.updateMany({
      where: {
        userId: user.id,
        usedAt: null,
      },
      data: {
        usedAt: new Date(), // Mark as used to invalidate
      },
    })

    // Generate new token
    const plainToken = generateResetToken()
    const tokenHash = hashToken(plainToken)
    const expiresAt = getTokenExpiryDate()

    // Store hashed token
    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt,
      },
    })

    // Fetch tenant language setting
    const tenantWithSettings = await prisma.tenant.findUnique({
      where: { id: tenant.id },
      select: {
        settings: {
          select: { language: true },
        },
      },
    })
    const language = (tenantWithSettings?.settings?.language || 'es') as 'es' | 'en' | 'ar'

    // Send email (fire-and-forget, don't block response)
    const resetUrl = buildTenantResetUrl(plainToken, clinicSlug)
    sendPasswordResetEmail({
      to: user.email,
      firstName: user.firstName,
      resetUrl,
      expiresInMinutes: TOKEN_EXPIRY_MINUTES,
      language,
    }).catch((err) => {
      logger.error({ err, userId: user.id }, 'Failed to send password reset email')
    })

    logger.info({ userId: user.id, clinicSlug }, 'Password reset token generated for tenant user')
    return res.status(200).json(successResponse)
  } catch (err) {
    next(err)
  }
})

// POST /api/auth/reset-password - Reset password with token
authRouter.post('/reset-password', resetPasswordRateLimit, async (req, res, next) => {
  try {
    const parse = resetPasswordSchema.safeParse(req.body)
    if (!parse.success) {
      return res.status(400).json({
        success: false,
        error: {
          message: 'Invalid request',
          code: 'INVALID_PAYLOAD',
          details: parse.error.errors,
        },
      })
    }

    const { token, password } = parse.data

    // Hash the provided token to compare with stored hash
    const tokenHash = hashToken(token)

    // Find valid token
    const resetToken = await prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      include: {
        user: {
          select: {
            id: true,
            isActive: true,
            role: true,
            tenantId: true,
          },
        },
      },
    })

    // Validate token
    if (!resetToken) {
      return res.status(400).json({
        success: false,
        error: { message: 'Invalid or expired reset link', code: 'INVALID_TOKEN' },
      })
    }

    if (resetToken.usedAt) {
      return res.status(400).json({
        success: false,
        error: { message: 'This reset link has already been used', code: 'TOKEN_USED' },
      })
    }

    if (resetToken.expiresAt < new Date()) {
      return res.status(400).json({
        success: false,
        error: { message: 'This reset link has expired', code: 'TOKEN_EXPIRED' },
      })
    }

    if (!resetToken.user.isActive) {
      return res.status(400).json({
        success: false,
        error: { message: 'Account is deactivated', code: 'ACCOUNT_INACTIVE' },
      })
    }

    // This endpoint is for tenant users only (must have tenantId)
    if (!resetToken.user.tenantId) {
      return res.status(400).json({
        success: false,
        error: { message: 'Invalid reset link', code: 'INVALID_TOKEN' },
      })
    }

    // Hash new password
    const passwordHash = await hashPassword(password)

    // Update password and mark token as used in a transaction
    await prisma.$transaction([
      // Update user password
      prisma.user.update({
        where: { id: resetToken.userId },
        data: { passwordHash },
      }),
      // Mark token as used
      prisma.passwordResetToken.update({
        where: { id: resetToken.id },
        data: { usedAt: new Date() },
      }),
      // Invalidate all refresh tokens for security
      prisma.refreshToken.deleteMany({
        where: { userId: resetToken.userId },
      }),
    ])

    logger.info({ userId: resetToken.userId }, 'Password reset successful for tenant user')

    return res.status(200).json({
      success: true,
      message: 'Password has been reset successfully. You can now log in with your new password.',
    })
  } catch (err) {
    next(err)
  }
})

// GET /api/auth/profiles - List user profiles for lock screen (requires JWT)
authRouter.get('/profiles', requireAuth, async (req, res, next) => {
  try {
    const users = await prisma.user.findMany({
      where: { tenantId: req.user!.tenantId, isActive: true, role: { not: 'SUPER_ADMIN' } },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        role: true,
        avatar: true,
        pinHash: true,
      },
      orderBy: { firstName: 'asc' },
    })

    const profiles = users.map(({ pinHash, ...u }) => ({
      ...u,
      hasPinSet: !!pinHash,
    }))

    res.json(profiles)
  } catch (e) {
    next(e)
  }
})

// POST /api/auth/pin-login - Authenticate with PIN (requires JWT)
const pinLoginSchema = z.object({
  userId: z.string().min(1),
  pin: z.string().regex(/^\d{4}$/, 'PIN must be exactly 4 digits'),
})

authRouter.post('/pin-login', requireAuth, async (req, res, next) => {
  try {
    const parse = pinLoginSchema.safeParse(req.body)
    if (!parse.success) {
      return res.status(400).json({
        success: false,
        error: { message: 'Invalid payload', code: 'INVALID_PAYLOAD', details: parse.error.errors },
      })
    }

    const { userId, pin } = parse.data

    const user = await prisma.user.findFirst({
      where: { id: userId, tenantId: req.user!.tenantId, isActive: true },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        role: true,
        avatar: true,
        pinHash: true,
      },
    })

    if (!user) {
      return res.status(401).json({
        success: false,
        error: { message: 'Invalid credentials', code: 'INVALID_CREDENTIALS' },
      })
    }

    if (!user.pinHash) {
      return res.status(400).json({
        success: false,
        error: { message: 'PIN not set', code: 'PIN_NOT_SET' },
      })
    }

    const isValid = await verifyPassword(pin, user.pinHash)
    if (!isValid) {
      return res.status(401).json({
        success: false,
        error: { message: 'Invalid credentials', code: 'INVALID_CREDENTIALS' },
      })
    }

    const profileToken = generateProfileToken({
      profileUserId: user.id,
      role: user.role,
      tenantId: req.user!.tenantId,
    })

    const { pinHash, ...userData } = user

    res.json({
      profileToken,
      user: { ...userData, hasPinSet: !!pinHash },
    })
  } catch (e) {
    next(e)
  }
})

// POST /api/auth/setup-pin - Set PIN for first time (requires JWT)
const setupPinSchema = z.object({
  userId: z.string().min(1),
  pin: z.string().regex(/^\d{4}$/, 'PIN must be exactly 4 digits'),
})

authRouter.post('/setup-pin', requireAuth, async (req, res, next) => {
  try {
    const parse = setupPinSchema.safeParse(req.body)
    if (!parse.success) {
      return res.status(400).json({
        success: false,
        error: { message: 'Invalid payload', code: 'INVALID_PAYLOAD', details: parse.error.errors },
      })
    }

    const { userId, pin } = parse.data

    // Deliberately compared against the base session's userId, not
    // profileUserId: a profile session is already an elevated context
    // (middleware/auth.ts overwrites req.user.role from the profile token),
    // so treating "self" as the switched-in profile would let it provision
    // its own credentials. Accepted cost: no self-service first-PIN setup
    // while operating inside a profile session.
    const isSelf = userId === req.user!.userId
    if (!isSelf && !hasMinRole(req.user!.role, 'ADMIN')) {
      return res.status(403).json({
        success: false,
        error: { message: 'Insufficient permissions', code: 'FORBIDDEN' },
      })
    }

    const user = await prisma.user.findFirst({
      where: { id: userId, tenantId: req.user!.tenantId, isActive: true },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        role: true,
        avatar: true,
        pinHash: true,
      },
    })

    if (!user) {
      return res.status(404).json({
        success: false,
        error: { message: 'User not found', code: 'USER_NOT_FOUND' },
      })
    }

    if (user.pinHash) {
      return res.status(409).json({
        success: false,
        error: { message: 'PIN already set. Use the users page to change it.', code: 'PIN_ALREADY_SET' },
      })
    }

    const pinHash = await hashPassword(pin)
    await prisma.user.update({
      where: { id: user.id },
      data: { pinHash },
    })

    // Only issue a role-bearing profile token when the caller is provisioning
    // their own PIN. An ADMIN provisioning someone else's PIN must not walk
    // away with a token for that other user's role — that would turn
    // provisioning into an impersonation primitive.
    const profileToken = isSelf
      ? generateProfileToken({
          profileUserId: user.id,
          role: user.role,
          tenantId: req.user!.tenantId,
        })
      : undefined

    res.json({
      ...(profileToken ? { profileToken } : {}),
      user: { id: user.id, firstName: user.firstName, lastName: user.lastName, role: user.role, avatar: user.avatar, hasPinSet: true },
    })
  } catch (e) {
    next(e)
  }
})

export { authRouter }
