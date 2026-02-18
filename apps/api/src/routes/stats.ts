import { Router, type IRouter } from 'express'
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
    const doctorId = typeof req.query.doctorId === 'string' ? req.query.doctorId : undefined

    const stats = await getOverviewStats(tenantId, doctorId)

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

    const stats = await getAppointmentStatsForPeriod(tenantId, startDate, endDate, parseResult.data.doctorId)

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

    const stats = await getRevenueStats(tenantId, monthsBack, parseResult.data.doctorId)

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
 * Get doctor performance statistics for current month
 * Access: CLINIC_ADMIN and above
 */
statsRouter.get('/doctors-performance', requireMinRole('CLINIC_ADMIN'), async (req, res, next) => {
  try {
    const tenantId = req.user!.tenantId

    const stats = await getDoctorPerformanceStats(tenantId)

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
    const doctorId = typeof req.query.doctorId === 'string' ? req.query.doctorId : undefined
    const limit = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : 10

    if (!doctorId) {
      return res.status(400).json({
        success: false,
        error: { message: 'doctorId query parameter is required' },
      })
    }

    const data = await getUpcomingAppointments(tenantId, doctorId, Math.min(limit, 50))

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
    const doctorId = typeof req.query.doctorId === 'string' ? req.query.doctorId : undefined

    if (!doctorId) {
      return res.status(400).json({
        success: false,
        error: { message: 'doctorId query parameter is required' },
      })
    }

    const data = await getAppointmentTypeStats(tenantId, doctorId)

    res.json({ success: true, data })
  } catch (error) {
    next(error)
  }
})

export { statsRouter }
