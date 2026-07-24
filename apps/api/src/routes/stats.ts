import { Router, type IRouter, type Request } from 'express'
import { z } from 'zod'
import { requireMinRole } from '../middleware/auth.js'
import {
  getOverviewStats,
  getAppointmentStatsForPeriod,
  getRevenueStats,
  getPatientsGrowthStats,
  getDoctorPerformanceStats,
  getUpcomingAppointments,
  getAppointmentTypeStats,
} from '../services/stats.service.js'
import { getLinkedDoctorId } from '../services/doctor.service.js'

const statsRouter: IRouter = Router()

// ============================================================================
// Validation Schemas
// ============================================================================

const dateRangeSchema = z.object({
  startDate: z
    .string()
    .datetime({ message: 'Invalid startDate format' })
    .optional(),
  endDate: z
    .string()
    .datetime({ message: 'Invalid endDate format' })
    .optional(),
  doctorId: z.string().optional(),
})

const monthsBackSchema = z.object({
  months: z
    .string()
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().int().min(1).max(24))
    .optional(),
  doctorId: z.string().optional(),
})

// ============================================================================
// Authorization helper
// ============================================================================

const ADMIN_STATS_ROLES = ['OWNER', 'ADMIN', 'CLINIC_ADMIN']

/**
 * Authorize a doctor-scoped stats request.
 * - Admins (OWNER/ADMIN/CLINIC_ADMIN) may scope to any doctorId, or none
 *   (tenant-wide).
 * - Non-admins (DOCTOR/STAFF) may view tenant-wide stats (no doctorId) — the
 *   existing behaviour — but if they request a SPECIFIC doctorId it must be
 *   their own linked doctor. Requesting another doctor's id is forbidden.
 *   This closes an intra-tenant IDOR where one doctor could read another
 *   doctor's revenue / appointments / patient names by passing their id.
 */
async function resolveScopedDoctorId(
  req: Request,
  requestedDoctorId?: string
): Promise<{ allowed: true; doctorId?: string } | { allowed: false; message: string }> {
  const role = req.user!.role
  if (ADMIN_STATS_ROLES.includes(role)) {
    return { allowed: true, doctorId: requestedDoctorId }
  }

  // Non-admin with no specific doctor requested → tenant-wide (unchanged).
  if (!requestedDoctorId) {
    return { allowed: true, doctorId: undefined }
  }

  // Non-admin requesting a specific doctor → must be their own linked doctor.
  const tenantId = req.user!.tenantId
  const userId = req.user!.profileUserId || req.user!.userId
  const ownDoctorId = await getLinkedDoctorId(userId, tenantId)
  if (!ownDoctorId || requestedDoctorId !== ownDoctorId) {
    return { allowed: false, message: 'You can only view your own statistics' }
  }
  return { allowed: true, doctorId: ownDoctorId }
}

// ============================================================================
// Routes
// ============================================================================

/**
 * GET /api/stats/my-doctor-id
 * Resolve the current user's linked doctorId
 */
statsRouter.get('/my-doctor-id', async (req, res, next) => {
  try {
    const tenantId = req.user!.tenantId
    const userId = req.user!.profileUserId || req.user!.userId

    const doctorId = await getLinkedDoctorId(userId, tenantId)

    res.json({
      success: true,
      data: { doctorId },
    })
  } catch (error) {
    next(error)
  }
})

/**
 * GET /api/stats/overview
 * Get dashboard overview statistics
 * Query params: doctorId (optional, scopes stats to a specific doctor)
 */
statsRouter.get('/overview', async (req, res, next) => {
  try {
    const tenantId = req.user!.tenantId
    const requestedDoctorId = typeof req.query.doctorId === 'string' ? req.query.doctorId : undefined

    const scope = await resolveScopedDoctorId(req, requestedDoctorId)
    if (!scope.allowed) {
      return res.status(403).json({ success: false, error: { message: scope.message } })
    }

    const stats = await getOverviewStats(tenantId, scope.doctorId)

    res.json({
      success: true,
      data: stats,
    })
  } catch (error) {
    next(error)
  }
})

/**
 * GET /api/stats/appointments
 * Get appointment statistics for a period
 * Query params: startDate, endDate (ISO format), doctorId (optional)
 */
statsRouter.get('/appointments', async (req, res, next) => {
  try {
    const tenantId = req.user!.tenantId

    const parseResult = dateRangeSchema.safeParse(req.query)
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        error: { message: 'Invalid query parameters', details: parseResult.error.errors },
      })
    }

    // Default to current month
    const now = new Date()
    const startDate = parseResult.data.startDate
      ? new Date(parseResult.data.startDate)
      : new Date(now.getFullYear(), now.getMonth(), 1)
    const endDate = parseResult.data.endDate
      ? new Date(parseResult.data.endDate)
      : new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)

    // Validate date range
    if (startDate > endDate) {
      return res.status(400).json({
        success: false,
        error: { message: 'startDate must be before or equal to endDate' },
      })
    }

    const scope = await resolveScopedDoctorId(req, parseResult.data.doctorId)
    if (!scope.allowed) {
      return res.status(403).json({ success: false, error: { message: scope.message } })
    }

    const stats = await getAppointmentStatsForPeriod(tenantId, startDate, endDate, scope.doctorId)

    res.json({
      success: true,
      data: stats,
    })
  } catch (error) {
    next(error)
  }
})

/**
 * GET /api/stats/revenue
 * Get revenue statistics
 * Query params: months (default 6, max 24), doctorId (optional)
 */
statsRouter.get('/revenue', async (req, res, next) => {
  try {
    const tenantId = req.user!.tenantId

    const parseResult = monthsBackSchema.safeParse(req.query)
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        error: { message: 'Invalid query parameters', details: parseResult.error.errors },
      })
    }

    const monthsBack = parseResult.data.months ?? 6

    const scope = await resolveScopedDoctorId(req, parseResult.data.doctorId)
    if (!scope.allowed) {
      return res.status(403).json({ success: false, error: { message: scope.message } })
    }

    const stats = await getRevenueStats(tenantId, monthsBack, scope.doctorId)

    res.json({
      success: true,
      data: stats,
    })
  } catch (error) {
    next(error)
  }
})

/**
 * GET /api/stats/patients-growth
 * Get patients growth statistics
 * Query params: months (number of months back, default 6, max 24)
 */
statsRouter.get('/patients-growth', async (req, res, next) => {
  try {
    const tenantId = req.user!.tenantId

    const parseResult = monthsBackSchema.safeParse(req.query)
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        error: { message: 'Invalid query parameters', details: parseResult.error.errors },
      })
    }

    const monthsBack = parseResult.data.months ?? 6

    const stats = await getPatientsGrowthStats(tenantId, monthsBack)

    res.json({
      success: true,
      data: stats,
    })
  } catch (error) {
    next(error)
  }
})

/**
 * GET /api/stats/doctors-performance
 * Get doctor performance statistics (including commission earned), defaulting
 * to the current month. Query params: startDate, endDate (ISO, optional).
 * Access: CLINIC_ADMIN and above
 */
statsRouter.get('/doctors-performance', requireMinRole('CLINIC_ADMIN'), async (req, res, next) => {
  try {
    const tenantId = req.user!.tenantId

    const parseResult = dateRangeSchema.safeParse(req.query)
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        error: { message: 'Invalid query parameters', details: parseResult.error.errors },
      })
    }

    const startDate = parseResult.data.startDate ? new Date(parseResult.data.startDate) : undefined
    const endDate = parseResult.data.endDate ? new Date(parseResult.data.endDate) : undefined

    const stats = await getDoctorPerformanceStats(tenantId, startDate, endDate)

    res.json({
      success: true,
      data: stats,
    })
  } catch (error) {
    next(error)
  }
})

/**
 * GET /api/stats/upcoming
 * Get upcoming appointments for a doctor
 * Query params: doctorId (required), limit (optional, default 10)
 */
statsRouter.get('/upcoming', async (req, res, next) => {
  try {
    const tenantId = req.user!.tenantId
    const requestedDoctorId = typeof req.query.doctorId === 'string' ? req.query.doctorId : undefined
    const limit = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : 10

    const scope = await resolveScopedDoctorId(req, requestedDoctorId)
    if (!scope.allowed) {
      return res.status(403).json({ success: false, error: { message: scope.message } })
    }
    if (!scope.doctorId) {
      return res.status(400).json({
        success: false,
        error: { message: 'doctorId query parameter is required' },
      })
    }

    const data = await getUpcomingAppointments(tenantId, scope.doctorId, Math.min(limit, 50))

    res.json({ success: true, data })
  } catch (error) {
    next(error)
  }
})

/**
 * GET /api/stats/appointment-types
 * Get appointment type distribution for a doctor (current month)
 * Query params: doctorId (required)
 */
statsRouter.get('/appointment-types', async (req, res, next) => {
  try {
    const tenantId = req.user!.tenantId
    const requestedDoctorId = typeof req.query.doctorId === 'string' ? req.query.doctorId : undefined

    const scope = await resolveScopedDoctorId(req, requestedDoctorId)
    if (!scope.allowed) {
      return res.status(403).json({ success: false, error: { message: scope.message } })
    }
    if (!scope.doctorId) {
      return res.status(400).json({
        success: false,
        error: { message: 'doctorId query parameter is required' },
      })
    }

    const data = await getAppointmentTypeStats(tenantId, scope.doctorId)

    res.json({ success: true, data })
  } catch (error) {
    next(error)
  }
})

export { statsRouter }
