import { Router, type IRouter } from 'express'
import { z } from 'zod'
import { requireMinRole } from '../middleware/auth.js'
import {
  listDoctors,
  getDoctorById,
  createDoctor,
  updateDoctor,
  deleteDoctor,
  restoreDoctor,
  checkDoctorLimit,
  getDoctorStats,
} from '../services/doctor.service.js'

const doctorsRouter: IRouter = Router()

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Prisma P2002 unique constraint error type
 */
type PrismaP2002Error = {
  code?: string
  meta?: {
    driverAdapterError?: {
      cause?: {
        originalMessage?: string
      }
    }
  }
}

/**
 * Handle Prisma P2002 unique constraint violations
 * Returns true if the error was handled, false otherwise
 */
function handlePrismaUniqueError(
  e: unknown,
  res: import('express').Response
): boolean {
  const error = e as PrismaP2002Error
  if (error.code !== 'P2002') {
    return false
  }

  const originalMessage = error.meta?.driverAdapterError?.cause?.originalMessage || ''

  if (originalMessage.includes('email')) {
    res.status(409).json({
      success: false,
      error: { message: 'A doctor with this email already exists', code: 'DUPLICATE_EMAIL' },
    })
    return true
  }

  if (originalMessage.includes('licenseNumber')) {
    res.status(409).json({
      success: false,
      error: { message: 'A doctor with this license number already exists', code: 'DUPLICATE_LICENSE' },
    })
    return true
  }

  // Generic duplicate error
  res.status(409).json({
    success: false,
    error: { message: 'A doctor with these values already exists', code: 'DUPLICATE_ENTRY' },
  })
  return true
}

// ============================================================================
// Validation Schemas
// ============================================================================

// Phone validation: if provided, must be non-empty string
// Using transform to normalize empty strings to undefined for cleaner handling
const phoneSchema = z
  .string()
  .optional()
  .nullable()
  .transform((val) => (val === '' ? undefined : val))

// Working hours schema
const workingHoursSchema = z
  .object({
    start: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Start time must be in HH:MM format'),
    end: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'End time must be in HH:MM format'),
  })
  .optional()
  .nullable()

// Query params validation for list endpoint
const listDoctorsQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).optional(),
  offset: z.coerce.number().int().nonnegative().optional(),
  includeInactive: z.enum(['true', 'false']).optional(),
  search: z.string().optional(),
})

// Create doctor schema
const createDoctorSchema = z.object({
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().min(1, 'Last name is required'),
  email: z.string().email().optional(),
  phone: phoneSchema,
  specialty: z.string().min(1).optional(),
  licenseNumber: z.string().min(1).optional(),
  workingDays: z.array(z.enum(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'])).optional(),
  workingHours: workingHoursSchema,
  consultingRoom: z.string().min(1).optional(),
  avatar: z.string().url().optional(),
  bio: z.string().max(5000, 'Bio cannot exceed 5000 characters').optional(),
  hourlyRate: z.number().positive().optional(),
  userId: z.string().optional(),
})

// Update doctor schema (all fields optional)
const updateDoctorSchema = z.object({
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  email: z.string().email().optional().nullable(),
  phone: phoneSchema,
  specialty: z.string().min(1).optional().nullable(),
  licenseNumber: z.string().min(1).optional().nullable(),
  workingDays: z.array(z.enum(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'])).optional(),
  workingHours: workingHoursSchema,
  consultingRoom: z.string().min(1).optional().nullable(),
  avatar: z.string().url().optional().nullable(),
  bio: z.string().max(5000, 'Bio cannot exceed 5000 characters').optional().nullable(),
  hourlyRate: z.number().positive().optional().nullable(),
  userId: z.string().optional().nullable(),
})

// ============================================================================
// Routes
// ============================================================================

/**
 * GET /api/doctors
 * List all doctors for the tenant (STAFF+ required)
 */
doctorsRouter.get('/', requireMinRole('STAFF'), async (req, res, next) => {
  try {
    const tenantId = req.user!.tenantId

    const parsedQuery = listDoctorsQuerySchema.safeParse(req.query)
    if (!parsedQuery.success) {
      return res.status(400).json({
        success: false,
        error: { message: 'Invalid query parameters', code: 'INVALID_QUERY', details: parsedQuery.error.errors },
      })
    }

    const { limit, offset, includeInactive, search } = parsedQuery.data

    const doctors = await listDoctors(tenantId, {
      limit,
      offset,
      includeInactive: includeInactive === 'true',
      search,
    })

    res.json({
      success: true,
      data: doctors,
    })
  } catch (e) {
    next(e)
  }
})

/**
 * GET /api/doctors/stats
 * Get doctor counts and plan limits (ADMIN+ required)
 */
doctorsRouter.get('/stats', requireMinRole('CLINIC_ADMIN'), async (req, res, next) => {
  try {
    const tenantId = req.user!.tenantId

    const stats = await getDoctorStats(tenantId)

    res.json({
      success: true,
      data: stats,
    })
  } catch (e) {
    next(e)
  }
})

/**
 * GET /api/doctors/:id
 * Get a single doctor by ID (STAFF+ required)
 */
doctorsRouter.get('/:id', requireMinRole('STAFF'), async (req, res, next) => {
  try {
    const tenantId = req.user!.tenantId
    const { id } = req.params

    const doctor = await getDoctorById(tenantId, id)

    if (!doctor) {
      return res.status(404).json({
        success: false,
        error: { message: 'Doctor not found', code: 'NOT_FOUND' },
      })
    }

    res.json({
      success: true,
      data: doctor,
    })
  } catch (e) {
    next(e)
  }
})

/**
 * POST /api/doctors
 * Create a new doctor (ADMIN+ required)
 */
doctorsRouter.post('/', requireMinRole('CLINIC_ADMIN'), async (req, res, next) => {
  try {
    const tenantId = req.user!.tenantId

    // Check plan limits first
    const limitCheck = await checkDoctorLimit(tenantId)
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

    // Validate request body
    const parsed = createDoctorSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: { message: 'Invalid request body', code: 'VALIDATION_ERROR', details: parsed.error.errors },
      })
    }

    // Transform null phone to undefined for create (create doesn't accept null)
    const createData = {
      ...parsed.data,
      phone: parsed.data.phone ?? undefined,
      workingHours: parsed.data.workingHours ?? undefined,
    }

    const doctor = await createDoctor(tenantId, createData)

    res.status(201).json({
      success: true,
      data: doctor,
    })
  } catch (e) {
    if (handlePrismaUniqueError(e, res)) {
      return
    }
    next(e)
  }
})

/**
 * PUT /api/doctors/:id
 * Update a doctor (ADMIN+ required)
 */
doctorsRouter.put('/:id', requireMinRole('CLINIC_ADMIN'), async (req, res, next) => {
  try {
    const tenantId = req.user!.tenantId
    const { id } = req.params

    // Validate request body
    const parsed = updateDoctorSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: { message: 'Invalid request body', code: 'VALIDATION_ERROR', details: parsed.error.errors },
      })
    }

    const doctor = await updateDoctor(tenantId, id, parsed.data)

    if (!doctor) {
      return res.status(404).json({
        success: false,
        error: { message: 'Doctor not found', code: 'NOT_FOUND' },
      })
    }

    res.json({
      success: true,
      data: doctor,
    })
  } catch (e) {
    if (handlePrismaUniqueError(e, res)) {
      return
    }
    next(e)
  }
})

/**
 * DELETE /api/doctors/:id
 * Soft delete a doctor (ADMIN+ required)
 */
doctorsRouter.delete('/:id', requireMinRole('CLINIC_ADMIN'), async (req, res, next) => {
  try {
    const tenantId = req.user!.tenantId
    const { id } = req.params

    const result = await deleteDoctor(tenantId, id)

    if (!result.success) {
      // Use errorCode for reliable error type detection
      if (result.errorCode === 'NOT_FOUND') {
        return res.status(404).json({
          success: false,
          error: { message: result.error, code: 'NOT_FOUND' },
        })
      }

      // ALREADY_INACTIVE or other cases
      return res.status(400).json({
        success: false,
        error: { message: result.error, code: result.errorCode || 'INVALID_OPERATION' },
      })
    }

    res.json({
      success: true,
      message: 'Doctor deleted successfully',
    })
  } catch (e) {
    next(e)
  }
})

/**
 * PUT /api/doctors/:id/restore
 * Restore a soft-deleted doctor (ADMIN+ required)
 */
doctorsRouter.put('/:id/restore', requireMinRole('CLINIC_ADMIN'), async (req, res, next) => {
  try {
    const tenantId = req.user!.tenantId
    const { id } = req.params

    const result = await restoreDoctor(tenantId, id)

    if (!result.success) {
      // Use errorCode for reliable error type detection
      if (result.errorCode === 'PLAN_LIMIT_EXCEEDED') {
        return res.status(403).json({
          success: false,
          error: { message: result.error, code: 'PLAN_LIMIT_EXCEEDED' },
        })
      }

      if (result.errorCode === 'NOT_FOUND') {
        return res.status(404).json({
          success: false,
          error: { message: result.error, code: 'NOT_FOUND' },
        })
      }

      // ALREADY_ACTIVE or other cases
      return res.status(400).json({
        success: false,
        error: { message: result.error, code: result.errorCode || 'INVALID_OPERATION' },
      })
    }

    res.json({
      success: true,
      data: result.doctor,
    })
  } catch (e) {
    next(e)
  }
})

export { doctorsRouter }
