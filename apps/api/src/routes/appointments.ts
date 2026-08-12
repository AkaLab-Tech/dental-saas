import { Router, type IRouter } from 'express'
import { z } from 'zod'
import React from 'react'
import { AppointmentStatus } from '@dental/database'
import { requireMinRole } from '../middleware/auth.js'
import { requireOwnership } from '../middleware/ownership.js'
import { hasPermission, Permission } from '../middleware/permissions.js'
import type { UserRole } from '@dental/shared'
import {
  listAppointments,
  getAppointmentById,
  createAppointment,
  updateAppointment,
  deleteAppointment,
  restoreAppointment,
  markAppointmentDone,
  getCalendarAppointments,
  getAppointmentStats,
  getAppointmentsByDoctor,
  getAppointmentsByPatient,
} from '../services/appointment.service.js'
import {
  setAppointmentBudgetItems,
  confirmExecutedBudgetItems,
  validateExecutableBudgetItems,
  getAppointmentBudgetItems,
  type BudgetAppointmentErrorCode,
} from '../services/budget-appointment.service.js'
import { PdfService } from '../services/pdf.service.js'
import { AppointmentReceiptPdf } from '../pdfs/AppointmentReceiptPdf.js'

const appointmentsRouter: IRouter = Router()

// ============================================================================
// Validation Schemas
// ============================================================================

const appointmentStatusSchema = z.enum([
  'SCHEDULED',
  'CONFIRMED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
  'RESCHEDULED',
])

// Date validation: accept ISO date string
const dateTimeSchema = z
  .string()
  .datetime({ message: 'Invalid datetime format. Use ISO 8601 format.' })
  .transform((val) => new Date(val))

// Cost validation: must be non-negative if provided (0 for free appointments)
const costSchema = z
  .number()
  .min(0, { message: 'Cost cannot be negative' })
  .optional()

const createAppointmentSchema = z.object({
  patientId: z.string().min(1, 'Patient ID is required'),
  doctorId: z.string().min(1, 'Doctor ID is required'),
  startTime: dateTimeSchema,
  endTime: dateTimeSchema,
  duration: z.number().int().positive().optional(),
  status: appointmentStatusSchema.optional(),
  type: z.string().max(100).optional(),
  notes: z.string().max(5000).optional(),
  privateNotes: z.string().max(5000).optional(),
  cost: costSchema,
  // Amount the patient pays that day for this appointment; kept separate from
  // Entregas (advance payments). isPaid is accepted for backward compatibility
  // and interpreted as paidAmount = cost.
  paidAmount: costSchema,
  isPaid: z.boolean().optional(),
  // Replace-set of associated budget items (SCHEDULED). Omit to leave associations untouched.
  budgetItemIds: z.array(z.string()).optional(),
})

const updateAppointmentSchema = z.object({
  patientId: z.string().min(1).optional(),
  doctorId: z.string().min(1).optional(),
  startTime: dateTimeSchema.optional(),
  endTime: dateTimeSchema.optional(),
  duration: z.number().int().positive().optional(),
  status: appointmentStatusSchema.optional(),
  type: z.string().max(100).optional().nullable(),
  notes: z.string().max(5000).optional().nullable(),
  privateNotes: z.string().max(5000).optional().nullable(),
  cost: costSchema,
  paidAmount: costSchema,
  isPaid: z.boolean().optional(),
  // Replace-set of associated budget items (SCHEDULED). Omit to leave associations untouched.
  budgetItemIds: z.array(z.string()).optional(),
})

const markDoneSchema = z.object({
  notes: z.string().max(5000).optional(),
  // Subset of currently SCHEDULED-linked items to confirm as executed. Omit/empty = confirm none.
  executedBudgetItemIds: z.array(z.string()).optional(),
})

// ============================================================================
// Helper Functions
// ============================================================================

function mapErrorCodeToStatus(code: string): number {
  switch (code) {
    case 'NOT_FOUND':
    case 'APPOINTMENT_NOT_FOUND':
    case 'ITEM_NOT_FOUND':
      return 404
    case 'INVALID_PATIENT':
    case 'INVALID_DOCTOR':
    case 'INVALID_TIME_RANGE':
      return 400
    case 'TIME_CONFLICT':
      return 409
    case 'ALREADY_INACTIVE':
    case 'ALREADY_ACTIVE':
    case 'CANNOT_UNMARK_PAID':
    case 'EXCEEDS_BALANCE':
    case 'PAYMENT_FAILED':
    case 'ITEM_NOT_ELIGIBLE':
    case 'ITEM_NOT_ASSOCIATED':
      return 400
    default:
      return 400
  }
}

/**
 * Budget-item association/confirmation is gated on BUDGETS_UPDATE, layered
 * on top of the route's existing role gate — only enforced when the caller
 * actually attempts to touch budget-item links.
 */
function canManageBudgetItems(role: string): boolean {
  return hasPermission(role as UserRole, Permission.BUDGETS_UPDATE)
}

function sendBudgetItemsError(
  res: import('express').Response,
  code: BudgetAppointmentErrorCode
): void {
  const status = mapErrorCodeToStatus(code)
  res.status(status).json({ success: false, error: { code, message: code } })
}

// ============================================================================
// Routes
// ============================================================================

/**
 * GET /api/appointments
 * List all appointments with optional filters
 * Requires: STAFF role or higher
 */
appointmentsRouter.get('/', requireMinRole('STAFF'), async (req, res, next) => {
  try {
    const tenantId = req.user!.tenantId
    const { limit, offset, doctorId, patientId, status, from, to, includeInactive } = req.query

    // Validate status if provided
    const validStatuses = ['SCHEDULED', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW', 'RESCHEDULED']
    if (status && !validStatuses.includes(String(status))) {
      res.status(400).json({ success: false, error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` })
      return
    }

    // Validate date formats if provided
    if (from && isNaN(new Date(String(from)).getTime())) {
      res.status(400).json({ success: false, error: 'Invalid from date format' })
      return
    }
    if (to && isNaN(new Date(String(to)).getTime())) {
      res.status(400).json({ success: false, error: 'Invalid to date format' })
      return
    }

    const appointments = await listAppointments(tenantId, {
      limit: limit ? Math.min(parseInt(String(limit), 10), 100) : undefined,
      offset: offset ? parseInt(String(offset), 10) : undefined,
      doctorId: doctorId ? String(doctorId) : undefined,
      patientId: patientId ? String(patientId) : undefined,
      status: status ? (String(status) as AppointmentStatus) : undefined,
      from: from ? new Date(String(from)) : undefined,
      to: to ? new Date(String(to)) : undefined,
      includeInactive: includeInactive === 'true',
    })

    res.json({ success: true, data: appointments })
  } catch (e) {
    next(e)
  }
})

/**
 * GET /api/appointments/calendar
 * Get appointments for calendar view (optimized for date ranges)
 * Requires: STAFF role or higher
 */
appointmentsRouter.get('/calendar', requireMinRole('STAFF'), async (req, res, next) => {
  try {
    const tenantId = req.user!.tenantId
    const { from, to, doctorId, patientId } = req.query

    if (!from || !to) {
      return res.status(400).json({
        success: false,
        error: { message: 'Both from and to dates are required', code: 'INVALID_DATE_RANGE' },
      })
    }

    const appointments = await getCalendarAppointments(tenantId, {
      from: new Date(String(from)),
      to: new Date(String(to)),
      doctorId: doctorId ? String(doctorId) : undefined,
      patientId: patientId ? String(patientId) : undefined,
    })

    res.json({ success: true, data: appointments })
  } catch (e) {
    next(e)
  }
})

/**
 * GET /api/appointments/stats
 * Get appointment statistics
 * Requires: STAFF role or higher
 */
appointmentsRouter.get('/stats', requireMinRole('STAFF'), async (req, res, next) => {
  try {
    const tenantId = req.user!.tenantId
    const { from, to, doctorId } = req.query

    const stats = await getAppointmentStats(tenantId, {
      from: from ? new Date(String(from)) : undefined,
      to: to ? new Date(String(to)) : undefined,
      doctorId: doctorId ? String(doctorId) : undefined,
    })

    res.json({ success: true, data: stats })
  } catch (e) {
    next(e)
  }
})

/**
 * GET /api/appointments/by-doctor/:doctorId
 * Get appointments for a specific doctor
 * Requires: STAFF role or higher
 */
appointmentsRouter.get('/by-doctor/:doctorId', requireMinRole('STAFF'), async (req, res, next) => {
  try {
    const tenantId = req.user!.tenantId
    const { doctorId } = req.params
    const { from, to, limit, includeInactive } = req.query

    const appointments = await getAppointmentsByDoctor(tenantId, doctorId, {
      from: from ? new Date(String(from)) : undefined,
      to: to ? new Date(String(to)) : undefined,
      limit: limit ? parseInt(String(limit), 10) : undefined,
      includeInactive: includeInactive === 'true',
    })

    res.json({ success: true, data: appointments })
  } catch (e) {
    next(e)
  }
})

/**
 * GET /api/appointments/by-patient/:patientId
 * Get appointments for a specific patient
 * Requires: STAFF role or higher
 */
appointmentsRouter.get('/by-patient/:patientId', requireMinRole('STAFF'), async (req, res, next) => {
  try {
    const tenantId = req.user!.tenantId
    const { patientId } = req.params
    const { limit, includeInactive } = req.query

    const appointments = await getAppointmentsByPatient(tenantId, patientId, {
      limit: limit ? parseInt(String(limit), 10) : undefined,
      includeInactive: includeInactive === 'true',
    })

    res.json({ success: true, data: appointments })
  } catch (e) {
    next(e)
  }
})

/**
 * GET /api/appointments/:id
 * Get a single appointment by ID
 * Requires: STAFF role or higher
 */
appointmentsRouter.get('/:id', requireMinRole('STAFF'), async (req, res, next) => {
  try {
    const tenantId = req.user!.tenantId
    const { id } = req.params

    const appointment = await getAppointmentById(tenantId, id)

    if (!appointment) {
      return res.status(404).json({
        success: false,
        error: { message: 'Appointment not found', code: 'NOT_FOUND' },
      })
    }

    res.json({ success: true, data: appointment })
  } catch (e) {
    next(e)
  }
})

/**
 * GET /api/appointments/:id/budget-items
 * List the budget items currently associated to an appointment (any role),
 * for edit/completion hydration.
 * Requires: STAFF role or higher
 */
appointmentsRouter.get('/:id/budget-items', requireMinRole('STAFF'), async (req, res, next) => {
  try {
    const tenantId = req.user!.tenantId
    const { id } = req.params

    const result = await getAppointmentBudgetItems(tenantId, id)
    if (!result.success) return sendBudgetItemsError(res, result.code)

    res.json({ success: true, data: result.data })
  } catch (e) {
    next(e)
  }
})

/**
 * POST /api/appointments
 * Create a new appointment
 * Requires: ADMIN role or higher
 */
appointmentsRouter.post('/', requireMinRole('CLINIC_ADMIN'), async (req, res, next) => {
  try {
    const tenantId = req.user!.tenantId
    const parse = createAppointmentSchema.safeParse(req.body)

    if (!parse.success) {
      return res.status(400).json({
        success: false,
        error: {
          message: 'Invalid payload',
          code: 'INVALID_PAYLOAD',
          details: parse.error.errors,
        },
      })
    }

    const { budgetItemIds, ...appointmentData } = parse.data

    if (budgetItemIds !== undefined && !canManageBudgetItems(req.user!.role)) {
      return res.status(403).json({
        success: false,
        error: { message: 'Insufficient permissions to manage budget items', code: 'FORBIDDEN' },
      })
    }

    const userId = req.user!.profileUserId || req.user!.userId

    const result = await createAppointment(tenantId, {
      ...appointmentData,
      createdBy: userId,
    })

    if (result.error) {
      const status = mapErrorCodeToStatus(result.error.code)
      return res.status(status).json({
        success: false,
        error: result.error,
      })
    }

    if (budgetItemIds !== undefined) {
      const linkResult = await setAppointmentBudgetItems(
        tenantId,
        result.appointment!.id,
        budgetItemIds,
        userId
      )
      if (!linkResult.success) return sendBudgetItemsError(res, linkResult.code)
    }

    res.status(201).json({ success: true, data: result.appointment })
  } catch (e) {
    next(e)
  }
})

/**
 * PUT /api/appointments/:id
 * Update an existing appointment
 * Requires: ADMIN role or higher
 */
appointmentsRouter.put('/:id', requireMinRole('DOCTOR'), requireOwnership('appointment'), async (req, res, next) => {
  try {
    const tenantId = req.user!.tenantId
    const { id } = req.params

    // Prevent changing immutable fields
    const forbidden = ['id', 'tenantId', 'createdAt']
    const attempted = forbidden.filter((f) => Object.prototype.hasOwnProperty.call(req.body, f))
    if (attempted.length > 0) {
      return res.status(400).json({
        success: false,
        error: {
          message: 'Attempt to modify immutable fields',
          code: 'IMMUTABLE_FIELDS',
          fields: attempted,
        },
      })
    }

    const parse = updateAppointmentSchema.safeParse(req.body)

    if (!parse.success) {
      return res.status(400).json({
        success: false,
        error: {
          message: 'Invalid payload',
          code: 'INVALID_PAYLOAD',
          details: parse.error.errors,
        },
      })
    }

    const { budgetItemIds, ...appointmentData } = parse.data

    if (budgetItemIds !== undefined && !canManageBudgetItems(req.user!.role)) {
      return res.status(403).json({
        success: false,
        error: { message: 'Insufficient permissions to manage budget items', code: 'FORBIDDEN' },
      })
    }

    const result = await updateAppointment(tenantId, id, appointmentData)

    if (result.error) {
      const status = mapErrorCodeToStatus(result.error.code)
      return res.status(status).json({
        success: false,
        error: result.error,
      })
    }

    const userId = req.user!.profileUserId || req.user!.userId

    if (budgetItemIds !== undefined) {
      const linkResult = await setAppointmentBudgetItems(tenantId, id, budgetItemIds, userId)
      if (!linkResult.success) return sendBudgetItemsError(res, linkResult.code)
    }

    // Cancelling must not leave budget items stuck SCHEDULED forever — release
    // them back to PENDING (an EXECUTED item is never un-executed by this).
    if (appointmentData.status === 'CANCELLED') {
      const releaseResult = await setAppointmentBudgetItems(tenantId, id, [], userId)
      if (!releaseResult.success) return sendBudgetItemsError(res, releaseResult.code)
    }

    res.json({ success: true, data: result.appointment })
  } catch (e) {
    next(e)
  }
})

/**
 * PUT /api/appointments/:id/mark-done
 * Mark an appointment as completed
 * Requires: ADMIN role or higher
 */
appointmentsRouter.put('/:id/mark-done', requireMinRole('CLINIC_ADMIN'), async (req, res, next) => {
  try {
    const tenantId = req.user!.tenantId
    const { id } = req.params

    const parse = markDoneSchema.safeParse(req.body)

    if (!parse.success) {
      return res.status(400).json({
        success: false,
        error: {
          message: 'Invalid payload',
          code: 'INVALID_PAYLOAD',
          details: parse.error.errors,
        },
      })
    }

    const { executedBudgetItemIds } = parse.data

    if (
      executedBudgetItemIds !== undefined &&
      executedBudgetItemIds.length > 0 &&
      !canManageBudgetItems(req.user!.role)
    ) {
      return res.status(403).json({
        success: false,
        error: { message: 'Insufficient permissions to manage budget items', code: 'FORBIDDEN' },
      })
    }

    // Validate the executed-items confirmation up front (no writes) so a
    // rejected id (e.g. ITEM_NOT_ASSOCIATED) never leaves the appointment
    // marked done while the confirmation itself fails.
    if (executedBudgetItemIds !== undefined && executedBudgetItemIds.length > 0) {
      const validation = await validateExecutableBudgetItems(tenantId, id, executedBudgetItemIds)
      if (!validation.success) return sendBudgetItemsError(res, validation.code)
    }

    const result = await markAppointmentDone(tenantId, id, parse.data.notes)

    if (result.error) {
      const status = mapErrorCodeToStatus(result.error.code)
      return res.status(status).json({
        success: false,
        error: result.error,
      })
    }

    if (executedBudgetItemIds !== undefined && executedBudgetItemIds.length > 0) {
      const userId = req.user!.profileUserId || req.user!.userId
      const confirmResult = await confirmExecutedBudgetItems(
        tenantId,
        id,
        executedBudgetItemIds,
        userId
      )
      if (!confirmResult.success) return sendBudgetItemsError(res, confirmResult.code)
    }

    res.json({ success: true, data: result.appointment })
  } catch (e) {
    next(e)
  }
})

/**
 * PUT /api/appointments/:id/restore
 * Restore a soft-deleted appointment
 * Requires: ADMIN role or higher
 */
appointmentsRouter.put('/:id/restore', requireMinRole('CLINIC_ADMIN'), async (req, res, next) => {
  try {
    const tenantId = req.user!.tenantId
    const { id } = req.params

    const result = await restoreAppointment(tenantId, id)

    if (result.error) {
      const status = mapErrorCodeToStatus(result.error.code)
      return res.status(status).json({
        success: false,
        error: result.error,
      })
    }

    res.json({ success: true, data: result.appointment })
  } catch (e) {
    next(e)
  }
})

/**
 * GET /api/appointments/:id/pdf
 * Download appointment receipt as PDF
 * Requires: STAFF role or higher
 */
appointmentsRouter.get('/:id/pdf', requireMinRole('STAFF'), async (req, res, next) => {
  try {
    const tenantId = req.user!.tenantId
    const { id } = req.params

    const result = await PdfService.getAppointmentReceiptData(tenantId, id)

    if ('error' in result) {
      const status = result.error === 'NOT_FOUND' ? 404 : 400
      return res.status(status).json({
        success: false,
        error: { code: result.error, message: result.message },
      })
    }

    const pdfBuffer = await PdfService.generatePdf(
      React.createElement(AppointmentReceiptPdf, { data: result.data })
    )

    const filename = `appointment-receipt-${id}.pdf`
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    res.setHeader('Content-Length', pdfBuffer.length)
    res.send(pdfBuffer)
  } catch (e) {
    next(e)
  }
})

/**
 * DELETE /api/appointments/:id
 * Soft delete an appointment
 * Requires: ADMIN role or higher
 */
appointmentsRouter.delete('/:id', requireMinRole('DOCTOR'), requireOwnership('appointment'), async (req, res, next) => {
  try {
    const tenantId = req.user!.tenantId
    const { id } = req.params

    const result = await deleteAppointment(tenantId, id)

    if (result.error) {
      const status = mapErrorCodeToStatus(result.error.code)
      return res.status(status).json({
        success: false,
        error: result.error,
      })
    }

    // Soft-deleting must not leave budget items stuck SCHEDULED forever —
    // release them back to PENDING (an EXECUTED item is never un-executed by this).
    const userId = req.user!.profileUserId || req.user!.userId
    const releaseResult = await setAppointmentBudgetItems(tenantId, id, [], userId)
    if (!releaseResult.success) return sendBudgetItemsError(res, releaseResult.code)

    res.json({ success: true, data: result.appointment })
  } catch (e) {
    next(e)
  }
})

export { appointmentsRouter }
