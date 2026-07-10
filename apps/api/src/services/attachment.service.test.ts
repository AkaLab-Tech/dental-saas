import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { prisma } from '@dental/database'
import { AttachmentService, AttachmentError } from './attachment.service.js'
import { unlink, readFile } from 'fs/promises'
import path from 'path'
import { env } from '../config/env.js'

describe('AttachmentService', () => {
  let tenantId: string
  const testSlug = `test-attach-svc-${Date.now()}`

  beforeAll(async () => {
    // Create tenant
    const tenant = await prisma.tenant.create({
      data: {
        name: 'Attachment Service Test Clinic',
        slug: testSlug,
        currency: 'USD',
        timezone: 'America/New_York',
      },
    })
    tenantId = tenant.id

    // Get or create free plan with 100MB storage
    let freePlan = await prisma.plan.findUnique({ where: { name: 'free' } })
    if (!freePlan) {
      freePlan = await prisma.plan.create({
        data: {
          name: 'free',
          displayName: 'Free',
          price: 0,
          maxAdmins: 1,
          maxDoctors: 3,
          maxPatients: 50,
          maxStorageMb: 100,
        },
      })
    }
    // Create subscription
    await prisma.subscription.create({
      data: {
        tenantId,
        planId: freePlan.id,
        status: 'ACTIVE',
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    })
  })

  afterAll(async () => {
    // Clean up attachments
    await prisma.attachment.deleteMany({ where: { tenantId } })
    await prisma.subscription.deleteMany({ where: { tenantId } })
    await prisma.tenant.delete({ where: { id: tenantId } })
    await prisma.$disconnect()
  })

  describe('checkStorageLimit', () => {
    it('should allow upload within limit', async () => {
      const result = await AttachmentService.checkStorageLimit(tenantId, 1024)
      expect(result.allowed).toBe(true)
      expect(result.usage.limitMb).toBeGreaterThanOrEqual(100)
    })

    it('should deny upload when exceeding limit', async () => {
      // Try to upload more than 100MB (free plan limit)
      const hugeSize = 200 * 1024 * 1024
      const result = await AttachmentService.checkStorageLimit(tenantId, hugeSize)
      expect(result.allowed).toBe(false)
    })

    it('should return zero usage for non-existent tenant', async () => {
      const result = await AttachmentService.checkStorageLimit('non-existent', 1024)
      expect(result.allowed).toBe(false)
      expect(result.usage.usedBytes).toBe(0)
    })
  })

  describe('getStorageUsage', () => {
    it('should return storage usage stats', async () => {
      const usage = await AttachmentService.getStorageUsage(tenantId)
      expect(usage.usedBytes).toBeGreaterThanOrEqual(0)
      expect(usage.limitBytes).toBeGreaterThan(0)
      expect(usage.limitMb).toBeGreaterThanOrEqual(100)
      expect(usage.percentage).toBeGreaterThanOrEqual(0)
      expect(usage.percentage).toBeLessThanOrEqual(100)
    })
  })

  describe('uploadAttachments', () => {
    it('should upload a file and create DB record', async () => {
      const buffer = Buffer.from('fake-png-data')
      const attachments = await AttachmentService.uploadAttachments({
        tenantId,
        module: 'PATIENTS',
        entityId: 'patient-123',
        uploadedBy: 'user-123',
        files: [
          {
            originalname: 'test-image.png',
            mimetype: 'image/png',
            buffer,
            size: buffer.length,
          },
        ],
      })

      expect(attachments).toHaveLength(1)
      expect(attachments[0].filename).toBe('test-image.png')
      expect(attachments[0].mimeType).toBe('image/png')
      expect(attachments[0].sizeBytes).toBe(buffer.length)
      expect(attachments[0].module).toBe('PATIENTS')
      expect(attachments[0].entityId).toBe('patient-123')

      // Verify file exists on disk
      const filePath = path.join(
        env.UPLOAD_DIR,
        tenantId,
        'patients',
        attachments[0].storedName
      )
      const fileContent = await readFile(filePath)
      expect(fileContent.toString()).toBe('fake-png-data')

      // Clean up file
      await unlink(filePath)
    })

    it('should reject invalid MIME types', async () => {
      const buffer = Buffer.from('fake-data')
      await expect(
        AttachmentService.uploadAttachments({
          tenantId,
          module: 'PATIENTS',
          entityId: 'patient-123',
          uploadedBy: 'user-123',
          files: [
            {
              originalname: 'test.pdf',
              mimetype: 'application/pdf',
              buffer,
              size: buffer.length,
            },
          ],
        })
      ).rejects.toThrow(AttachmentError)
    })

    it('should update tenant storage after upload', async () => {
      const buffer = Buffer.alloc(1024, 'x')

      // Get storage before
      const usageBefore = await AttachmentService.getStorageUsage(tenantId)

      const attachments = await AttachmentService.uploadAttachments({
        tenantId,
        module: 'APPOINTMENTS',
        entityId: 'appt-123',
        uploadedBy: 'user-123',
        files: [
          {
            originalname: 'photo.jpg',
            mimetype: 'image/jpeg',
            buffer,
            size: buffer.length,
          },
        ],
      })

      // Get storage after
      const usageAfter = await AttachmentService.getStorageUsage(tenantId)
      expect(usageAfter.usedBytes).toBe(usageBefore.usedBytes + buffer.length)

      // Clean up
      const filePath = path.join(
        env.UPLOAD_DIR,
        tenantId,
        'appointments',
        attachments[0].storedName
      )
      await unlink(filePath).catch(() => {})
    })
  })

  describe('listAttachments', () => {
    it('should list attachments for an entity', async () => {
      const buffer = Buffer.from('data')
      const attachments = await AttachmentService.uploadAttachments({
        tenantId,
        module: 'LABWORKS',
        entityId: 'labwork-list-test',
        uploadedBy: 'user-123',
        files: [
          { originalname: 'a.png', mimetype: 'image/png', buffer, size: buffer.length },
          { originalname: 'b.jpg', mimetype: 'image/jpeg', buffer, size: buffer.length },
        ],
      })

      const list = await AttachmentService.listAttachments(tenantId, 'LABWORKS', 'labwork-list-test')
      expect(list.length).toBeGreaterThanOrEqual(2)

      // Should not return attachments from another entity
      const otherList = await AttachmentService.listAttachments(tenantId, 'LABWORKS', 'non-existent')
      expect(otherList).toHaveLength(0)

      // Clean up files
      for (const att of attachments) {
        const filePath = path.join(env.UPLOAD_DIR, tenantId, 'labworks', att.storedName)
        await unlink(filePath).catch(() => {})
      }
    })
  })

  describe('getAttachment', () => {
    it('should return attachment with file path', async () => {
      const buffer = Buffer.from('test')
      const [att] = await AttachmentService.uploadAttachments({
        tenantId,
        module: 'EXPENSES',
        entityId: 'expense-get-test',
        uploadedBy: 'user-123',
        files: [
          { originalname: 'receipt.png', mimetype: 'image/png', buffer, size: buffer.length },
        ],
      })

      const result = await AttachmentService.getAttachment(tenantId, att.id)
      expect(result).not.toBeNull()
      expect(result!.attachment.id).toBe(att.id)
      expect(result!.filePath).toContain(att.storedName)

      // Clean up
      await unlink(result!.filePath).catch(() => {})
    })

    it('should return null for non-existent attachment', async () => {
      const result = await AttachmentService.getAttachment(tenantId, 'non-existent-id')
      expect(result).toBeNull()
    })

    it('should enforce tenant isolation', async () => {
      const buffer = Buffer.from('isolated')
      const [att] = await AttachmentService.uploadAttachments({
        tenantId,
        module: 'PATIENTS',
        entityId: 'patient-iso',
        uploadedBy: 'user-123',
        files: [
          { originalname: 'iso.png', mimetype: 'image/png', buffer, size: buffer.length },
        ],
      })

      // Different tenant should not see this attachment
      const result = await AttachmentService.getAttachment('other-tenant-id', att.id)
      expect(result).toBeNull()

      // Clean up
      const filePath = path.join(env.UPLOAD_DIR, tenantId, 'patients', att.storedName)
      await unlink(filePath).catch(() => {})
    })
  })

  describe('deleteAttachment', () => {
    it('should delete attachment and update storage', async () => {
      const buffer = Buffer.alloc(512, 'z')
      const [att] = await AttachmentService.uploadAttachments({
        tenantId,
        module: 'PATIENTS',
        entityId: 'patient-del-test',
        uploadedBy: 'user-123',
        files: [
          { originalname: 'del.png', mimetype: 'image/png', buffer, size: buffer.length },
        ],
      })

      const usageBefore = await AttachmentService.getStorageUsage(tenantId)
      const deleted = await AttachmentService.deleteAttachment(tenantId, att.id)
      expect(deleted).not.toBeNull()
      expect(deleted!.id).toBe(att.id)

      // Storage should decrease
      const usageAfter = await AttachmentService.getStorageUsage(tenantId)
      expect(usageAfter.usedBytes).toBe(usageBefore.usedBytes - buffer.length)

      // DB record should be gone
      const fetched = await AttachmentService.getAttachment(tenantId, att.id)
      expect(fetched).toBeNull()
    })

    it('should return null for non-existent attachment', async () => {
      const result = await AttachmentService.deleteAttachment(tenantId, 'non-existent')
      expect(result).toBeNull()
    })
  })
})
