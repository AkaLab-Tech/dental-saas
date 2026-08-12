import { Router, type IRouter } from 'express'
import { z } from 'zod'
import React from 'react'
import { type TeethData } from '@dental/shared'
import { requireMinRole } from '../middleware/auth.js'
import { requireOwnership } from '../middleware/ownership.js'
import {
  listPatients,
  getPatientById,
  createPatient,
  updatePatient,
  deletePatient,
  restorePatient,
  checkPatientLimit,
  getPatientStats,
  getPatientAppointments,
  updatePatientTeeth,
  getPatientTeeth,
  updatePatientShowPrimaryTeeth,
} from '../services/patient.service.js'
import { PdfService } from '../services/pdf.service.js'
import { PatientHistoryPdf, sanitizeFilename } from '../pdfs/index.js'
import {
  createPayment,
  listPayments,
  deletePayment,
  getPatientBalance,
  getPatientAccountStatement,
  listDebtors,
} from '../services/payment.service.js'
import { createBudget, listBudgetsByPatient } from '../services/budget.service.js'
import { createBudgetSchema } from './budgets.js'
import { requirePermission } from '../middleware/permissions.js'
import { Permission } from '@dental/shared'

const patientsRouter: IRouter = Router()

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
      error: { message: 'A patient with this email already exists', code: 'DUPLICATE_EMAIL' },
    })
    return true
  }

  // Generic duplicate error
  res.status(409).json({
    success: false,
    error: { message: 'A patient with these values already exists', code: 'DUPLICATE_ENTRY' },
  })
  return true
}

// ============================================================================
// Validation Schemas
// ============================================================================

// Phone validation: normalize empty strings to undefined
const phoneSchema = z
  .string()
  .optional()
  .nullable()
  .transform((val) => (val === '' ? undefined : val))

// Date of birth validation: accept ISO date string, must not be in the future
const dobSchema = z
  .string()
  .optional()
  .nullable()
  .refine(
    (val) => {
      if (!val) return true
      const date = new Date(val)
      return !isNaN(date.getTime())
    },
    { message: 'Invalid date format' }
  )
  .refine(
    (val) => {
      if (!val) return true
      const date = new Date(val)
      if (isNaN(date.getTime())) return false
      return date.getTime() <= Date.now()
    },
    { message: 'Date of birth cannot be in the future' }
  )

// Gender validation
const genderSchema = z
  .enum(['male', 'female', 'other', 'prefer_not_to_say'])
  .optional()
  .nullable()

// Query params validation for list endpoint
const listPatientsQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).optional(),
  offset: z.coerce.number().int().nonnegative().optional(),
  includeInactive: z.enum(['true', 'false']).optional(),
  search: z.string().optional(),
})

// Create patient schema
const createPatientSchema = z.object({
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().min(1, 'Last name is required'),
  email: z.string().email().optional(),
  phone: phoneSchema,
  dob: dobSchema,
  gender: genderSchema,
  address: z.string().max(500, 'Address cannot exceed 500 characters').optional(),
})

// Update patient schema (all fields optional)
const updatePatientSchema = z.object({
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  email: z.string().email().optional().nullable(),
  phone: phoneSchema,
  dob: dobSchema,
  gender: genderSchema,
  address: z.string().max(500, 'Address cannot exceed 500 characters').optional().nullable(),
})

// ============================================================================
// Routes
// ============================================================================

/**
 * GET /api/patients
 * List all patients for the tenant (STAFF+ required)
 */
patientsRouter.get('/', requireMinRole('STAFF'), async (req, res, next) => {
  try {
    const tenantId = req.user!.tenantId

    const parsedQuery = listPatientsQuerySchema.safeParse(req.query)
    if (!parsedQuery.success) {
      return res.status(400).json({
        success: false,
        error: { message: 'Invalid query parameters', code: 'INVALID_QUERY', details: parsedQuery.error.errors },
      })
    }

    const { limit, offset, includeInactive, search } = parsedQuery.data

    const patients = await listPatients(tenantId, {
      limit,
      offset,
      includeInactive: includeInactive === 'true',
      search,
    })

    res.json({
      success: true,
      data: patients,
    })
  } catch (e) {
    next(e)
  }
})

/**
 * GET /api/patients/stats
 * Get patient counts and plan limits (ADMIN+ required)
 */
patientsRouter.get('/stats', requireMinRole('CLINIC_ADMIN'), async (req, res, next) => {
  try {
    const tenantId = req.user!.tenantId

    const stats = await getPatientStats(tenantId)

    res.json({
      success: true,
      data: stats,
    })
  } catch (e) {
    next(e)
  }
})

/**
 * GET /api/patients/debts
 * List all patients with an outstanding balance for the tenant (sorted desc)
 */
patientsRouter.get('/debts', requirePermission(Permission.PAYMENTS_VIEW), async (req, res, next) => {
  try {
    const tenantId = req.user!.tenantId!

    const debtors = await listDebtors(tenantId)

    res.json({ success: true, data: debtors })
  } catch (e) {
    next(e)
  }
})

/**
 * GET /api/patients/:id
 * Get a single patient by ID (STAFF+ required)
 */
patientsRouter.get('/:id', requireMinRole('STAFF'), async (req, res, next) => {
  try {
    const tenantId = req.user!.tenantId
    const { id } = req.params

    const patient = await getPatientById(tenantId, id)

    if (!patient) {
      return res.status(404).json({
        success: false,
        error: { message: 'Patient not found', code: 'NOT_FOUND' },
      })
    }

    res.json({
      success: true,
      data: patient,
    })
  } catch (e) {
    next(e)
  }
})

/**
 * GET /api/patients/:id/appointments
 * Get appointments for a patient (STAFF+ required)
 */
patientsRouter.get('/:id/appointments', requireMinRole('STAFF'), async (req, res, next) => {
  try {
    const tenantId = req.user!.tenantId
    const { id } = req.params

    const { limit, offset } = req.query
    const parsedLimit = limit ? Math.min(parseInt(String(limit), 10) || 20, 100) : 20
    const parsedOffset = offset ? Math.max(parseInt(String(offset), 10) || 0, 0) : 0

    const appointments = await getPatientAppointments(tenantId, id, {
      limit: parsedLimit,
      offset: parsedOffset,
    })

    if (appointments === null) {
      return res.status(404).json({
        success: false,
        error: { message: 'Patient not found', code: 'NOT_FOUND' },
      })
    }

    res.json({
      success: true,
      data: appointments,
    })
  } catch (e) {
    next(e)
  }
})

/**
 * POST /api/patients
 * Create a new patient (ADMIN+ required)
 */
patientsRouter.post('/', requireMinRole('CLINIC_ADMIN'), async (req, res, next) => {
  try {
    const tenantId = req.user!.tenantId

    // Check plan limits first
    const limitCheck = await checkPatientLimit(tenantId)
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
    const parsed = createPatientSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: { message: 'Invalid request body', code: 'VALIDATION_ERROR', details: parsed.error.errors },
      })
    }

    // Transform null/undefined phone to undefined for create
    const createData = {
      ...parsed.data,
      phone: parsed.data.phone ?? undefined,
      dob: parsed.data.dob ?? undefined,
      gender: parsed.data.gender ?? undefined,
    }

    const patient = await createPatient(tenantId, {
      ...createData,
      createdBy: req.user!.profileUserId || req.user!.userId,
    })

    res.status(201).json({
      success: true,
      data: patient,
    })
  } catch (e) {
    if (handlePrismaUniqueError(e, res)) {
      return
    }
    next(e)
  }
})

/**
 * PUT /api/patients/:id
 * Update a patient (ADMIN+ required)
 */
patientsRouter.put('/:id', requireMinRole('DOCTOR'), requireOwnership('patient'), async (req, res, next) => {
  try {
    const tenantId = req.user!.tenantId
    const { id } = req.params

    // Validate request body
    const parsed = updatePatientSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: { message: 'Invalid request body', code: 'VALIDATION_ERROR', details: parsed.error.errors },
      })
    }

    const patient = await updatePatient(tenantId, id, parsed.data)

    if (!patient) {
      return res.status(404).json({
        success: false,
        error: { message: 'Patient not found', code: 'NOT_FOUND' },
      })
    }

    res.json({
      success: true,
      data: patient,
    })
  } catch (e) {
    if (handlePrismaUniqueError(e, res)) {
      return
    }
    next(e)
  }
})

/**
 * DELETE /api/patients/:id
 * Soft delete a patient (ADMIN+ required)
 */
patientsRouter.delete('/:id', requireMinRole('DOCTOR'), requireOwnership('patient'), async (req, res, next) => {
  try {
    const tenantId = req.user!.tenantId
    const { id } = req.params

    const result = await deletePatient(tenantId, id)

    if (!result.success) {
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
      message: 'Patient deleted successfully',
    })
  } catch (e) {
    next(e)
  }
})

// ============================================================================
// Dental Chart (Teeth) Routes
// ============================================================================

// Teeth update schema - object with tooth numbers as keys and ToothData as values
const toothDataSchema = z.object({
  note: z.string().max(1000, 'Note cannot exceed 1000 characters'),
  status: z.string().refine(
    (val): val is string => [
      'healthy', 'caries', 'filled', 'crown', 'root_canal',
      'missing', 'extracted', 'implant', 'bridge',
    ].includes(val),
    { message: 'Invalid tooth status' }
  ),
})

const teethUpdateSchema = z.record(
  z.string().regex(/^\d{2}$/, 'Invalid tooth number format'),
  toothDataSchema
)

/**
 * GET /api/patients/:id/teeth
 * Get dental chart (teeth notes) for a patient (STAFF+ required)
 */
patientsRouter.get('/:id/teeth', requireMinRole('STAFF'), async (req, res, next) => {
  try {
    const tenantId = req.user!.tenantId
    const { id } = req.params

    const result = await getPatientTeeth(tenantId, id)

    if (!result.success) {
      return res.status(404).json({
        success: false,
        error: { message: result.error, code: result.errorCode },
      })
    }

    res.json({
      success: true,
      data: result.teeth,
    })
  } catch (e) {
    next(e)
  }
})

/**
 * PATCH /api/patients/:id/teeth
 * Update dental chart (teeth notes) for a patient (STAFF+ required)
 * Merges with existing data. Empty string removes the note.
 */
patientsRouter.patch('/:id/teeth', requireMinRole('STAFF'), async (req, res, next) => {
  try {
    const tenantId = req.user!.tenantId
    const { id } = req.params

    // Validate request body
    const parsed = teethUpdateSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: { message: 'Invalid teeth data', code: 'INVALID_DATA', details: parsed.error.errors },
      })
    }

    const result = await updatePatientTeeth(tenantId, id, parsed.data as TeethData)

    if (!result.success) {
      const statusCode = result.errorCode === 'NOT_FOUND' ? 404 : 400
      return res.status(statusCode).json({
        success: false,
        error: { message: result.error, code: result.errorCode },
      })
    }

    res.json({
      success: true,
      data: result.patient,
    })
  } catch (e) {
    next(e)
  }
})

/**
 * PATCH /api/patients/:id/show-primary-teeth
 * Toggle the showPrimaryTeeth flag for a patient (STAFF+ required).
 * Lightweight endpoint for the odontogram UI toggle.
 */
const showPrimaryTeethSchema = z.object({
  showPrimaryTeeth: z.boolean(),
})

patientsRouter.patch('/:id/show-primary-teeth', requireMinRole('STAFF'), async (req, res, next) => {
  try {
    const tenantId = req.user!.tenantId
    const { id } = req.params

    const parsed = showPrimaryTeethSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: { message: 'Invalid payload', code: 'INVALID_DATA', details: parsed.error.errors },
      })
    }

    const result = await updatePatientShowPrimaryTeeth(tenantId, id, parsed.data.showPrimaryTeeth)

    if (!result.success) {
      const statusCode = result.errorCode === 'NOT_FOUND' ? 404 : 400
      return res.status(statusCode).json({
        success: false,
        error: { message: result.error, code: result.errorCode },
      })
    }

    res.json({
      success: true,
      data: { showPrimaryTeeth: result.patient.showPrimaryTeeth },
    })
  } catch (e) {
    next(e)
  }
})

/**
 * PUT /api/patients/:id/restore
 * Restore a soft-deleted patient (ADMIN+ required)
 */
patientsRouter.put('/:id/restore', requireMinRole('CLINIC_ADMIN'), async (req, res, next) => {
  try {
    const tenantId = req.user!.tenantId
    const { id } = req.params

    const result = await restorePatient(tenantId, id)

    if (!result.success) {
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
      data: result.patient,
    })
  } catch (e) {
    next(e)
  }
})

/**
 * GET /api/patients/:id/history-pdf
 * Download patient history as PDF
 * Requires: STAFF role or higher
 */
patientsRouter.get('/:id/history-pdf', requireMinRole('STAFF'), async (req, res, next) => {
  try {
    const tenantId = req.user!.tenantId
    const { id } = req.params

    const result = await PdfService.getPatientHistoryData(tenantId, id)

    if ('error' in result) {
      const status = result.error === 'NOT_FOUND' ? 404 : 400
      return res.status(status).json({
        success: false,
        error: { code: result.error, message: result.message },
      })
    }

    const pdfBuffer = await PdfService.generatePdf(
      React.createElement(PatientHistoryPdf, { data: result.data })
    )

    const patientName = sanitizeFilename(`${result.data.patient.firstName}-${result.data.patient.lastName}`)
    const filename = `patient-history-${patientName}-${id}.pdf`
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    res.setHeader('Content-Length', pdfBuffer.length)
    res.send(pdfBuffer)
  } catch (e) {
    next(e)
  }
})

// ============================================================================
// Patient Payments (Entregas)
// ============================================================================

const createPaymentSchema = z.object({
  amount: z.number().min(0.01, 'Amount must be greater than 0'),
  date: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  note: z.string().optional(),
})

const listPaymentsQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).optional(),
  offset: z.coerce.number().int().nonnegative().optional(),
  kind: z.enum(['ADVANCE', 'APPOINTMENT']).optional(),
})

/**
 * GET /api/patients/:id/balance
 * Get patient balance (total debt, total paid, outstanding)
 */
patientsRouter.get('/:id/balance', requirePermission(Permission.PAYMENTS_VIEW), async (req, res, next) => {
  try {
    const tenantId = req.user!.tenantId!
    const { id } = req.params

    const result = await getPatientBalance(tenantId, id)

    if (!result.success) {
      const status = result.code === 'PATIENT_NOT_FOUND' ? 404 : 500
      res.status(status).json({ success: false, error: 'Patient not found' })
      return
    }

    res.json({ success: true, data: result.data })
  } catch (e) {
    next(e)
  }
})

/**
 * GET /api/patients/:id/statement
 * Get the patient account statement (debt on performed work, credit,
 * remaining budget projection)
 */
patientsRouter.get(
  '/:id/statement',
  requirePermission(Permission.PAYMENTS_VIEW),
  async (req, res, next) => {
    try {
      const tenantId = req.user!.tenantId!
      const { id } = req.params

      const result = await getPatientAccountStatement(tenantId, id)

      if (!result.success) {
        const status = result.code === 'PATIENT_NOT_FOUND' ? 404 : 500
        res.status(status).json({ success: false, error: 'Patient not found' })
        return
      }

      res.json({ success: true, data: result.data })
    } catch (e) {
      next(e)
    }
  }
)

/**
 * GET /api/patients/:id/payments
 * List payments for a patient
 */
patientsRouter.get('/:id/payments', requirePermission(Permission.PAYMENTS_VIEW), async (req, res, next) => {
  try {
    const tenantId = req.user!.tenantId!
    const { id } = req.params

    const parsedQuery = listPaymentsQuerySchema.safeParse(req.query)
    if (!parsedQuery.success) {
      res.status(400).json({
        success: false,
        error: 'Validation error',
        details: parsedQuery.error.flatten().fieldErrors,
      })
      return
    }
    const { limit, offset, kind } = parsedQuery.data

    const result = await listPayments(tenantId, id, { limit, offset, kind })

    res.json({
      success: true,
      data: result.data,
      pagination: {
        total: result.total,
        limit: limit ?? 50,
        offset: offset ?? 0,
      },
    })
  } catch (e) {
    next(e)
  }
})

/**
 * POST /api/patients/:id/payments
 * Create a payment for a patient
 */
patientsRouter.post('/:id/payments', requirePermission(Permission.PAYMENTS_CREATE), async (req, res, next) => {
  try {
    const tenantId = req.user!.tenantId!
    const { id: patientId } = req.params

    const parsed = createPaymentSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        error: 'Validation error',
        details: parsed.error.flatten().fieldErrors,
      })
      return
    }

    const result = await createPayment(tenantId, patientId, {
      amount: parsed.data.amount,
      date: new Date(parsed.data.date),
      note: parsed.data.note,
      createdBy: req.user!.userId,
    })

    if (!result.success) {
      const statusMap: Record<string, number> = {
        PATIENT_NOT_FOUND: 404,
        EXCEEDS_BALANCE: 400,
      }
      const messageMap: Record<string, string> = {
        PATIENT_NOT_FOUND: 'Patient not found',
        EXCEEDS_BALANCE: 'Payment amount exceeds outstanding balance',
      }
      res.status(statusMap[result.code] || 500).json({
        success: false,
        error: messageMap[result.code] || 'Unknown error',
      })
      return
    }

    res.status(201).json({ success: true, data: result.data })
  } catch (e) {
    next(e)
  }
})

/**
 * DELETE /api/patients/:patientId/payments/:paymentId
 * Soft delete a payment
 */
patientsRouter.delete('/:patientId/payments/:paymentId', requirePermission(Permission.PAYMENTS_DELETE), async (req, res, next) => {
  try {
    const tenantId = req.user!.tenantId!
    const { paymentId } = req.params

    const result = await deletePayment(tenantId, paymentId)

    if (!result.success) {
      const statusMap: Record<string, number> = {
        NOT_FOUND: 404,
        ALREADY_INACTIVE: 400,
      }
      const messageMap: Record<string, string> = {
        NOT_FOUND: 'Payment not found',
        ALREADY_INACTIVE: 'Payment is already deleted',
      }
      res.status(statusMap[result.code] || 500).json({
        success: false,
        error: messageMap[result.code] || 'Unknown error',
      })
      return
    }

    res.json({ success: true, data: result.data })
  } catch (e) {
    next(e)
  }
})

// ============================================================================
// Patient Budgets
// ============================================================================

/**
 * GET /api/patients/:id/budgets
 * List budgets for a patient
 */
patientsRouter.get(
  '/:id/budgets',
  requirePermission(Permission.BUDGETS_VIEW),
  async (req, res, next) => {
    try {
      const tenantId = req.user!.tenantId!
      const { id: patientId } = req.params
      const { limit, offset, includeInactive } = req.query

      const result = await listBudgetsByPatient(tenantId, patientId, {
        limit: limit ? Math.min(parseInt(String(limit), 10), 100) : undefined,
        offset: offset ? parseInt(String(offset), 10) : undefined,
        includeInactive: includeInactive === 'true',
      })

      res.json({
        success: true,
        data: result.data,
        pagination: {
          total: result.total,
          limit: limit ? parseInt(String(limit), 10) : 50,
          offset: offset ? parseInt(String(offset), 10) : 0,
        },
      })
    } catch (e) {
      next(e)
    }
  }
)

/**
 * POST /api/patients/:id/budgets
 * Create a new budget for a patient
 */
patientsRouter.post(
  '/:id/budgets',
  requirePermission(Permission.BUDGETS_CREATE),
  async (req, res, next) => {
    try {
      const tenantId = req.user!.tenantId!
      const { id: patientId } = req.params

      const parsed = createBudgetSchema.safeParse(req.body)
      if (!parsed.success) {
        res.status(400).json({
          success: false,
          error: 'Validation error',
          details: parsed.error.flatten().fieldErrors,
        })
        return
      }

      const result = await createBudget(tenantId, patientId, {
        notes: parsed.data.notes,
        validUntil:
          typeof parsed.data.validUntil === 'string'
            ? new Date(parsed.data.validUntil)
            : parsed.data.validUntil,
        status: parsed.data.status,
        items: parsed.data.items.map((item) => ({
          description: item.description,
          toothNumber: item.toothNumber,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          plannedAppointmentType: item.plannedAppointmentType,
          notes: item.notes,
          order: item.order,
        })),
        createdById: req.user!.userId,
      })

      if (!result.success) {
        const statusMap: Record<string, number> = {
          PATIENT_NOT_FOUND: 404,
        }
        const messageMap: Record<string, string> = {
          PATIENT_NOT_FOUND: 'Patient not found',
        }
        res.status(statusMap[result.code] || 500).json({
          success: false,
          error: messageMap[result.code] || 'Unknown error',
        })
        return
      }

      res.status(201).json({ success: true, data: result.data })
    } catch (e) {
      next(e)
    }
  }
)

export { patientsRouter }
