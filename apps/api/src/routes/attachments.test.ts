import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import path from 'path'
import { unlink } from 'fs/promises'
import { api } from '../test/http.js'
import { prisma } from '@dental/database'
import { hashPassword } from '../services/auth.service.js'
import { sign } from 'jsonwebtoken'
import { env } from '../config/env.js'

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret'

describe('Attachments Routes', () => {
  let tenantId: string
  let adminToken: string
  let staffToken: string
  let doctorToken: string
  const testSlug = `test-attach-${Date.now()}`
  const createdFiles: string[] = []

  function generateToken(userId: string, tenantId: string, role: string) {
    return sign(
      { userId, tenantId, role, email: `${role.toLowerCase()}@test.com` },
      JWT_SECRET,
      { expiresIn: '1h' }
    )
  }

  beforeAll(async () => {
    // Create tenant
    const tenant = await prisma.tenant.create({
      data: {
        name: 'Attachment Routes Test Clinic',
        slug: testSlug,
        currency: 'USD',
        timezone: 'America/New_York',
      },
    })
    tenantId = tenant.id

    // Get or create free plan
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

    // Create users
    const hashedPassword = await hashPassword('password123')

    const adminUser = await prisma.user.create({
      data: {
        tenantId,
        email: 'admin@attach-test.com',
        firstName: 'Admin',
        lastName: 'User',
        passwordHash: hashedPassword,
        role: 'ADMIN',
      },
    })
    adminToken = generateToken(adminUser.id, tenantId, 'ADMIN')

    const staffUser = await prisma.user.create({
      data: {
        tenantId,
        email: 'staff@attach-test.com',
        firstName: 'Staff',
        lastName: 'User',
        passwordHash: hashedPassword,
        role: 'STAFF',
      },
    })
    staffToken = generateToken(staffUser.id, tenantId, 'STAFF')

    const doctorUser = await prisma.user.create({
      data: {
        tenantId,
        email: 'doctor@attach-test.com',
        firstName: 'Doctor',
        lastName: 'User',
        passwordHash: hashedPassword,
        role: 'DOCTOR',
      },
    })
    doctorToken = generateToken(doctorUser.id, tenantId, 'DOCTOR')
  })

  afterAll(async () => {
    // Clean up files
    for (const filePath of createdFiles) {
      await unlink(filePath).catch(() => {})
    }
    // Clean up DB
    await prisma.attachment.deleteMany({ where: { tenantId } })
    await prisma.user.deleteMany({ where: { tenantId } })
    await prisma.subscription.deleteMany({ where: { tenantId } })
    await prisma.tenant.delete({ where: { id: tenantId } })
    await prisma.$disconnect()
  })

  describe('POST /api/attachments/:module/:entityId', () => {
    it('should upload a file as ADMIN', async () => {
      const res = await api()
        .post('/api/attachments/patients/patient-1')
        .set('Authorization', `Bearer ${adminToken}`)
        .attach('files', Buffer.from('fake-png'), {
          filename: 'test.png',
          contentType: 'image/png',
        })

      expect(res.status).toBe(201)
      expect(res.body.success).toBe(true)
      expect(res.body.data).toHaveLength(1)
      expect(res.body.data[0].filename).toBe('test.png')
      expect(res.body.data[0].mimeType).toBe('image/png')

      // Track file for cleanup
      const storedName = res.body.data[0].storedName
      createdFiles.push(path.join(env.UPLOAD_DIR, tenantId, 'patients', storedName))
    })

    it('should upload a file as DOCTOR', async () => {
      const res = await api()
        .post('/api/attachments/appointments/appt-1')
        .set('Authorization', `Bearer ${doctorToken}`)
        .attach('files', Buffer.from('fake-jpg'), {
          filename: 'photo.jpg',
          contentType: 'image/jpeg',
        })

      expect(res.status).toBe(201)
      expect(res.body.data).toHaveLength(1)

      createdFiles.push(
        path.join(env.UPLOAD_DIR, tenantId, 'appointments', res.body.data[0].storedName)
      )
    })

    it('should deny upload for STAFF', async () => {
      const res = await api()
        .post('/api/attachments/patients/patient-1')
        .set('Authorization', `Bearer ${staffToken}`)
        .attach('files', Buffer.from('fake'), {
          filename: 'test.png',
          contentType: 'image/png',
        })

      expect(res.status).toBe(403)
    })

    it('should reject invalid file types', async () => {
      const res = await api()
        .post('/api/attachments/patients/patient-1')
        .set('Authorization', `Bearer ${adminToken}`)
        .attach('files', Buffer.from('fake-pdf'), {
          filename: 'doc.pdf',
          contentType: 'application/pdf',
        })

      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('INVALID_FILE_TYPE')
    })

    it('should reject invalid module', async () => {
      const res = await api()
        .post('/api/attachments/invalid-module/entity-1')
        .set('Authorization', `Bearer ${adminToken}`)
        .attach('files', Buffer.from('data'), {
          filename: 'test.png',
          contentType: 'image/png',
        })

      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('INVALID_MODULE')
    })

    it('should reject request without files', async () => {
      const res = await api()
        .post('/api/attachments/patients/patient-1')
        .set('Authorization', `Bearer ${adminToken}`)

      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('NO_FILES')
    })

    it('should require authentication', async () => {
      const res = await api()
        .post('/api/attachments/patients/patient-1')
        .attach('files', Buffer.from('data'), {
          filename: 'test.png',
          contentType: 'image/png',
        })

      expect(res.status).toBe(401)
    })
  })

  describe('GET /api/attachments/:module/:entityId', () => {
    it('should list attachments as STAFF', async () => {
      // First upload as admin
      const uploadRes = await api()
        .post('/api/attachments/labworks/labwork-list-1')
        .set('Authorization', `Bearer ${adminToken}`)
        .attach('files', Buffer.from('data-1'), {
          filename: 'img1.png',
          contentType: 'image/png',
        })

      createdFiles.push(
        path.join(env.UPLOAD_DIR, tenantId, 'labworks', uploadRes.body.data[0].storedName)
      )

      // Then list as staff
      const res = await api()
        .get('/api/attachments/labworks/labwork-list-1')
        .set('Authorization', `Bearer ${staffToken}`)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data.length).toBeGreaterThanOrEqual(1)
    })

    it('should return empty array for entity with no attachments', async () => {
      const res = await api()
        .get('/api/attachments/expenses/no-attachments')
        .set('Authorization', `Bearer ${staffToken}`)

      expect(res.status).toBe(200)
      expect(res.body.data).toHaveLength(0)
    })
  })

  describe('GET /api/attachments/file/:id', () => {
    it('should stream file with correct Content-Type', async () => {
      const imageData = Buffer.from('fake-image-data')
      const uploadRes = await api()
        .post('/api/attachments/patients/patient-file-test')
        .set('Authorization', `Bearer ${adminToken}`)
        .attach('files', imageData, {
          filename: 'stream-test.png',
          contentType: 'image/png',
        })

      const attachmentId = uploadRes.body.data[0].id
      createdFiles.push(
        path.join(env.UPLOAD_DIR, tenantId, 'patients', uploadRes.body.data[0].storedName)
      )

      const res = await api()
        .get(`/api/attachments/file/${attachmentId}`)
        .set('Authorization', `Bearer ${staffToken}`)

      expect(res.status).toBe(200)
      expect(res.headers['content-type']).toBe('image/png')
    })

    it('should return 404 for non-existent attachment', async () => {
      const res = await api()
        .get('/api/attachments/file/non-existent-id')
        .set('Authorization', `Bearer ${staffToken}`)

      expect(res.status).toBe(404)
    })

    it('should stream file via ?token= query param (no Authorization header)', async () => {
      const imageData = Buffer.from('token-param-image-data')
      const uploadRes = await api()
        .post('/api/attachments/patients/patient-token-test')
        .set('Authorization', `Bearer ${adminToken}`)
        .attach('files', imageData, {
          filename: 'token-test.png',
          contentType: 'image/png',
        })

      const attachmentId = uploadRes.body.data[0].id
      createdFiles.push(
        path.join(env.UPLOAD_DIR, tenantId, 'patients', uploadRes.body.data[0].storedName)
      )

      // Access via query param instead of Authorization header
      const res = await api()
        .get(`/api/attachments/file/${attachmentId}?token=${staffToken}`)

      expect(res.status).toBe(200)
      expect(res.headers['content-type']).toBe('image/png')
    })

    it('should reject file access with no auth at all', async () => {
      const res = await api()
        .get('/api/attachments/file/some-id')

      expect(res.status).toBe(401)
    })
  })

  describe('DELETE /api/attachments/:id', () => {
    it('should delete attachment as ADMIN', async () => {
      const uploadRes = await api()
        .post('/api/attachments/expenses/expense-del-1')
        .set('Authorization', `Bearer ${adminToken}`)
        .attach('files', Buffer.from('del-data'), {
          filename: 'to-delete.png',
          contentType: 'image/png',
        })

      const attachmentId = uploadRes.body.data[0].id

      const res = await api()
        .delete(`/api/attachments/${attachmentId}`)
        .set('Authorization', `Bearer ${adminToken}`)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)

      // Verify it's gone
      const getRes = await api()
        .get(`/api/attachments/file/${attachmentId}`)
        .set('Authorization', `Bearer ${adminToken}`)

      expect(getRes.status).toBe(404)
    })

    it('should deny delete for STAFF', async () => {
      const uploadRes = await api()
        .post('/api/attachments/patients/patient-staff-del')
        .set('Authorization', `Bearer ${adminToken}`)
        .attach('files', Buffer.from('keep'), {
          filename: 'keep.png',
          contentType: 'image/png',
        })

      const attachmentId = uploadRes.body.data[0].id
      createdFiles.push(
        path.join(env.UPLOAD_DIR, tenantId, 'patients', uploadRes.body.data[0].storedName)
      )

      const res = await api()
        .delete(`/api/attachments/${attachmentId}`)
        .set('Authorization', `Bearer ${staffToken}`)

      expect(res.status).toBe(403)
    })

    it('should deny delete for DOCTOR', async () => {
      const uploadRes = await api()
        .post('/api/attachments/appointments/appt-doc-del')
        .set('Authorization', `Bearer ${adminToken}`)
        .attach('files', Buffer.from('keep'), {
          filename: 'keep.png',
          contentType: 'image/png',
        })

      const attachmentId = uploadRes.body.data[0].id
      createdFiles.push(
        path.join(env.UPLOAD_DIR, tenantId, 'appointments', uploadRes.body.data[0].storedName)
      )

      const res = await api()
        .delete(`/api/attachments/${attachmentId}`)
        .set('Authorization', `Bearer ${doctorToken}`)

      expect(res.status).toBe(403)
    })

    it('should return 404 for non-existent attachment', async () => {
      const res = await api()
        .delete('/api/attachments/non-existent-id')
        .set('Authorization', `Bearer ${adminToken}`)

      expect(res.status).toBe(404)
    })
  })

  describe('GET /api/attachments/storage', () => {
    it('should return storage usage for STAFF', async () => {
      const res = await api()
        .get('/api/attachments/storage')
        .set('Authorization', `Bearer ${staffToken}`)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data).toHaveProperty('usedBytes')
      expect(res.body.data).toHaveProperty('limitBytes')
      expect(res.body.data).toHaveProperty('percentage')
    })
  })
})
