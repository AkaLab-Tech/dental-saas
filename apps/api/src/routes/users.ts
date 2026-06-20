import { Router, type IRouter } from 'express'
import { z } from 'zod'
import { prisma, UserRole } from '@dental/database'
import { requireMinRole, hasMinRole } from '../middleware/auth.js'
import {
  listUsers,
  getUserById,
  createUser,
  createProfile,
  updateUser,
  updateUserRole,
  deleteUser,
  setUserPin,
  checkRoleLimitForNewUser,
  countUsersByRole,
  getTenantPlanLimits,
} from '../services/user.service.js'

const usersRouter: IRouter = Router()

// Password schema with strong requirements
const passwordSchema = z
  .string()
  .min(8, { message: 'Password must be at least 8 characters long' })
  .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^\w\s]).+$/, {
    message:
      'Password must include at least one uppercase letter, one lowercase letter, one number, and one special character',
  })

// Phone validation: if provided, must be non-empty (rejects empty strings)
const phoneSchema = z.string().min(1, 'Phone number cannot be empty').optional()

// Query params validation for list endpoint
const listUsersQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).optional(),
  offset: z.coerce.number().int().nonnegative().optional(),
  includeInactive: z.enum(['true', 'false']).optional(),
})

// Validation schemas
const createUserSchema = z.object({
  email: z.string().email(),
  password: passwordSchema,
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  role: z.enum(['ADMIN', 'CLINIC_ADMIN', 'DOCTOR', 'STAFF']), // OWNER cannot be assigned via API, SUPER_ADMIN is forbidden
  phone: phoneSchema,
  avatar: z.string().url().optional(),
})

const createProfileSchema = z.object({
  profileOnly: z.literal(true),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  role: z.enum(['ADMIN', 'CLINIC_ADMIN', 'DOCTOR', 'STAFF']),
})

const updateUserSchema = z.object({
  email: z.string().email().optional(),
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  phone: phoneSchema,
  avatar: z.string().url().optional(),
  isActive: z.boolean().optional(),
})

const updateRoleSchema = z.object({
  role: z.enum(['OWNER', 'ADMIN', 'CLINIC_ADMIN', 'DOCTOR', 'STAFF']), // SUPER_ADMIN is forbidden
})

/**
 * GET /api/users
 * List all users for the tenant (ADMIN+ required)
 */
usersRouter.get('/', requireMinRole('ADMIN'), async (req, res, next) => {
  try {
    const tenantId = req.user!.tenantId

    const parsedQuery = listUsersQuerySchema.safeParse(req.query)
    if (!parsedQuery.success) {
      return res.status(400).json({
        success: false,
        error: { message: 'Invalid query parameters', code: 'INVALID_QUERY', details: parsedQuery.error.errors },
      })
    }

    const { limit, offset, includeInactive } = parsedQuery.data

    const users = await listUsers(tenantId, {
      limit,
      offset,
      includeInactive: includeInactive === 'true',
    })

    res.json({
      success: true,
      data: users,
    })
  } catch (e) {
    next(e)
  }
})

/**
 * GET /api/users/stats
 * Get user counts by role and plan limits (ADMIN+ required)
 */
usersRouter.get('/stats', requireMinRole('ADMIN'), async (req, res, next) => {
  try {
    const tenantId = req.user!.tenantId

    const [counts, limits] = await Promise.all([
      countUsersByRole(tenantId),
      getTenantPlanLimits(tenantId),
    ])

    res.json({
      success: true,
      data: {
        counts,
        limits,
      },
    })
  } catch (e) {
    next(e)
  }
})

/**
 * GET /api/users/:id
 * Get a single user by ID (ADMIN+ required)
 */
usersRouter.get('/:id', requireMinRole('ADMIN'), async (req, res, next) => {
  try {
    const tenantId = req.user!.tenantId
    const { id } = req.params

    const user = await getUserById(tenantId, id)

    if (!user) {
      return res.status(404).json({
        success: false,
        error: { message: 'User not found', code: 'NOT_FOUND' },
      })
    }

    res.json({
      success: true,
      data: user,
    })
  } catch (e) {
    next(e)
  }
})

/**
 * POST /api/users
 * Create a new user or profile-only user (ADMIN+ required)
 * When profileOnly=true, only firstName, lastName, and role are required.
 */
usersRouter.post('/', requireMinRole('ADMIN'), async (req, res, next) => {
  try {
    const tenantId = req.user!.tenantId

    // Check if this is a profile-only creation
    if (req.body.profileOnly === true) {
      const parse = createProfileSchema.safeParse(req.body)
      if (!parse.success) {
        return res.status(400).json({
          success: false,
          error: { message: 'Invalid payload', code: 'INVALID_PAYLOAD', details: parse.error.errors },
        })
      }

      const { firstName, lastName, role } = parse.data

      // Check plan limits
      const limitCheck = await checkRoleLimitForNewUser(tenantId, role as UserRole)
      if (!limitCheck.allowed) {
        return res.status(403).json({
          success: false,
          error: {
            message: limitCheck.message,
            code: 'PLAN_LIMIT_EXCEEDED',
            currentCount: limitCheck.currentCount,
            limit: limitCheck.limit,
          },
        })
      }

      const user = await createProfile(tenantId, {
        firstName,
        lastName,
        role: role as UserRole,
      })

      return res.status(201).json({
        success: true,
        data: user,
      })
    }

    // Standard user creation with email + password
    const parse = createUserSchema.safeParse(req.body)
    if (!parse.success) {
      return res.status(400).json({
        success: false,
        error: { message: 'Invalid payload', code: 'INVALID_PAYLOAD', details: parse.error.errors },
      })
    }

    const { email, password, firstName, lastName, role, phone, avatar } = parse.data

    // Check if email already exists for this tenant
    const existingUser = await prisma.user.findUnique({
      where: { tenantId_email: { tenantId, email } },
    })
    if (existingUser) {
      return res.status(409).json({
        success: false,
        error: { message: 'Email already registered', code: 'EMAIL_EXISTS' },
      })
    }

    // Check plan limits
    const limitCheck = await checkRoleLimitForNewUser(tenantId, role as UserRole)
    if (!limitCheck.allowed) {
      return res.status(403).json({
        success: false,
        error: {
          message: limitCheck.message,
          code: 'PLAN_LIMIT_EXCEEDED',
          currentCount: limitCheck.currentCount,
          limit: limitCheck.limit,
        },
      })
    }

    const user = await createUser(tenantId, {
      email,
      password,
      firstName,
      lastName,
      role: role as UserRole,
      phone,
      avatar,
    })

    res.status(201).json({
      success: true,
      data: user,
    })
  } catch (e) {
    next(e)
  }
})

/**
 * PUT /api/users/:id
 * Update a user (ADMIN+ required)
 */
usersRouter.put('/:id', requireMinRole('ADMIN'), async (req, res, next) => {
  try {
    const tenantId = req.user!.tenantId
    const { id } = req.params

    const parse = updateUserSchema.safeParse(req.body)
    if (!parse.success) {
      return res.status(400).json({
        success: false,
        error: { message: 'Invalid payload', code: 'INVALID_PAYLOAD', details: parse.error.errors },
      })
    }

    // Check for email conflict if updating email
    if (parse.data.email) {
      const existingUser = await prisma.user.findFirst({
        where: {
          tenantId,
          email: parse.data.email,
          id: { not: id },
        },
      })
      if (existingUser) {
        return res.status(409).json({
          success: false,
          error: { message: 'Email already registered', code: 'EMAIL_EXISTS' },
        })
      }
    }

    const user = await updateUser(tenantId, id, parse.data)

    if (!user) {
      return res.status(404).json({
        success: false,
        error: { message: 'User not found', code: 'NOT_FOUND' },
      })
    }

    res.json({
      success: true,
      data: user,
    })
  } catch (e) {
    next(e)
  }
})

/**
 * PUT /api/users/:id/role
 * Update a user's role (OWNER required for OWNER changes, ADMIN+ for others)
 */
usersRouter.put('/:id/role', requireMinRole('ADMIN'), async (req, res, next) => {
  try {
    const tenantId = req.user!.tenantId
    const requestingUserRole = req.user!.role as UserRole
    const { id } = req.params

    const parse = updateRoleSchema.safeParse(req.body)
    if (!parse.success) {
      return res.status(400).json({
        success: false,
        error: { message: 'Invalid payload', code: 'INVALID_PAYLOAD', details: parse.error.errors },
      })
    }

    const result = await updateUserRole(tenantId, id, parse.data.role as UserRole, requestingUserRole)

    if (!result.success) {
      const statusCode = result.error === 'User not found' ? 404 : 403
      return res.status(statusCode).json({
        success: false,
        error: { message: result.error, code: statusCode === 404 ? 'NOT_FOUND' : 'FORBIDDEN' },
      })
    }

    res.json({
      success: true,
      data: result.user,
    })
  } catch (e) {
    next(e)
  }
})

/**
 * DELETE /api/users/:id
 * Soft delete a user (ADMIN+ required)
 */
usersRouter.delete('/:id', requireMinRole('ADMIN'), async (req, res, next) => {
  try {
    const tenantId = req.user!.tenantId
    const requestingUserId = req.user!.userId
    const { id } = req.params

    const result = await deleteUser(tenantId, id, requestingUserId)

    if (!result.success) {
      const statusCode = result.error === 'User not found' ? 404 : 403
      return res.status(statusCode).json({
        success: false,
        error: { message: result.error, code: statusCode === 404 ? 'NOT_FOUND' : 'FORBIDDEN' },
      })
    }

    res.json({
      success: true,
      message: 'User deleted successfully',
    })
  } catch (e) {
    next(e)
  }
})

/**
 * PUT /api/users/:id/pin
 * Set or update a user's 4-digit PIN (self-service or ADMIN+)
 */
const pinSchema = z.object({
  pin: z.string().regex(/^\d{4}$/, 'PIN must be exactly 4 digits'),
})

usersRouter.put('/:id/pin', async (req, res, next) => {
  try {
    const tenantId = req.user!.tenantId
    const requestingUserId = req.user!.userId
    const { id } = req.params

    // Self-service or ADMIN+ can set PIN for others
    const isSelf = id === requestingUserId
    if (!isSelf && !hasMinRole(req.user!.role, 'ADMIN')) {
      return res.status(403).json({
        success: false,
        error: { message: 'Insufficient permissions', code: 'FORBIDDEN' },
      })
    }

    const parse = pinSchema.safeParse(req.body)
    if (!parse.success) {
      return res.status(400).json({
        success: false,
        error: { message: 'Invalid payload', code: 'INVALID_PAYLOAD', details: parse.error.errors },
      })
    }

    await setUserPin(tenantId, id, parse.data.pin)

    res.json({ success: true, message: 'PIN set successfully' })
  } catch (e) {
    if (e instanceof Error && e.message === 'User not found') {
      return res.status(404).json({
        success: false,
        error: { message: 'User not found', code: 'NOT_FOUND' },
      })
    }
    next(e)
  }
})

export { usersRouter }
