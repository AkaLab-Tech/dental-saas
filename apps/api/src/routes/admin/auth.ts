import { Router, type IRouter, type Request } from 'express'
import { z } from 'zod'
import { prisma } from '@dental/database'
import {
  hashPassword,
  hashToken,
  verifyPassword,
  generateTokens,
  getExpiryDate,
  cleanupOldRefreshTokens,
} from '../../services/auth.service.js'
import { sendPasswordResetEmail } from '../../services/email.service.js'
import { logger } from '../../utils/logger.js'
import { env } from '../../config/env.js'
import {
  TOKEN_EXPIRY_MINUTES,
  generateResetToken,
  getTokenExpiryDate,
  buildAdminResetUrl,
} from '../../utils/password-reset.js'
import {
  createRateLimiter,
  hashLoginAccountKey,
  LOGIN_RATE_LIMIT_WINDOW_MS,
  LOGIN_IP_RATE_LIMIT,
  LOGIN_ACCOUNT_RATE_LIMIT,
  RECOVERY_RATE_LIMIT_WINDOW_MS,
  RECOVERY_RATE_LIMIT,
  type ResettableStore,
} from '../../middleware/rate-limit.js'

const authRouter: IRouter = Router()

// #418: same shape as the tenant login limiters in routes/auth.ts — two
// independent limiters (IP then account), each counting only rejected
// credentials (a 401), not every non-2xx. See routes/auth.ts for the full
// rationale (single-key composition, requestWasSuccessful narrowing,
// fail-open trade-off tracked by #420). No tenant dimension here: super
// admins have no tenantId.
function adminLoginAccountKey(req: Request): string | undefined {
  const body = req.body as unknown
  if (!body || typeof body !== 'object') return undefined
  const { email } = body as Record<string, unknown>
  if (typeof email !== 'string') return undefined
  return hashLoginAccountKey(email)
}

const loginIpLimiter = createRateLimiter({
  windowMs: LOGIN_RATE_LIMIT_WINDOW_MS,
  limit: LOGIN_IP_RATE_LIMIT,
  keyPrefix: 'login-ip-admin',
  message: 'Too many login attempts. Please try again later.',
  skipSuccessfulRequests: true,
  requestWasSuccessful: (_req, res) => res.statusCode !== 401,
})
// See routes/auth.ts's loginAccountLimiter for why account-keyed limiting is
// an accepted lockout trade-off rather than an oversight.
const loginAccountLimiter = createRateLimiter({
  windowMs: LOGIN_RATE_LIMIT_WINDOW_MS,
  limit: LOGIN_ACCOUNT_RATE_LIMIT,
  keyPrefix: 'login-account-admin',
  message: 'Too many login attempts. Please try again later.',
  skipSuccessfulRequests: true,
  requestWasSuccessful: (_req, res) => res.statusCode !== 401,
  skip: (req) => adminLoginAccountKey(req) === undefined,
  keyGenerator: (req) => adminLoginAccountKey(req) ?? '',
})

export const loginIpRateLimitStore = loginIpLimiter.store as ResettableStore
export const loginAccountRateLimitStore = loginAccountLimiter.store as ResettableStore

const loginIpRateLimit = loginIpLimiter.limiter
const loginAccountRateLimit = loginAccountLimiter.limiter

// #417: #254 rate-limited the TENANT recovery pair and left these two
// unlimited. They are structurally identical and unauthenticated, against
// the highest-value credential in the system.
//
// The threat model is stated once, beside the tenant pair in routes/auth.ts
// — read it there. It is referenced rather than restated on purpose: its
// load-bearing sentence is a NEGATION (this is not a defence against
// reset-token brute force), and a paraphrase is exactly how a negation gets
// dropped and a limiter ends up described as a control it is not.
//
// What IS specific here: these buckets are separate from the tenant ones.
// The keyPrefix is the only thing separating them under Redis, so reusing
// 'forgot-password' / 'reset-password' would silently merge super-admin and
// tenant recovery into one bucket per IP in production while every
// MemoryStore-backed test still passed. The registry in
// middleware/rate-limit.ts turns that specific mistake into a boot failure,
// but the naming below is what makes it not arise.
const adminForgotPasswordLimiter = createRateLimiter({
  windowMs: RECOVERY_RATE_LIMIT_WINDOW_MS,
  limit: RECOVERY_RATE_LIMIT,
  keyPrefix: 'admin-forgot-password',
  message: 'Too many password recovery attempts. Please try again later.',
})
const adminResetPasswordLimiter = createRateLimiter({
  windowMs: RECOVERY_RATE_LIMIT_WINDOW_MS,
  limit: RECOVERY_RATE_LIMIT,
  keyPrefix: 'admin-reset-password',
  message: 'Too many password recovery attempts. Please try again later.',
})

export const adminForgotPasswordRateLimitStore =
  adminForgotPasswordLimiter.store as ResettableStore
export const adminResetPasswordRateLimitStore =
  adminResetPasswordLimiter.store as ResettableStore

const adminForgotPasswordRateLimit = adminForgotPasswordLimiter.limiter
const adminResetPasswordRateLimit = adminResetPasswordLimiter.limiter

// Password validation schema (same as registration)
const passwordSchema = z
  .string()
  .min(8, { message: 'Password must be at least 8 characters long' })
  .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^\w\s]).+$/, {
    message:
      'Password must include at least one uppercase letter, one lowercase letter, one number, and one special character',
  })

const forgotPasswordSchema = z.object({
  email: z.string().email(),
})

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: passwordSchema,
})

// POST /api/admin/auth/login
authRouter.post('/login', loginIpRateLimit, loginAccountRateLimit, async (req, res, next) => {
  try {
    const parse = loginSchema.safeParse(req.body)
    if (!parse.success) {
      return res.status(400).json({
        success: false,
        error: { message: 'Invalid payload', code: 'INVALID_PAYLOAD', details: parse.error.errors },
      })
    }

    const { email, password } = parse.data
    const normalizedEmail = email.toLowerCase().trim()

    // Find user by email - must be SUPER_ADMIN without tenantId
    const user = await prisma.user.findFirst({
      where: {
        email: normalizedEmail,
        role: 'SUPER_ADMIN',
        tenantId: null,
      },
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

    // Clean up old tokens for this user before creating new one
    await cleanupOldRefreshTokens(user.id)

    // Generate tokens
    const tokens = generateTokens({
      userId: user.id,
      tenantId: '',
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

    // Update last login
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    })

    logger.info({ userId: user.id }, 'Super admin logged in successfully')

    res.json({
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        createdAt: user.createdAt,
      },
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    })
  } catch (e) {
    next(e)
  }
})

// POST /api/admin/auth/forgot-password
authRouter.post('/forgot-password', adminForgotPasswordRateLimit, async (req, res, next) => {
  try {
    const parse = forgotPasswordSchema.safeParse(req.body)
    if (!parse.success) {
      return res.status(400).json({
        success: false,
        error: { message: 'Invalid email address', code: 'INVALID_PAYLOAD' },
      })
    }

    const { email } = parse.data
    const normalizedEmail = email.toLowerCase().trim()

    // Always respond with success to prevent email enumeration
    const successResponse = {
      success: true,
      message: 'If an account exists with this email, you will receive a password reset link.',
    }

    // Find SUPER_ADMIN user with this email (tenantId is null for super admins)
    const user = await prisma.user.findFirst({
      where: {
        email: normalizedEmail,
        tenantId: null, // Super admins have no tenant
        role: 'SUPER_ADMIN',
        isActive: true,
      },
      select: {
        id: true,
        email: true,
        firstName: true,
      },
    })

    if (!user) {
      // Don't reveal that the user doesn't exist
      logger.info({ email: normalizedEmail }, 'Password reset requested for non-existent super admin')
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

    // Send email (fire-and-forget, don't block response)
    // Super admin emails default to English
    const resetUrl = buildAdminResetUrl(plainToken)
    sendPasswordResetEmail({
      to: user.email,
      firstName: user.firstName,
      resetUrl,
      expiresInMinutes: TOKEN_EXPIRY_MINUTES,
      language: 'en',
    }).catch((err) => {
      logger.error({ err, userId: user.id }, 'Failed to send password reset email')
    })

    logger.info({ userId: user.id }, 'Password reset token generated for super admin')
    return res.status(200).json(successResponse)
  } catch (err) {
    next(err)
  }
})

// POST /api/admin/auth/reset-password
authRouter.post('/reset-password', adminResetPasswordRateLimit, async (req, res, next) => {
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

    if (resetToken.user.role !== 'SUPER_ADMIN') {
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

    logger.info({ userId: resetToken.userId }, 'Password reset successful for super admin')

    return res.status(200).json({
      success: true,
      message: 'Password has been reset successfully. You can now log in with your new password.',
    })
  } catch (err) {
    next(err)
  }
})

export { authRouter }
