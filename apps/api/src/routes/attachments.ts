import { Router, type IRouter } from 'express'
import { createReadStream } from 'fs'
import { stat } from 'fs/promises'
import multer from 'multer'
import { z } from 'zod'
import { Permission } from '@dental/shared'
import { requirePermission } from '../middleware/permissions.js'
import { AttachmentService, AttachmentError } from '../services/attachment.service.js'
import { upload } from '../config/upload.js'

const attachmentsRouter: IRouter = Router()

// Valid module values
const moduleSchema = z.enum(['patients', 'appointments', 'labworks', 'expenses'])

// Map URL param to Prisma enum value
function toModuleEnum(mod: string): 'PATIENTS' | 'APPOINTMENTS' | 'LABWORKS' | 'EXPENSES' {
  return mod.toUpperCase() as 'PATIENTS' | 'APPOINTMENTS' | 'LABWORKS' | 'EXPENSES'
}

// ============================================================================
// Static routes (must come before /:module/:entityId)
// ============================================================================

/**
 * GET /api/attachments/storage
 * Get tenant storage usage
 */
attachmentsRouter.get(
  '/storage',
  requirePermission(Permission.SETTINGS_VIEW),
  async (req, res, next) => {
    try {
      const tenantId = req.user!.tenantId
      const usage = await AttachmentService.getStorageUsage(tenantId)

      res.json({ success: true, data: usage })
    } catch (e) {
      next(e)
    }
  }
)

// ============================================================================
// File router (separate so it can use token-param auth for direct <img src>)
// ============================================================================

const fileRouter: IRouter = Router()

/**
 * GET /api/attachments/file/:id
 * Stream a file (sets Content-Type header)
 */
fileRouter.get(
  '/:id',
  requirePermission(Permission.ATTACHMENTS_VIEW),
  async (req, res, next) => {
    try {
      const tenantId = req.user!.tenantId
      const { id } = req.params

      const result = await AttachmentService.getAttachment(tenantId, id)

      if (!result) {
        return res.status(404).json({
          success: false,
          error: { message: 'Attachment not found', code: 'NOT_FOUND' },
        })
      }

      // Verify file exists and get actual size from disk
      let fileStats
      try {
        fileStats = await stat(result.filePath)
      } catch {
        return res.status(404).json({
          success: false,
          error: { message: 'File not found on disk', code: 'FILE_NOT_FOUND' },
        })
      }

      res.setHeader('Content-Type', result.attachment.mimeType)
      res.setHeader('Content-Length', fileStats.size)
      res.setHeader(
        'Content-Disposition',
        `inline; filename="${result.attachment.filename}"`
      )
      res.setHeader('Cache-Control', 'private, max-age=3600')

      const stream = createReadStream(result.filePath)
      stream.on('error', (err) => {
        if (!res.headersSent) {
          next(err)
        } else {
          res.destroy()
        }
      })
      stream.pipe(res)
    } catch (e) {
      next(e)
    }
  }
)

// ============================================================================
// Dynamic routes
// ============================================================================

/**
 * POST /api/attachments/:module/:entityId
 * Upload files (multipart/form-data)
 */
attachmentsRouter.post(
  '/:module/:entityId',
  requirePermission(Permission.ATTACHMENTS_UPLOAD),
  (req, res, next) => {
    upload.array('files', 10)(req, res, (err) => {
      if (err) {
        if (err instanceof multer.MulterError) {
          if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({
              success: false,
              error: { message: 'File too large', code: 'FILE_TOO_LARGE' },
            })
          }
          if (err.code === 'LIMIT_FILE_COUNT') {
            return res.status(400).json({
              success: false,
              error: { message: 'Too many files', code: 'TOO_MANY_FILES' },
            })
          }
          if (err.code === 'LIMIT_UNEXPECTED_FILE') {
            return res.status(400).json({
              success: false,
              error: { message: 'Invalid file type. Only images are allowed (JPEG, PNG, WebP, GIF).', code: 'INVALID_FILE_TYPE' },
            })
          }
        }
        return next(err)
      }
      next()
    })
  },
  async (req, res, next) => {
    try {
      const tenantId = req.user!.tenantId
      const userId = req.user!.profileUserId || req.user!.userId
      const { module, entityId } = req.params

      // Validate module
      const parsed = moduleSchema.safeParse(module)
      if (!parsed.success) {
        return res.status(400).json({
          success: false,
          error: { message: 'Invalid module', code: 'INVALID_MODULE' },
        })
      }

      const files = req.files as Express.Multer.File[]
      if (!files || files.length === 0) {
        return res.status(400).json({
          success: false,
          error: { message: 'No files provided', code: 'NO_FILES' },
        })
      }

      const attachments = await AttachmentService.uploadAttachments({
        tenantId,
        module: toModuleEnum(parsed.data),
        entityId,
        uploadedBy: userId,
        files,
      })

      res.status(201).json({
        success: true,
        data: attachments,
      })
    } catch (e) {
      if (e instanceof AttachmentError) {
        return res.status(e.statusCode).json({
          success: false,
          error: { message: e.message, code: e.code },
        })
      }
      next(e)
    }
  }
)

/**
 * GET /api/attachments/:module/:entityId
 * List attachments for an entity
 */
attachmentsRouter.get(
  '/:module/:entityId',
  requirePermission(Permission.ATTACHMENTS_VIEW),
  async (req, res, next) => {
    try {
      const tenantId = req.user!.tenantId
      const { module, entityId } = req.params

      // Validate module
      const parsed = moduleSchema.safeParse(module)
      if (!parsed.success) {
        return res.status(400).json({
          success: false,
          error: { message: 'Invalid module', code: 'INVALID_MODULE' },
        })
      }

      const attachments = await AttachmentService.listAttachments(
        tenantId,
        toModuleEnum(parsed.data),
        entityId
      )

      res.json({ success: true, data: attachments })
    } catch (e) {
      next(e)
    }
  }
)

/**
 * DELETE /api/attachments/:id
 * Delete an attachment
 */
attachmentsRouter.delete(
  '/:id',
  requirePermission(Permission.ATTACHMENTS_DELETE),
  async (req, res, next) => {
    try {
      const tenantId = req.user!.tenantId
      const { id } = req.params

      const deleted = await AttachmentService.deleteAttachment(tenantId, id)

      if (!deleted) {
        return res.status(404).json({
          success: false,
          error: { message: 'Attachment not found', code: 'NOT_FOUND' },
        })
      }

      res.json({ success: true, message: 'Attachment deleted successfully' })
    } catch (e) {
      next(e)
    }
  }
)

export { attachmentsRouter, fileRouter }
