import type { Request, Response, NextFunction } from 'express'
import { prisma } from '@dental/database'
import { hasMinRole } from './auth.js'
import { getLinkedDoctorId } from '../services/doctor.service.js'

type OwnershipModel = 'patient' | 'appointment' | 'labwork'

/**
 * Middleware that enforces ownership for DOCTOR/STAFF roles.
 * CLINIC_ADMIN and above can edit any record.
 * DOCTOR/STAFF can only edit records they created or are assigned to.
 */
export function requireOwnership(model: OwnershipModel) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const userRole = req.user?.role
    if (!userRole) {
      return res.status(401).json({
        success: false,
        error: { message: 'Authentication required', code: 'UNAUTHENTICATED' },
      })
    }

    // CLINIC_ADMIN+ can edit anything
    if (hasMinRole(userRole, 'CLINIC_ADMIN')) {
      return next()
    }

    const userId = req.user!.profileUserId || req.user!.userId
    const tenantId = req.user!.tenantId
    const resourceId = req.params.id

    if (!resourceId) {
      return next()
    }

    try {
      if (model === 'appointment') {
        const doctorId = await getLinkedDoctorId(userId, tenantId)
        const record = await prisma.appointment.findFirst({
          where: { id: resourceId, tenantId },
          select: { createdBy: true, doctorId: true },
        })
        if (record && (record.createdBy === userId || record.doctorId === doctorId)) {
          return next()
        }
      }

      if (model === 'patient') {
        const record = await prisma.patient.findFirst({
          where: { id: resourceId, tenantId },
          select: { createdBy: true },
        })
        if (record?.createdBy === userId) {
          return next()
        }
      }

      if (model === 'labwork') {
        const doctorId = await getLinkedDoctorId(userId, tenantId)
        const record = await prisma.labwork.findFirst({
          where: { id: resourceId, tenantId },
          select: { createdBy: true, doctorIds: true },
        })
        if (
          record &&
          (record.createdBy === userId ||
            (doctorId && Array.isArray(record.doctorIds) && (record.doctorIds as string[]).includes(doctorId)))
        ) {
          return next()
        }
      }

      return res.status(403).json({
        success: false,
        error: {
          message: 'You can only edit records you created or are assigned to',
          code: 'OWNERSHIP_REQUIRED',
        },
      })
    } catch {
      return next()
    }
  }
}
