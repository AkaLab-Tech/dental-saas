import { Router, Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import { prisma } from '@dental/database'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { TenantSettingsService } from '../services/tenant-settings.service.js'

const router: Router = Router()

// Validation schema for settings update
const updateSettingsSchema = z.object({
  language: z.enum(['es', 'en', 'pt']).optional(),
  dateFormat: z.enum(['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD']).optional(),
  timeFormat: z.enum(['12h', '24h']).optional(),
  defaultAppointmentDuration: z.number().min(5).max(240).optional(),
  appointmentBuffer: z.number().min(0).max(60).optional(),
  businessHours: z
    .record(
      z.string(),
      z.object({
        start: z.string().regex(/^\d{2}:\d{2}$/),
        end: z.string().regex(/^\d{2}:\d{2}$/),
      })
    )
    .refine(
      (hours) => {
        // Validate that end time is after start time for each entry
        for (const [, value] of Object.entries(hours)) {
          const startMinutes =
            parseInt(value.start.split(':')[0]) * 60 +
            parseInt(value.start.split(':')[1])
          const endMinutes =
            parseInt(value.end.split(':')[0]) * 60 +
            parseInt(value.end.split(':')[1])
          if (endMinutes <= startMinutes) {
            return false
          }
        }
        return true
      },
      { message: 'End time must be after start time for all business hours' }
    )
    .optional(),
  workingDays: z
    .array(z.number().min(0).max(6))
    .refine((days) => new Set(days).size === days.length, {
      message: 'Working days must be unique',
    })
    .optional(),
  emailNotifications: z.boolean().optional(),
  smsNotifications: z.boolean().optional(),
  appointmentReminders: z.boolean().optional(),
  reminderHoursBefore: z.number().min(1).max(168).optional(),
  autoLockMinutes: z.number().int().min(0).max(60).optional(),
})

/**
 * GET /api/settings
 * Get settings for the authenticated user's tenant
 */
router.get(
  '/settings',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.user!.tenantId

      if (!tenantId) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Tenant ID is required',
        })
      }

      const settings = await TenantSettingsService.getOrCreateSettings(tenantId)

      res.json({
        settings: {
          id: settings.id,
          language: settings.language,
          dateFormat: settings.dateFormat,
          timeFormat: settings.timeFormat,
          defaultAppointmentDuration: settings.defaultAppointmentDuration,
          appointmentBuffer: settings.appointmentBuffer,
          businessHours: settings.businessHours,
          workingDays: settings.workingDays,
          emailNotifications: settings.emailNotifications,
          smsNotifications: settings.smsNotifications,
          appointmentReminders: settings.appointmentReminders,
          reminderHoursBefore: settings.reminderHoursBefore,
          autoLockMinutes: settings.autoLockMinutes,
          updatedAt: settings.updatedAt,
        },
      })
    } catch (error) {
      next(error)
    }
  }
)

/**
 * PUT /api/settings
 * Update settings for the authenticated user's tenant
 * Only OWNER and ADMIN can update settings
 */
router.put(
  '/settings',
  requireAuth,
  requireRole('OWNER', 'ADMIN'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.user!.tenantId

      if (!tenantId) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Tenant ID is required',
        })
      }

      const parsed = updateSettingsSchema.safeParse(req.body)
      if (!parsed.success) {
        return res.status(400).json({
          error: 'Validation Error',
          message: 'Invalid settings data',
          details: parsed.error.errors,
        })
      }

      const settings = await TenantSettingsService.updateSettings(
        tenantId,
        parsed.data
      )

      res.json({
        message: 'Settings updated successfully',
        settings: {
          id: settings.id,
          language: settings.language,
          dateFormat: settings.dateFormat,
          timeFormat: settings.timeFormat,
          defaultAppointmentDuration: settings.defaultAppointmentDuration,
          appointmentBuffer: settings.appointmentBuffer,
          businessHours: settings.businessHours,
          workingDays: settings.workingDays,
          emailNotifications: settings.emailNotifications,
          smsNotifications: settings.smsNotifications,
          appointmentReminders: settings.appointmentReminders,
          reminderHoursBefore: settings.reminderHoursBefore,
          autoLockMinutes: settings.autoLockMinutes,
          updatedAt: settings.updatedAt,
        },
      })
    } catch (error) {
      next(error)
    }
  }
)

// Validation schema for tenant profile update
const updateTenantProfileSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  email: z.string().email().optional(),
  phone: z.string().max(30).optional().nullable(),
  address: z.string().max(500).optional().nullable(),
  logo: z.string().url().optional().nullable(),
  timezone: z.string().optional(),
  currency: z.string().length(3).optional(),
})

/**
 * GET /api/tenant/profile
 * Get tenant profile information
 */
router.get(
  '/tenant/profile',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.user!.tenantId

      if (!tenantId) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Tenant ID is required',
        })
      }

      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: {
          id: true,
          name: true,
          slug: true,
          email: true,
          phone: true,
          address: true,
          logo: true,
          timezone: true,
          currency: true,
          createdAt: true,
          updatedAt: true,
        },
      })

      if (!tenant) {
        return res.status(404).json({
          error: 'Not Found',
          message: 'Tenant not found',
        })
      }

      res.json({ tenant })
    } catch (error) {
      next(error)
    }
  }
)

/**
 * PUT /api/tenant/profile
 * Update tenant profile information
 * Only OWNER can update tenant profile
 */
router.put(
  '/tenant/profile',
  requireAuth,
  requireRole('OWNER'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.user!.tenantId

      if (!tenantId) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Tenant ID is required',
        })
      }

      const parsed = updateTenantProfileSchema.safeParse(req.body)
      if (!parsed.success) {
        return res.status(400).json({
          error: 'Validation Error',
          message: 'Invalid profile data',
          details: parsed.error.errors,
        })
      }

      const tenant = await prisma.tenant.update({
        where: { id: tenantId },
        data: parsed.data,
        select: {
          id: true,
          name: true,
          slug: true,
          email: true,
          phone: true,
          address: true,
          logo: true,
          timezone: true,
          currency: true,
          createdAt: true,
          updatedAt: true,
        },
      })

      res.json({
        message: 'Tenant profile updated successfully',
        tenant,
      })
    } catch (error) {
      next(error)
    }
  }
)

export { router as settingsRouter }
