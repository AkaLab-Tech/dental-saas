import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { api } from '../test/http.js'
import { prisma } from '@dental/database'
import { hashPassword } from '../services/auth.service.js'
import { sign } from 'jsonwebtoken'

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret'

describe('Patients API', () => {
  let tenantId: string
  let adminUserId: string
  let staffUserId: string
  let adminToken: string
  let staffToken: string
  const testSlug = `test-clinic-patients-${Date.now()}`

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
        name: 'Test Clinic for Patients',
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
        email: 'admin-patients@test.com',
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
        email: 'staff-patients@test.com',
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
    await prisma.appointment.deleteMany({ where: { tenantId } })
    await prisma.patient.deleteMany({ where: { tenantId } })
    await prisma.doctor.deleteMany({ where: { tenantId } })
    await prisma.refreshToken.deleteMany({ where: { userId: { in: [adminUserId, staffUserId] } } })
    await prisma.user.deleteMany({ where: { tenantId } })
    await prisma.subscription.deleteMany({ where: { tenantId } })
    await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {})
  })

  beforeEach(async () => {
    // Clean up patients before each test
    await prisma.appointment.deleteMany({ where: { tenantId } })
    await prisma.patient.deleteMany({ where: { tenantId } })
  })

  describe('POST /api/patients', () => {
    it('should create a patient with valid data (ADMIN)', async () => {
      const response = await api()
        .post('/api/patients')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          firstName: 'John',
          lastName: 'Doe',
          email: 'john.doe@email.com',
          phone: '+1234567890',
          dob: '1990-05-15',
          gender: 'male',
          address: '123 Main St, City, Country',
        })

      expect(response.status).toBe(201)
      expect(response.body.success).toBe(true)
      expect(response.body.data.firstName).toBe('John')
      expect(response.body.data.lastName).toBe('Doe')
      expect(response.body.data.email).toBe('john.doe@email.com')
      expect(response.body.data.gender).toBe('male')
      expect(response.body.data.tenantId).toBe(tenantId)
    })

    it('should create a patient with minimal data', async () => {
      const response = await api()
        .post('/api/patients')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          firstName: 'Jane',
          lastName: 'Smith',
        })

      expect(response.status).toBe(201)
      expect(response.body.success).toBe(true)
      expect(response.body.data.firstName).toBe('Jane')
      expect(response.body.data.lastName).toBe('Smith')
      // No dob → showPrimaryTeeth defaults to false
      expect(response.body.data.showPrimaryTeeth).toBe(false)
    })

    it('should default showPrimaryTeeth=true for patients under 12', async () => {
      const childDob = new Date()
      childDob.setFullYear(childDob.getFullYear() - 8)

      const response = await api()
        .post('/api/patients')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          firstName: 'Child',
          lastName: 'Patient',
          dob: childDob.toISOString().split('T')[0],
        })

      expect(response.status).toBe(201)
      expect(response.body.data.showPrimaryTeeth).toBe(true)
    })

    it('should default showPrimaryTeeth=false for patients 12+', async () => {
      const adultDob = new Date()
      adultDob.setFullYear(adultDob.getFullYear() - 25)

      const response = await api()
        .post('/api/patients')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          firstName: 'Adult',
          lastName: 'Patient',
          dob: adultDob.toISOString().split('T')[0],
        })

      expect(response.status).toBe(201)
      expect(response.body.data.showPrimaryTeeth).toBe(false)
    })

    it('should return 400 for missing required fields', async () => {
      const response = await api()
        .post('/api/patients')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          firstName: 'Only',
        })

      expect(response.status).toBe(400)
      expect(response.body.success).toBe(false)
      expect(response.body.error.code).toBe('VALIDATION_ERROR')
    })

    it('should return 400 for invalid email format', async () => {
      const response = await api()
        .post('/api/patients')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          firstName: 'Test',
          lastName: 'Patient',
          email: 'not-an-email',
        })

      expect(response.status).toBe(400)
      expect(response.body.success).toBe(false)
    })

    it('should return 400 for invalid date format', async () => {
      const response = await api()
        .post('/api/patients')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          firstName: 'Test',
          lastName: 'Patient',
          dob: 'invalid-date',
        })

      expect(response.status).toBe(400)
      expect(response.body.success).toBe(false)
    })

    it('should return 400 for date of birth in the future', async () => {
      const futureDate = new Date()
      futureDate.setFullYear(futureDate.getFullYear() + 1)
      const response = await api()
        .post('/api/patients')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          firstName: 'Test',
          lastName: 'Patient',
          dob: futureDate.toISOString().split('T')[0],
        })

      expect(response.status).toBe(400)
      expect(response.body.success).toBe(false)
    })

    it('should return 400 for invalid gender', async () => {
      const response = await api()
        .post('/api/patients')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          firstName: 'Test',
          lastName: 'Patient',
          gender: 'invalid',
        })

      expect(response.status).toBe(400)
      expect(response.body.success).toBe(false)
    })

    it('should return 403 for STAFF trying to create patient', async () => {
      const response = await api()
        .post('/api/patients')
        .set('Authorization', `Bearer ${staffToken}`)
        .send({
          firstName: 'Test',
          lastName: 'Patient',
        })

      expect(response.status).toBe(403)
      expect(response.body.success).toBe(false)
    })

    it('should return 401 without authentication', async () => {
      const response = await api()
        .post('/api/patients')
        .send({
          firstName: 'Test',
          lastName: 'Patient',
        })

      expect(response.status).toBe(401)
    })

    it('should return 409 for duplicate email within tenant', async () => {
      // Create first patient
      await api()
        .post('/api/patients')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          firstName: 'First',
          lastName: 'Patient',
          email: 'duplicate@email.com',
        })

      // Try to create second with same email
      const response = await api()
        .post('/api/patients')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          firstName: 'Second',
          lastName: 'Patient',
          email: 'duplicate@email.com',
        })

      expect(response.status).toBe(409)
      expect(response.body.error.code).toBe('DUPLICATE_EMAIL')
    })

    it('should return 403 when plan limit is exceeded', async () => {
      // Create 50 patients (free plan limit)
      for (let i = 1; i <= 50; i++) {
        await prisma.patient.create({
          data: {
            tenantId,
            firstName: `Patient${i}`,
            lastName: 'Existing',
          },
        })
      }

      // Try to create 51st patient
      const response = await api()
        .post('/api/patients')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          firstName: 'Overflow',
          lastName: 'Patient',
        })

      expect(response.status).toBe(403)
      expect(response.body.success).toBe(false)
      expect(response.body.error.code).toBe('PLAN_LIMIT_EXCEEDED')
      expect(response.body.error.currentCount).toBe(50)
      expect(response.body.error.limit).toBe(50)
    })
  })

  describe('GET /api/patients', () => {
    beforeEach(async () => {
      // Create test patients
      await prisma.patient.createMany({
        data: [
          { tenantId, firstName: 'Alice', lastName: 'Brown', phone: '+111' },
          { tenantId, firstName: 'Bob', lastName: 'Smith', email: 'bob@email.com' },
          { tenantId, firstName: 'Charlie', lastName: 'Wilson', isActive: false },
        ],
      })
    })

    it('should list active patients (STAFF)', async () => {
      const response = await api()
        .get('/api/patients')
        .set('Authorization', `Bearer ${staffToken}`)

      expect(response.status).toBe(200)
      expect(response.body.success).toBe(true)
      expect(response.body.data).toHaveLength(2) // Only active
    })

    it('should list all patients including inactive', async () => {
      const response = await api()
        .get('/api/patients?includeInactive=true')
        .set('Authorization', `Bearer ${staffToken}`)

      expect(response.status).toBe(200)
      expect(response.body.data).toHaveLength(3)
    })

    it('should filter patients by search term', async () => {
      const response = await api()
        .get('/api/patients?search=Bob')
        .set('Authorization', `Bearer ${staffToken}`)

      expect(response.status).toBe(200)
      expect(response.body.data.length).toBeGreaterThanOrEqual(1)
      expect(response.body.data.some((p: { firstName: string }) => p.firstName === 'Bob')).toBe(true)
    })

    it('should paginate results', async () => {
      const response = await api()
        .get('/api/patients?limit=1&offset=1')
        .set('Authorization', `Bearer ${staffToken}`)

      expect(response.status).toBe(200)
      expect(response.body.data).toHaveLength(1)
    })

    it('should return 401 without authentication', async () => {
      const response = await api().get('/api/patients')

      expect(response.status).toBe(401)
    })
  })

  describe('GET /api/patients/:id', () => {
    let testPatientId: string

    beforeEach(async () => {
      const patient = await prisma.patient.create({
        data: {
          tenantId,
          firstName: 'Single',
          lastName: 'Patient',
          email: 'single@email.com',
        },
      })
      testPatientId = patient.id
    })

    it('should get a patient by ID (STAFF)', async () => {
      const response = await api()
        .get(`/api/patients/${testPatientId}`)
        .set('Authorization', `Bearer ${staffToken}`)

      expect(response.status).toBe(200)
      expect(response.body.success).toBe(true)
      expect(response.body.data.id).toBe(testPatientId)
      expect(response.body.data.firstName).toBe('Single')
    })

    it('should return 404 for non-existent patient', async () => {
      const response = await api()
        .get('/api/patients/non-existent-id')
        .set('Authorization', `Bearer ${staffToken}`)

      expect(response.status).toBe(404)
      expect(response.body.error.code).toBe('NOT_FOUND')
    })
  })

  describe('GET /api/patients/:id/appointments', () => {
    let testPatientId: string
    let testDoctorId: string

    beforeEach(async () => {
      // Create a patient
      const patient = await prisma.patient.create({
        data: {
          tenantId,
          firstName: 'Appointment',
          lastName: 'Patient',
        },
      })
      testPatientId = patient.id

      // Create a doctor
      const doctor = await prisma.doctor.create({
        data: {
          tenantId,
          firstName: 'Test',
          lastName: 'Doctor',
        },
      })
      testDoctorId = doctor.id

      // Create some appointments
      await prisma.appointment.createMany({
        data: [
          {
            tenantId,
            patientId: testPatientId,
            doctorId: testDoctorId,
            startTime: new Date('2026-01-15T10:00:00Z'),
            endTime: new Date('2026-01-15T10:30:00Z'),
            status: 'SCHEDULED',
          },
          {
            tenantId,
            patientId: testPatientId,
            doctorId: testDoctorId,
            startTime: new Date('2026-01-16T14:00:00Z'),
            endTime: new Date('2026-01-16T14:30:00Z'),
            status: 'COMPLETED',
          },
        ],
      })
    })

    afterEach(async () => {
      await prisma.appointment.deleteMany({ where: { tenantId } })
      await prisma.doctor.deleteMany({ where: { tenantId } })
    })

    it('should get patient appointments (STAFF)', async () => {
      const response = await api()
        .get(`/api/patients/${testPatientId}/appointments`)
        .set('Authorization', `Bearer ${staffToken}`)

      expect(response.status).toBe(200)
      expect(response.body.success).toBe(true)
      expect(response.body.data).toHaveLength(2)
      expect(response.body.data[0].doctor).toBeDefined()
      expect(response.body.data[0].doctor.firstName).toBe('Test')
    })

    it('should return 404 for non-existent patient', async () => {
      const response = await api()
        .get('/api/patients/non-existent-id/appointments')
        .set('Authorization', `Bearer ${staffToken}`)

      expect(response.status).toBe(404)
      expect(response.body.error.code).toBe('NOT_FOUND')
    })
  })

  describe('PUT /api/patients/:id', () => {
    let testPatientId: string

    beforeEach(async () => {
      const patient = await prisma.patient.create({
        data: {
          tenantId,
          firstName: 'Update',
          lastName: 'Test',
          email: 'update@email.com',
        },
      })
      testPatientId = patient.id
    })

    it('should update a patient (ADMIN)', async () => {
      const response = await api()
        .put(`/api/patients/${testPatientId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          firstName: 'Updated',
          phone: '+9876543210',
        })

      expect(response.status).toBe(200)
      expect(response.body.success).toBe(true)
      expect(response.body.data.firstName).toBe('Updated')
      expect(response.body.data.phone).toBe('+9876543210')
    })

    it('should allow setting nullable fields to null', async () => {
      // First set a value
      await prisma.patient.update({
        where: { id: testPatientId },
        data: { phone: '+123456' },
      })

      const response = await api()
        .put(`/api/patients/${testPatientId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          phone: null,
        })

      expect(response.status).toBe(200)
      expect(response.body.data.phone).toBeNull()
    })

    it('should return 403 for STAFF trying to update', async () => {
      const response = await api()
        .put(`/api/patients/${testPatientId}`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({
          firstName: 'Hacked',
        })

      expect(response.status).toBe(403)
    })

    it('should return 404 for non-existent patient', async () => {
      const response = await api()
        .put('/api/patients/non-existent-id')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          firstName: 'Test',
        })

      expect(response.status).toBe(404)
    })
  })

  describe('DELETE /api/patients/:id', () => {
    let testPatientId: string

    beforeEach(async () => {
      const patient = await prisma.patient.create({
        data: {
          tenantId,
          firstName: 'Delete',
          lastName: 'Test',
        },
      })
      testPatientId = patient.id
    })

    it('should soft delete a patient (ADMIN)', async () => {
      const response = await api()
        .delete(`/api/patients/${testPatientId}`)
        .set('Authorization', `Bearer ${adminToken}`)

      expect(response.status).toBe(200)
      expect(response.body.success).toBe(true)

      // Verify soft delete
      const patient = await prisma.patient.findUnique({ where: { id: testPatientId } })
      expect(patient?.isActive).toBe(false)
    })

    it('should return 400 when trying to delete already inactive patient', async () => {
      // First delete
      await api()
        .delete(`/api/patients/${testPatientId}`)
        .set('Authorization', `Bearer ${adminToken}`)

      // Try again
      const response = await api()
        .delete(`/api/patients/${testPatientId}`)
        .set('Authorization', `Bearer ${adminToken}`)

      expect(response.status).toBe(400)
      expect(response.body.error.code).toBe('ALREADY_INACTIVE')
    })

    it('should return 403 for STAFF trying to delete', async () => {
      const response = await api()
        .delete(`/api/patients/${testPatientId}`)
        .set('Authorization', `Bearer ${staffToken}`)

      expect(response.status).toBe(403)
    })

    it('should return 404 for non-existent patient', async () => {
      const response = await api()
        .delete('/api/patients/non-existent-id')
        .set('Authorization', `Bearer ${adminToken}`)

      expect(response.status).toBe(404)
    })
  })

  describe('PUT /api/patients/:id/restore', () => {
    let inactivePatientId: string

    beforeEach(async () => {
      const patient = await prisma.patient.create({
        data: {
          tenantId,
          firstName: 'Restore',
          lastName: 'Test',
          isActive: false,
        },
      })
      inactivePatientId = patient.id
    })

    it('should restore a soft-deleted patient (ADMIN)', async () => {
      const response = await api()
        .put(`/api/patients/${inactivePatientId}/restore`)
        .set('Authorization', `Bearer ${adminToken}`)

      expect(response.status).toBe(200)
      expect(response.body.success).toBe(true)
      expect(response.body.data.isActive).toBe(true)

      // Verify in database
      const patient = await prisma.patient.findUnique({ where: { id: inactivePatientId } })
      expect(patient?.isActive).toBe(true)
    })

    it('should return 400 when trying to restore already active patient', async () => {
      // First restore
      await api()
        .put(`/api/patients/${inactivePatientId}/restore`)
        .set('Authorization', `Bearer ${adminToken}`)

      // Try again
      const response = await api()
        .put(`/api/patients/${inactivePatientId}/restore`)
        .set('Authorization', `Bearer ${adminToken}`)

      expect(response.status).toBe(400)
      expect(response.body.error.code).toBe('ALREADY_ACTIVE')
    })

    it('should return 403 when restoring would exceed plan limit', async () => {
      // Create 50 active patients (free plan limit)
      for (let i = 1; i <= 50; i++) {
        await prisma.patient.create({
          data: {
            tenantId,
            firstName: `Patient${i}`,
            lastName: 'Active',
            isActive: true,
          },
        })
      }

      // Try to restore the inactive patient (would be 16th)
      const response = await api()
        .put(`/api/patients/${inactivePatientId}/restore`)
        .set('Authorization', `Bearer ${adminToken}`)

      expect(response.status).toBe(403)
      expect(response.body.error.code).toBe('PLAN_LIMIT_EXCEEDED')
    })

    it('should return 403 for STAFF trying to restore', async () => {
      const response = await api()
        .put(`/api/patients/${inactivePatientId}/restore`)
        .set('Authorization', `Bearer ${staffToken}`)

      expect(response.status).toBe(403)
    })
  })

  describe('GET /api/patients/stats', () => {
    beforeEach(async () => {
      // Create mix of active and inactive patients
      await prisma.patient.createMany({
        data: [
          { tenantId, firstName: 'Active1', lastName: 'Pat', isActive: true },
          { tenantId, firstName: 'Active2', lastName: 'Pat', isActive: true },
          { tenantId, firstName: 'Inactive1', lastName: 'Pat', isActive: false },
        ],
      })
    })

    it('should return patient stats (ADMIN)', async () => {
      const response = await api()
        .get('/api/patients/stats')
        .set('Authorization', `Bearer ${adminToken}`)

      expect(response.status).toBe(200)
      expect(response.body.success).toBe(true)
      expect(response.body.data.active).toBe(2)
      expect(response.body.data.inactive).toBe(1)
      expect(response.body.data.total).toBe(3)
      expect(response.body.data.limit).toBe(50) // free plan
      expect(response.body.data.remaining).toBe(48) // 50 - 2 active = 48
    })

    it('should return 403 for STAFF trying to get stats', async () => {
      const response = await api()
        .get('/api/patients/stats')
        .set('Authorization', `Bearer ${staffToken}`)

      expect(response.status).toBe(403)
    })
  })

  // ==========================================================================
  // DENTAL CHART (TEETH) TESTS
  // ==========================================================================

  describe('GET /api/patients/:id/teeth', () => {
    let patientId: string

    beforeEach(async () => {
      const patient = await prisma.patient.create({
        data: {
          tenantId,
          firstName: 'Teeth',
          lastName: 'Test',
          teeth: {
            '11': { note: 'Crown needed', status: 'crown' },
            '21': { note: 'Healthy', status: 'healthy' },
          },
        },
      })
      patientId = patient.id
    })

    it('should return teeth data for a patient', async () => {
      const response = await api()
        .get(`/api/patients/${patientId}/teeth`)
        .set('Authorization', `Bearer ${staffToken}`)

      expect(response.status).toBe(200)
      expect(response.body.success).toBe(true)
      expect(response.body.data).toEqual({
        '11': { note: 'Crown needed', status: 'crown' },
        '21': { note: 'Healthy', status: 'healthy' },
      })
    })

    it('should return empty object for patient without teeth data', async () => {
      const patientNoTeeth = await prisma.patient.create({
        data: {
          tenantId,
          firstName: 'No',
          lastName: 'Teeth',
        },
      })

      const response = await api()
        .get(`/api/patients/${patientNoTeeth.id}/teeth`)
        .set('Authorization', `Bearer ${staffToken}`)

      expect(response.status).toBe(200)
      expect(response.body.success).toBe(true)
      expect(response.body.data).toEqual({})
    })

    it('should return 404 for non-existent patient', async () => {
      const response = await api()
        .get('/api/patients/non-existent-id/teeth')
        .set('Authorization', `Bearer ${staffToken}`)

      expect(response.status).toBe(404)
      expect(response.body.success).toBe(false)
    })

    it('should return 401 for unauthenticated request', async () => {
      const response = await api()
        .get(`/api/patients/${patientId}/teeth`)

      expect(response.status).toBe(401)
    })
  })

  describe('PATCH /api/patients/:id/teeth', () => {
    let patientId: string

    beforeEach(async () => {
      const patient = await prisma.patient.create({
        data: {
          tenantId,
          firstName: 'Teeth',
          lastName: 'Update',
          teeth: { '11': { note: 'Existing note', status: 'healthy' } },
        },
      })
      patientId = patient.id
    })

    it('should update teeth data for a patient', async () => {
      const response = await api()
        .patch(`/api/patients/${patientId}/teeth`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({
          '21': { note: 'New cavity', status: 'caries' },
          '31': { note: 'Root canal', status: 'root_canal' },
        })

      expect(response.status).toBe(200)
      expect(response.body.success).toBe(true)
      expect(response.body.data.teeth).toEqual({
        '11': { note: 'Existing note', status: 'healthy' },
        '21': { note: 'New cavity', status: 'caries' },
        '31': { note: 'Root canal', status: 'root_canal' },
      })
    })

    it('should merge new teeth data with existing', async () => {
      const response = await api()
        .patch(`/api/patients/${patientId}/teeth`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({
          '11': { note: 'Updated note', status: 'filled' },
          '22': { note: 'Another note', status: 'healthy' },
        })

      expect(response.status).toBe(200)
      expect(response.body.data.teeth).toEqual({
        '11': { note: 'Updated note', status: 'filled' },
        '22': { note: 'Another note', status: 'healthy' },
      })
    })

    it('should remove tooth data when note is empty and status is healthy', async () => {
      // First add a tooth entry
      await api()
        .patch(`/api/patients/${patientId}/teeth`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ '21': { note: 'To be removed', status: 'caries' } })

      // Then remove it (empty note + healthy status)
      const response = await api()
        .patch(`/api/patients/${patientId}/teeth`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ '21': { note: '', status: 'healthy' } })

      expect(response.status).toBe(200)
      expect(response.body.data.teeth['21']).toBeUndefined()
      expect(response.body.data.teeth['11']).toEqual({ note: 'Existing note', status: 'healthy' })
    })

    it('should return 400 for invalid tooth number', async () => {
      const response = await api()
        .patch(`/api/patients/${patientId}/teeth`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ '99': { note: 'Invalid tooth', status: 'healthy' } })

      expect(response.status).toBe(400)
      expect(response.body.success).toBe(false)
    })

    it('should return 400 for note exceeding 1000 characters', async () => {
      const longNote = 'a'.repeat(1001)
      const response = await api()
        .patch(`/api/patients/${patientId}/teeth`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ '11': { note: longNote, status: 'healthy' } })

      expect(response.status).toBe(400)
      expect(response.body.success).toBe(false)
    })

    it('should return 400 for invalid tooth status', async () => {
      const response = await api()
        .patch(`/api/patients/${patientId}/teeth`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ '11': { note: 'Test', status: 'invalid_status' } })

      expect(response.status).toBe(400)
      expect(response.body.success).toBe(false)
    })

    it('should update tooth status without note', async () => {
      const response = await api()
        .patch(`/api/patients/${patientId}/teeth`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ '12': { note: '', status: 'missing' } })

      expect(response.status).toBe(200)
      expect(response.body.data.teeth['12']).toEqual({ note: '', status: 'missing' })
    })

    it('should return 404 for non-existent patient', async () => {
      const response = await api()
        .patch('/api/patients/non-existent-id/teeth')
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ '11': { note: 'Test', status: 'healthy' } })

      expect(response.status).toBe(404)
    })

    it('should allow ADMIN to update teeth', async () => {
      const response = await api()
        .patch(`/api/patients/${patientId}/teeth`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ '41': { note: 'Admin note', status: 'caries' } })

      expect(response.status).toBe(200)
      expect(response.body.data.teeth['41']).toEqual({ note: 'Admin note', status: 'caries' })
    })

    it('should support primary teeth notation (51-85)', async () => {
      const response = await api()
        .patch(`/api/patients/${patientId}/teeth`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({
          '51': { note: 'Primary tooth note', status: 'healthy' },
          '75': { note: 'Another primary', status: 'caries' },
        })

      expect(response.status).toBe(200)
      expect(response.body.data.teeth['51']).toEqual({ note: 'Primary tooth note', status: 'healthy' })
      expect(response.body.data.teeth['75']).toEqual({ note: 'Another primary', status: 'caries' })
    })
  })

  describe('PATCH /api/patients/:id/show-primary-teeth', () => {
    let patientId: string

    beforeEach(async () => {
      const patient = await prisma.patient.create({
        data: {
          tenantId,
          firstName: 'Primary',
          lastName: 'Toggle',
          showPrimaryTeeth: false,
        },
      })
      patientId = patient.id
    })

    it('should enable showPrimaryTeeth (STAFF)', async () => {
      const response = await api()
        .patch(`/api/patients/${patientId}/show-primary-teeth`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ showPrimaryTeeth: true })

      expect(response.status).toBe(200)
      expect(response.body.success).toBe(true)
      expect(response.body.data).toEqual({ showPrimaryTeeth: true })

      const persisted = await prisma.patient.findUnique({ where: { id: patientId } })
      expect(persisted?.showPrimaryTeeth).toBe(true)
    })

    it('should disable showPrimaryTeeth', async () => {
      await prisma.patient.update({
        where: { id: patientId },
        data: { showPrimaryTeeth: true },
      })

      const response = await api()
        .patch(`/api/patients/${patientId}/show-primary-teeth`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ showPrimaryTeeth: false })

      expect(response.status).toBe(200)
      expect(response.body.data.showPrimaryTeeth).toBe(false)
    })

    it('should return 400 for invalid payload (missing field)', async () => {
      const response = await api()
        .patch(`/api/patients/${patientId}/show-primary-teeth`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({})

      expect(response.status).toBe(400)
      expect(response.body.success).toBe(false)
    })

    it('should return 400 for invalid payload (wrong type)', async () => {
      const response = await api()
        .patch(`/api/patients/${patientId}/show-primary-teeth`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ showPrimaryTeeth: 'yes' })

      expect(response.status).toBe(400)
    })

    it('should return 404 for non-existent patient', async () => {
      const response = await api()
        .patch('/api/patients/non-existent-id/show-primary-teeth')
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ showPrimaryTeeth: true })

      expect(response.status).toBe(404)
    })

    it('should return 401 without authentication', async () => {
      const response = await api()
        .patch(`/api/patients/${patientId}/show-primary-teeth`)
        .send({ showPrimaryTeeth: true })

      expect(response.status).toBe(401)
    })
  })
})
