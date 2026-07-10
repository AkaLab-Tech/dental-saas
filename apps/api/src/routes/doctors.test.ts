import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import request from 'supertest'
import { app } from '../app.js'
import { prisma } from '@dental/database'
import { hashPassword } from '../services/auth.service.js'
import { sign } from 'jsonwebtoken'

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret'

describe('Doctors API', () => {
  let tenantId: string
  let adminUserId: string
  let staffUserId: string
  let adminToken: string
  let staffToken: string
  const testSlug = `test-clinic-doctors-${Date.now()}`

  // Helper to generate JWT token
  function generateToken(userId: string, tenantId: string, role: string) {
    return sign(
      { sub: userId, tenantId, role },
      JWT_SECRET,
      { expiresIn: '1h' }
    )
  }

  beforeAll(async () => {
    // Create a test tenant with a free plan subscription
    const tenant = await prisma.tenant.create({
      data: {
        name: 'Test Clinic for Doctors',
        slug: testSlug,
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
        },
      })
    }

    // Create subscription for tenant
    await prisma.subscription.create({
      data: {
        tenantId: tenant.id,
        planId: freePlan.id,
        status: 'ACTIVE',
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    })

    // Create admin user
    const passwordHash = await hashPassword('AdminPass123!')
    const admin = await prisma.user.create({
      data: {
        email: 'admin-doctors@test.com',
        passwordHash,
        firstName: 'Admin',
        lastName: 'User',
        role: 'ADMIN',
        tenantId: tenant.id,
      },
    })
    adminUserId = admin.id
    adminToken = generateToken(admin.id, tenant.id, 'ADMIN')

    // Create staff user
    const staff = await prisma.user.create({
      data: {
        email: 'staff-doctors@test.com',
        passwordHash,
        firstName: 'Staff',
        lastName: 'User',
        role: 'STAFF',
        tenantId: tenant.id,
      },
    })
    staffUserId = staff.id
    staffToken = generateToken(staff.id, tenant.id, 'STAFF')
  })

  afterAll(async () => {
    // Clean up in correct order
    await prisma.doctor.deleteMany({ where: { tenantId } })
    await prisma.refreshToken.deleteMany({ where: { userId: { in: [adminUserId, staffUserId] } } })
    await prisma.user.deleteMany({ where: { tenantId } })
    await prisma.subscription.deleteMany({ where: { tenantId } })
    await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {})
  })

  beforeEach(async () => {
    // Clean up doctors before each test (except specific ones we want to keep)
    await prisma.doctor.deleteMany({ where: { tenantId } })
  })

  describe('POST /api/doctors', () => {
    it('should create a doctor with valid data (ADMIN)', async () => {
      const response = await request(app)
        .post('/api/doctors')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          firstName: 'John',
          lastName: 'Doe',
          email: 'john.doe@clinic.com',
          phone: '+1234567890',
          specialty: 'General Dentistry',
          licenseNumber: 'LIC-001',
          workingDays: ['MON', 'TUE', 'WED', 'THU', 'FRI'],
          workingHours: { start: '09:00', end: '18:00' },
          consultingRoom: 'Room 101',
          hourlyRate: 150.00,
        })

      expect(response.status).toBe(201)
      expect(response.body.success).toBe(true)
      expect(response.body.data.firstName).toBe('John')
      expect(response.body.data.lastName).toBe('Doe')
      expect(response.body.data.email).toBe('john.doe@clinic.com')
      expect(response.body.data.specialty).toBe('General Dentistry')
      expect(response.body.data.tenantId).toBe(tenantId)
    })

    it('should create a doctor with minimal data', async () => {
      const response = await request(app)
        .post('/api/doctors')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          firstName: 'Jane',
          lastName: 'Smith',
        })

      expect(response.status).toBe(201)
      expect(response.body.success).toBe(true)
      expect(response.body.data.firstName).toBe('Jane')
      expect(response.body.data.lastName).toBe('Smith')
    })

    it('should return 400 for missing required fields', async () => {
      const response = await request(app)
        .post('/api/doctors')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          firstName: 'Only',
        })

      expect(response.status).toBe(400)
      expect(response.body.success).toBe(false)
      expect(response.body.error.code).toBe('VALIDATION_ERROR')
    })

    it('should return 400 for invalid email format', async () => {
      const response = await request(app)
        .post('/api/doctors')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          firstName: 'Test',
          lastName: 'Doctor',
          email: 'not-an-email',
        })

      expect(response.status).toBe(400)
      expect(response.body.success).toBe(false)
    })

    it('should return 400 for invalid working hours format', async () => {
      const response = await request(app)
        .post('/api/doctors')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          firstName: 'Test',
          lastName: 'Doctor',
          workingHours: { start: '9am', end: '6pm' },
        })

      expect(response.status).toBe(400)
      expect(response.body.success).toBe(false)
    })

    it('should return 400 for invalid working days', async () => {
      const response = await request(app)
        .post('/api/doctors')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          firstName: 'Test',
          lastName: 'Doctor',
          workingDays: ['MONDAY', 'TUESDAY'],
        })

      expect(response.status).toBe(400)
      expect(response.body.success).toBe(false)
    })

    it('should return 403 for STAFF trying to create doctor', async () => {
      const response = await request(app)
        .post('/api/doctors')
        .set('Authorization', `Bearer ${staffToken}`)
        .send({
          firstName: 'Test',
          lastName: 'Doctor',
        })

      expect(response.status).toBe(403)
      expect(response.body.success).toBe(false)
    })

    it('should return 401 without authentication', async () => {
      const response = await request(app)
        .post('/api/doctors')
        .send({
          firstName: 'Test',
          lastName: 'Doctor',
        })

      expect(response.status).toBe(401)
    })

    it('should return 409 for duplicate email within tenant', async () => {
      // Create first doctor
      await request(app)
        .post('/api/doctors')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          firstName: 'First',
          lastName: 'Doctor',
          email: 'duplicate@clinic.com',
        })

      // Try to create second with same email
      const response = await request(app)
        .post('/api/doctors')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          firstName: 'Second',
          lastName: 'Doctor',
          email: 'duplicate@clinic.com',
        })

      expect(response.status).toBe(409)
      expect(response.body.error.code).toBe('DUPLICATE_EMAIL')
    })

    it('should return 409 for duplicate license number within tenant', async () => {
      // Create first doctor
      await request(app)
        .post('/api/doctors')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          firstName: 'First',
          lastName: 'Doctor',
          licenseNumber: 'LIC-DUPLICATE',
        })

      // Try to create second with same license
      const response = await request(app)
        .post('/api/doctors')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          firstName: 'Second',
          lastName: 'Doctor',
          licenseNumber: 'LIC-DUPLICATE',
        })

      expect(response.status).toBe(409)
      expect(response.body.error.code).toBe('DUPLICATE_LICENSE')
    })

    it('should return 403 when plan limit is exceeded', async () => {
      // Create 3 doctors (free plan limit)
      for (let i = 1; i <= 3; i++) {
        await prisma.doctor.create({
          data: {
            tenantId,
            firstName: `Doctor${i}`,
            lastName: 'Existing',
          },
        })
      }

      // Try to create 4th doctor
      const response = await request(app)
        .post('/api/doctors')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          firstName: 'Overflow',
          lastName: 'Doctor',
        })

      expect(response.status).toBe(403)
      expect(response.body.success).toBe(false)
      expect(response.body.error.code).toBe('PLAN_LIMIT_EXCEEDED')
      expect(response.body.error.currentCount).toBe(3)
      expect(response.body.error.limit).toBe(3)
    })
  })

  describe('GET /api/doctors', () => {
    beforeEach(async () => {
      // Create test doctors
      await prisma.doctor.createMany({
        data: [
          { tenantId, firstName: 'Alice', lastName: 'Brown', specialty: 'Orthodontics' },
          { tenantId, firstName: 'Bob', lastName: 'Smith', specialty: 'General Dentistry' },
          { tenantId, firstName: 'Charlie', lastName: 'Wilson', specialty: 'Orthodontics', isActive: false },
        ],
      })
    })

    it('should list active doctors (STAFF)', async () => {
      const response = await request(app)
        .get('/api/doctors')
        .set('Authorization', `Bearer ${staffToken}`)

      expect(response.status).toBe(200)
      expect(response.body.success).toBe(true)
      expect(response.body.data).toHaveLength(2) // Only active
    })

    it('should list all doctors including inactive', async () => {
      const response = await request(app)
        .get('/api/doctors?includeInactive=true')
        .set('Authorization', `Bearer ${staffToken}`)

      expect(response.status).toBe(200)
      expect(response.body.data).toHaveLength(3)
    })

    it('should filter doctors by search term', async () => {
      const response = await request(app)
        .get('/api/doctors?search=Orthodontics')
        .set('Authorization', `Bearer ${staffToken}`)

      expect(response.status).toBe(200)
      // Should find Alice (active with Orthodontics)
      expect(response.body.data.length).toBeGreaterThanOrEqual(1)
      expect(response.body.data.some((d: Record<string, unknown>) => d.firstName === 'Alice')).toBe(true)
    })

    it('should paginate results', async () => {
      const response = await request(app)
        .get('/api/doctors?limit=1&offset=1')
        .set('Authorization', `Bearer ${staffToken}`)

      expect(response.status).toBe(200)
      expect(response.body.data).toHaveLength(1)
    })

    it('should return 401 without authentication', async () => {
      const response = await request(app).get('/api/doctors')

      expect(response.status).toBe(401)
    })
  })

  describe('GET /api/doctors/:id', () => {
    let testDoctorId: string

    beforeEach(async () => {
      const doctor = await prisma.doctor.create({
        data: {
          tenantId,
          firstName: 'Single',
          lastName: 'Doctor',
          email: 'single@clinic.com',
        },
      })
      testDoctorId = doctor.id
    })

    it('should get a doctor by ID (STAFF)', async () => {
      const response = await request(app)
        .get(`/api/doctors/${testDoctorId}`)
        .set('Authorization', `Bearer ${staffToken}`)

      expect(response.status).toBe(200)
      expect(response.body.success).toBe(true)
      expect(response.body.data.id).toBe(testDoctorId)
      expect(response.body.data.firstName).toBe('Single')
    })

    it('should return 404 for non-existent doctor', async () => {
      const response = await request(app)
        .get('/api/doctors/non-existent-id')
        .set('Authorization', `Bearer ${staffToken}`)

      expect(response.status).toBe(404)
      expect(response.body.error.code).toBe('NOT_FOUND')
    })
  })

  describe('PUT /api/doctors/:id', () => {
    let testDoctorId: string

    beforeEach(async () => {
      const doctor = await prisma.doctor.create({
        data: {
          tenantId,
          firstName: 'Update',
          lastName: 'Test',
          email: 'update@clinic.com',
        },
      })
      testDoctorId = doctor.id
    })

    it('should update a doctor (ADMIN)', async () => {
      const response = await request(app)
        .put(`/api/doctors/${testDoctorId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          firstName: 'Updated',
          specialty: 'Pediatric Dentistry',
        })

      expect(response.status).toBe(200)
      expect(response.body.success).toBe(true)
      expect(response.body.data.firstName).toBe('Updated')
      expect(response.body.data.specialty).toBe('Pediatric Dentistry')
    })

    it('should allow setting nullable fields to null', async () => {
      // First set a value
      await prisma.doctor.update({
        where: { id: testDoctorId },
        data: { specialty: 'Some Specialty' },
      })

      const response = await request(app)
        .put(`/api/doctors/${testDoctorId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          specialty: null,
        })

      expect(response.status).toBe(200)
      expect(response.body.data.specialty).toBeNull()
    })

    it('should return 403 for STAFF trying to update', async () => {
      const response = await request(app)
        .put(`/api/doctors/${testDoctorId}`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({
          firstName: 'Hacked',
        })

      expect(response.status).toBe(403)
    })

    it('should return 404 for non-existent doctor', async () => {
      const response = await request(app)
        .put('/api/doctors/non-existent-id')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          firstName: 'Test',
        })

      expect(response.status).toBe(404)
    })
  })

  describe('DELETE /api/doctors/:id', () => {
    let testDoctorId: string

    beforeEach(async () => {
      const doctor = await prisma.doctor.create({
        data: {
          tenantId,
          firstName: 'Delete',
          lastName: 'Test',
        },
      })
      testDoctorId = doctor.id
    })

    it('should soft delete a doctor (ADMIN)', async () => {
      const response = await request(app)
        .delete(`/api/doctors/${testDoctorId}`)
        .set('Authorization', `Bearer ${adminToken}`)

      expect(response.status).toBe(200)
      expect(response.body.success).toBe(true)

      // Verify soft delete
      const doctor = await prisma.doctor.findUnique({ where: { id: testDoctorId } })
      expect(doctor?.isActive).toBe(false)
    })

    it('should return 400 when trying to delete already inactive doctor', async () => {
      // First delete
      await request(app)
        .delete(`/api/doctors/${testDoctorId}`)
        .set('Authorization', `Bearer ${adminToken}`)

      // Try again
      const response = await request(app)
        .delete(`/api/doctors/${testDoctorId}`)
        .set('Authorization', `Bearer ${adminToken}`)

      expect(response.status).toBe(400)
      expect(response.body.error.code).toBe('ALREADY_INACTIVE')
    })

    it('should return 403 for STAFF trying to delete', async () => {
      const response = await request(app)
        .delete(`/api/doctors/${testDoctorId}`)
        .set('Authorization', `Bearer ${staffToken}`)

      expect(response.status).toBe(403)
    })

    it('should return 404 for non-existent doctor', async () => {
      const response = await request(app)
        .delete('/api/doctors/non-existent-id')
        .set('Authorization', `Bearer ${adminToken}`)

      expect(response.status).toBe(404)
    })
  })

  describe('PUT /api/doctors/:id/restore', () => {
    let inactiveDoctorId: string

    beforeEach(async () => {
      const doctor = await prisma.doctor.create({
        data: {
          tenantId,
          firstName: 'Restore',
          lastName: 'Test',
          isActive: false,
        },
      })
      inactiveDoctorId = doctor.id
    })

    it('should restore a soft-deleted doctor (ADMIN)', async () => {
      const response = await request(app)
        .put(`/api/doctors/${inactiveDoctorId}/restore`)
        .set('Authorization', `Bearer ${adminToken}`)

      expect(response.status).toBe(200)
      expect(response.body.success).toBe(true)
      expect(response.body.data.isActive).toBe(true)

      // Verify in database
      const doctor = await prisma.doctor.findUnique({ where: { id: inactiveDoctorId } })
      expect(doctor?.isActive).toBe(true)
    })

    it('should return 400 when trying to restore already active doctor', async () => {
      // First restore
      await request(app)
        .put(`/api/doctors/${inactiveDoctorId}/restore`)
        .set('Authorization', `Bearer ${adminToken}`)

      // Try again
      const response = await request(app)
        .put(`/api/doctors/${inactiveDoctorId}/restore`)
        .set('Authorization', `Bearer ${adminToken}`)

      expect(response.status).toBe(400)
      expect(response.body.error.code).toBe('ALREADY_ACTIVE')
    })

    it('should return 403 when restoring would exceed plan limit', async () => {
      // Create 3 active doctors (free plan limit)
      for (let i = 1; i <= 3; i++) {
        await prisma.doctor.create({
          data: {
            tenantId,
            firstName: `Doctor${i}`,
            lastName: 'Active',
            isActive: true,
          },
        })
      }

      // Try to restore the inactive doctor (would be 4th)
      const response = await request(app)
        .put(`/api/doctors/${inactiveDoctorId}/restore`)
        .set('Authorization', `Bearer ${adminToken}`)

      expect(response.status).toBe(403)
      expect(response.body.error.code).toBe('PLAN_LIMIT_EXCEEDED')
    })

    it('should return 403 for STAFF trying to restore', async () => {
      const response = await request(app)
        .put(`/api/doctors/${inactiveDoctorId}/restore`)
        .set('Authorization', `Bearer ${staffToken}`)

      expect(response.status).toBe(403)
    })
  })

  describe('GET /api/doctors/stats', () => {
    beforeEach(async () => {
      // Create mix of active and inactive doctors
      await prisma.doctor.createMany({
        data: [
          { tenantId, firstName: 'Active1', lastName: 'Doc', isActive: true },
          { tenantId, firstName: 'Active2', lastName: 'Doc', isActive: true },
          { tenantId, firstName: 'Inactive1', lastName: 'Doc', isActive: false },
        ],
      })
    })

    it('should return doctor stats (ADMIN)', async () => {
      const response = await request(app)
        .get('/api/doctors/stats')
        .set('Authorization', `Bearer ${adminToken}`)

      expect(response.status).toBe(200)
      expect(response.body.success).toBe(true)
      expect(response.body.data.active).toBe(2)
      expect(response.body.data.inactive).toBe(1)
      expect(response.body.data.total).toBe(3)
      expect(response.body.data.limit).toBe(3) // free plan
      expect(response.body.data.remaining).toBe(1) // 3 - 2 active = 1
    })

    it('should return 403 for STAFF trying to get stats', async () => {
      const response = await request(app)
        .get('/api/doctors/stats')
        .set('Authorization', `Bearer ${staffToken}`)

      expect(response.status).toBe(403)
    })
  })
})
