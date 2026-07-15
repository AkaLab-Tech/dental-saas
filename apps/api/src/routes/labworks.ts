import { Router, type IRouter } from 'express'
import React from 'react'
import { z } from 'zod'
import { requireMinRole } from '../middleware/auth.js'
import { requireOwnership } from '../middleware/ownership.js'
import { requirePermission } from '../middleware/permissions.js'
import { Permission } from '@dental/shared'
import {
  createLabwork,
  getLabworkById,
  listLabworks,
  updateLabwork,
  deleteLabwork,
  restoreLabwork,
  getLabworkStats,
  listLabNames,
  exportLabworksCsv,
} from '../services/labwork.service.js'
import { PdfService } from '../services/pdf.service.js'
import { LabworkOrderPdf } from '../pdfs/LabworkOrderPdf.js'

const labworksRouter: IRouter = Router()

// Zod schemas for validation
const createLabworkSchema = z.object({
  patientId: z.string().optional(),
  appointmentId: z.string().optional(),
  priceIncludedInAppointment: z.boolean().optional(),
  lab: z.string().min(1, 'Laboratory name is required'),
  phoneNumber: z.string().optional(),
  date: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  note: z.string().optional(),
  price: z.number().min(0).optional(),
  isPaid: z.boolean().optional(),
  isDelivered: z.boolean().optional(),
  doctorIds: z.array(z.string()).optional(),
})

const updateLabworkSchema = z.object({
  patientId: z.string().nullable().optional(),
  appointmentId: z.string().nullable().optional(),
  priceIncludedInAppointment: z.boolean().optional(),
  lab: z.string().min(1).optional(),
  phoneNumber: z.string().nullable().optional(),
  date: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).optional(),
  note: z.string().nullable().optional(),
  price: z.number().min(0).optional(),
  isPaid: z.boolean().optional(),
  isDelivered: z.boolean().optional(),
  doctorIds: z.array(z.string()).optional(),
})

// Error code to HTTP status mapping
const errorStatusMap: Record<string, number> = {
  NOT_FOUND: 404,
  ALREADY_INACTIVE: 400,
  ALREADY_ACTIVE: 400,
  INVALID_PATIENT: 400,
  INVALID_APPOINTMENT: 400,
}

// Error code to message mapping
const errorMessageMap: Record<string, string> = {
  NOT_FOUND: 'Labwork not found',
  ALREADY_INACTIVE: 'Labwork is already deleted',
  ALREADY_ACTIVE: 'Labwork is already active',
  INVALID_PATIENT: 'Patient not found or does not belong to this clinic',
  INVALID_APPOINTMENT: 'Appointment not found or does not belong to this patient',
}

/**
 * GET /api/labworks
 * List labworks for the tenant
 */
labworksRouter.get('/', requireMinRole('STAFF'), async (req, res, next) => {
  try {
    const tenantId = req.user!.tenantId!
    const { limit, offset, patientId, isPaid, isDelivered, overdue, from, to, includeInactive, search } = req.query

    const result = await listLabworks(tenantId, {
      limit: limit ? Math.min(parseInt(String(limit), 10), 100) : undefined,
      offset: offset ? parseInt(String(offset), 10) : undefined,
      patientId: patientId ? String(patientId) : undefined,
      isPaid: isPaid !== undefined ? isPaid === 'true' : undefined,
      isDelivered: isDelivered !== undefined ? isDelivered === 'true' : undefined,
      overdue: overdue !== undefined ? overdue === 'true' : undefined,
      from: from ? new Date(String(from)) : undefined,
      to: to ? new Date(String(to)) : undefined,
      includeInactive: includeInactive === 'true',
      search: search ? String(search) : undefined,
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
})

/**
 * GET /api/labworks/stats
 * Get labwork statistics
 */
labworksRouter.get('/stats', requireMinRole('STAFF'), async (req, res, next) => {
  try {
    const tenantId = req.user!.tenantId!
    const { from, to } = req.query

    const stats = await getLabworkStats(tenantId, {
      from: from ? new Date(String(from)) : undefined,
      to: to ? new Date(String(to)) : undefined,
    })

    res.json({ success: true, data: stats })
  } catch (e) {
    next(e)
  }
})

/**
 * GET /api/labworks/labs
 * List distinct laboratory names previously used by the tenant (for autocomplete)
 */
labworksRouter.get('/labs', requireMinRole('STAFF'), async (req, res, next) => {
  try {
    const tenantId = req.user!.tenantId!

    const labs = await listLabNames(tenantId)

    res.json({ success: true, data: labs })
  } catch (e) {
    next(e)
  }
})

/**
 * GET /api/labworks/export
 * Export labworks matching the current filters as CSV
 * Must be registered before /:id so "export" is not captured as an id
 */
labworksRouter.get('/export', requirePermission(Permission.DATA_EXPORT), async (req, res, next) => {
  try {
    const tenantId = req.user!.tenantId!
    const { patientId, isPaid, isDelivered, overdue, from, to, search } = req.query

    const csv = await exportLabworksCsv(tenantId, {
      patientId: patientId ? String(patientId) : undefined,
      isPaid: isPaid !== undefined ? isPaid === 'true' : undefined,
      isDelivered: isDelivered !== undefined ? isDelivered === 'true' : undefined,
      overdue: overdue !== undefined ? overdue === 'true' : undefined,
      from: from ? new Date(String(from)) : undefined,
      to: to ? new Date(String(to)) : undefined,
      search: search ? String(search) : undefined,
    })

    const filename = `labworks-${new Date().toISOString().split('T')[0]}.csv`
    const csvBom = String.fromCharCode(0xfeff)
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    res.send(csvBom + csv)
  } catch (e) {
    next(e)
  }
})

/**
 * GET /api/labworks/:id
 * Get a specific labwork
 */
labworksRouter.get('/:id', requireMinRole('STAFF'), async (req, res, next) => {
  try {
    const tenantId = req.user!.tenantId!
    const { id } = req.params

    const result = await getLabworkById(tenantId, id)

    if (!result.success) {
      res.status(errorStatusMap[result.code] || 500).json({
        success: false,
        error: errorMessageMap[result.code] || 'Unknown error',
      })
      return
    }

    res.json({ success: true, data: result.data })
  } catch (e) {
    next(e)
  }
})

/**
 * GET /api/labworks/:id/pdf
 * Download labwork order as PDF
 * Requires: STAFF role or higher
 */
labworksRouter.get('/:id/pdf', requireMinRole('STAFF'), async (req, res, next) => {
  try {
    const tenantId = req.user!.tenantId!
    const { id } = req.params

    const result = await PdfService.getLabworkOrderData(tenantId, id)

    if ('error' in result) {
      const status = result.error === 'NOT_FOUND' ? 404 : 400
      return res.status(status).json({
        success: false,
        error: { code: result.error, message: result.message },
      })
    }

    const pdfBuffer = await PdfService.generatePdf(React.createElement(LabworkOrderPdf, { data: result.data }))

    const filename = `labwork-${id}.pdf`
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    res.setHeader('Content-Length', pdfBuffer.length)
    res.send(pdfBuffer)
  } catch (e) {
    next(e)
  }
})

/**
 * POST /api/labworks
 * Create a new labwork
 */
labworksRouter.post('/', requireMinRole('CLINIC_ADMIN'), async (req, res, next) => {
  try {
    const tenantId = req.user!.tenantId!

    const parsed = createLabworkSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        error: 'Validation error',
        details: parsed.error.flatten().fieldErrors,
      })
      return
    }

    const result = await createLabwork(tenantId, {
      ...parsed.data,
      date: new Date(parsed.data.date),
      createdBy: req.user!.profileUserId || req.user!.userId,
    })

    if (!result.success) {
      res.status(errorStatusMap[result.code] || 500).json({
        success: false,
        error: errorMessageMap[result.code] || 'Unknown error',
      })
      return
    }

    res.status(201).json({ success: true, data: result.data })
  } catch (e) {
    next(e)
  }
})

/**
 * PUT /api/labworks/:id
 * Update a labwork
 */
labworksRouter.put('/:id', requireMinRole('DOCTOR'), requireOwnership('labwork'), async (req, res, next) => {
  try {
    const tenantId = req.user!.tenantId!
    const { id } = req.params

    const parsed = updateLabworkSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        error: 'Validation error',
        details: parsed.error.flatten().fieldErrors,
      })
      return
    }

    const result = await updateLabwork(tenantId, id, {
      ...parsed.data,
      date: parsed.data.date ? new Date(parsed.data.date) : undefined,
    })

    if (!result.success) {
      res.status(errorStatusMap[result.code] || 500).json({
        success: false,
        error: errorMessageMap[result.code] || 'Unknown error',
      })
      return
    }

    res.json({ success: true, data: result.data })
  } catch (e) {
    next(e)
  }
})

/**
 * DELETE /api/labworks/:id
 * Soft delete a labwork
 */
labworksRouter.delete('/:id', requireMinRole('DOCTOR'), requireOwnership('labwork'), async (req, res, next) => {
  try {
    const tenantId = req.user!.tenantId!
    const { id } = req.params

    const result = await deleteLabwork(tenantId, id)

    if (!result.success) {
      res.status(errorStatusMap[result.code] || 500).json({
        success: false,
        error: errorMessageMap[result.code] || 'Unknown error',
      })
      return
    }

    res.json({ success: true, data: result.data })
  } catch (e) {
    next(e)
  }
})

/**
 * PUT /api/labworks/:id/restore
 * Restore a soft-deleted labwork
 */
labworksRouter.put('/:id/restore', requireMinRole('CLINIC_ADMIN'), async (req, res, next) => {
  try {
    const tenantId = req.user!.tenantId!
    const { id } = req.params

    const result = await restoreLabwork(tenantId, id)

    if (!result.success) {
      res.status(errorStatusMap[result.code] || 500).json({
        success: false,
        error: errorMessageMap[result.code] || 'Unknown error',
      })
      return
    }

    res.json({ success: true, data: result.data })
  } catch (e) {
    next(e)
  }
})

export { labworksRouter }
export default labworksRouter
