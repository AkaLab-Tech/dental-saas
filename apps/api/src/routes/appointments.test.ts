import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import { app } from '../app.js'
import { prisma } from '@dental/database'
import { hashPassword } from '../services/auth.service.js'
import { sign } from 'jsonwebtoken'

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret'

describe('Appointments API', () => {
  let tenantId: string
  let adminUserId: string
  let staffUserId: string
  let adminToken: string
  let staffToken: string
  let patientId: string
  let doctorId: string
  let patient2Id: string
  let doctor2Id: string
  const testSlug = `test-clinic-appointments-${Date.now()}`

  // Helper to generate JWT token
  function generateToken(userId: string, tenantId: string, role: string) {
    return sign({ sub: userId, tenantId, role }, JWT_SECRET, { expiresIn: '1h' })
  }

  // Helper to create an appointment time in the future
  function getFutureTime(daysFromNow: number, hour: number = 10): { startTime: string; endTime: string } {
    const start = new Date()
    start.setDate(start.getDate() + daysFromNow)
    start.setHours(hour, 0, 0, 0)
    const end = new Date(start)
    end.setMinutes(end.getMinutes() + 30)
    return {
      startTime: start.toISOString(),
      endTime: end.toISOString(),
    }
  }

  beforeAll(async () => {
    // Create a test tenant with a free plan subscription
    const tenant = await prisma.tenant.create({
      data: {
        name: 'Test Clinic for Appointments',
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
          maxPatients: 15,
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
        email: 'admin-appointments@test.com',
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
        email: 'staff-appointments@test.com',
        passwordHash,
        firstName: 'Staff',
        lastName: 'User',
        role: 'STAFF',
        tenantId: tenant.id,
      },
    })
    staffUserId = staff.id
    staffToken = generateToken(staff.id, tenant.id, 'STAFF')

    // Create test patients
    const patient = await prisma.patient.create({
      data: {
        tenantId,
        firstName: 'Test',
        lastName: 'Patient',
        email: 'patient@test.com',
      },
    })
    patientId = patient.id

    const patient2 = await prisma.patient.create({
      data: {
        tenantId,
        firstName: 'Another',
        lastName: 'Patient',
        email: 'patient2@test.com',
      },
    })
    patient2Id = patient2.id

    // Create test doctors
    const doctor = await prisma.doctor.create({
      data: {
        tenantId,
        firstName: 'Dr. Test',
        lastName: 'Doctor',
        email: 'doctor@test.com',
        specialty: 'General Dentistry',
      },
    })
    doctorId = doctor.id

    const doctor2 = await prisma.doctor.create({
      data: {
        tenantId,
        firstName: 'Dr. Another',
        lastName: 'Dentist',
        email: 'doctor2@test.com',
        specialty: 'Orthodontics',
      },
    })
    doctor2Id = doctor2.id
  })

  afterAll(async () => {
    // Clean up in correct order
    await prisma.patientPayment.deleteMany({ where: { tenantId } })
    await prisma.appointment.deleteMany({ where: { tenantId } })
    await prisma.patient.deleteMany({ where: { tenantId } })
    await prisma.doctor.deleteMany({ where: { tenantId } })
    await prisma.refreshToken.deleteMany({ where: { userId: { in: [adminUserId, staffUserId] } } })
    await prisma.user.deleteMany({ where: { tenantId } })
    await prisma.subscription.deleteMany({ where: { tenantId } })
    await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {})
  })

  beforeEach(async () => {
    // Clean up appointments and auto-payments before each test
    await prisma.patientPayment.deleteMany({ where: { tenantId } })
    await prisma.appointment.deleteMany({ where: { tenantId } })
  })

  // ============================================================================
  // CREATE TESTS
  // ============================================================================

  describe('POST /api/appointments', () => {
    it('should create an appointment with valid data (ADMIN)', async () => {
      const times = getFutureTime(1)
      const response = await request(app)
        .post('/api/appointments')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          patientId,
          doctorId,
          ...times,
          type: 'Checkup',
          notes: 'Regular dental checkup',
        })

      expect(response.status).toBe(201)
      expect(response.body.success).toBe(true)
      expect(response.body.data.patientId).toBe(patientId)
      expect(response.body.data.doctorId).toBe(doctorId)
      expect(response.body.data.status).toBe('SCHEDULED')
      expect(response.body.data.type).toBe('Checkup')
      expect(response.body.data.patient).toBeDefined()
      expect(response.body.data.doctor).toBeDefined()
    })

    it('should create an appointment with minimal data', async () => {
      const times = getFutureTime(2)
      const response = await request(app)
        .post('/api/appointments')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          patientId,
          doctorId,
          ...times,
        })

      expect(response.status).toBe(201)
      expect(response.body.success).toBe(true)
      expect(response.body.data.duration).toBe(30) // Calculated from time range
    })

    it('should calculate duration automatically', async () => {
      const start = new Date()
      start.setDate(start.getDate() + 1)
      start.setHours(14, 0, 0, 0)
      const end = new Date(start)
      end.setHours(15, 0, 0, 0) // 1 hour = 60 minutes

      const response = await request(app)
        .post('/api/appointments')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          patientId,
          doctorId,
          startTime: start.toISOString(),
          endTime: end.toISOString(),
        })

      expect(response.status).toBe(201)
      expect(response.body.data.duration).toBe(60)
    })

    it('should return 400 for missing required fields', async () => {
      const response = await request(app)
        .post('/api/appointments')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          patientId,
          // Missing doctorId, startTime, endTime
        })

      expect(response.status).toBe(400)
      expect(response.body.success).toBe(false)
      expect(response.body.error.code).toBe('INVALID_PAYLOAD')
    })

    it('should return 400 for invalid date format', async () => {
      const response = await request(app)
        .post('/api/appointments')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          patientId,
          doctorId,
          startTime: 'not-a-date',
          endTime: '2025-01-01',
        })

      expect(response.status).toBe(400)
      expect(response.body.error.code).toBe('INVALID_PAYLOAD')
    })

    it('should return 400 when end time is before start time', async () => {
      const start = new Date()
      start.setDate(start.getDate() + 1)
      start.setHours(14, 0, 0, 0)
      const end = new Date(start)
      end.setHours(13, 0, 0, 0) // Before start

      const response = await request(app)
        .post('/api/appointments')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          patientId,
          doctorId,
          startTime: start.toISOString(),
          endTime: end.toISOString(),
        })

      expect(response.status).toBe(400)
      expect(response.body.error.code).toBe('INVALID_TIME_RANGE')
    })

    it('should return 400 for invalid patient', async () => {
      const times = getFutureTime(1)
      const response = await request(app)
        .post('/api/appointments')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          patientId: 'invalid-patient-id',
          doctorId,
          ...times,
        })

      expect(response.status).toBe(400)
      expect(response.body.error.code).toBe('INVALID_PATIENT')
    })

    it('should return 400 for invalid doctor', async () => {
      const times = getFutureTime(1)
      const response = await request(app)
        .post('/api/appointments')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          patientId,
          doctorId: 'invalid-doctor-id',
          ...times,
        })

      expect(response.status).toBe(400)
      expect(response.body.error.code).toBe('INVALID_DOCTOR')
    })

    it('should return 409 for time conflict with same doctor', async () => {
      const times = getFutureTime(3, 10)

      // Create first appointment
      await request(app)
        .post('/api/appointments')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          patientId,
          doctorId,
          ...times,
        })

      // Try to create overlapping appointment
      const response = await request(app)
        .post('/api/appointments')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          patientId: patient2Id,
          doctorId,
          ...times, // Same time, same doctor
        })

      expect(response.status).toBe(409)
      expect(response.body.error.code).toBe('TIME_CONFLICT')
    })

    it('should allow same time with different doctor', async () => {
      const times = getFutureTime(4, 10)

      // Create first appointment with doctor1
      await request(app)
        .post('/api/appointments')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          patientId,
          doctorId,
          ...times,
        })

      // Create appointment at same time with doctor2
      const response = await request(app)
        .post('/api/appointments')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          patientId: patient2Id,
          doctorId: doctor2Id,
          ...times, // Same time, different doctor
        })

      expect(response.status).toBe(201)
    })

    it('should return 403 for STAFF role', async () => {
      const times = getFutureTime(1)
      const response = await request(app)
        .post('/api/appointments')
        .set('Authorization', `Bearer ${staffToken}`)
        .send({
          patientId,
          doctorId,
          ...times,
        })

      expect(response.status).toBe(403)
    })

    it('should return 401 without auth token', async () => {
      const times = getFutureTime(1)
      const response = await request(app).post('/api/appointments').send({
        patientId,
        doctorId,
        ...times,
      })

      expect(response.status).toBe(401)
    })
  })

  // ============================================================================
  // AUTO-PAYMENT ON CREATE TESTS
  // ============================================================================

  describe('POST /api/appointments - auto-payment', () => {
    it('should auto-create payment when isPaid=true and cost > 0', async () => {
      const times = getFutureTime(1)
      const response = await request(app)
        .post('/api/appointments')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          patientId,
          doctorId,
          ...times,
          cost: 200,
          isPaid: true,
        })

      expect(response.status).toBe(201)
      expect(response.body.data.isPaid).toBe(true)

      // Verify PatientPayment was created
      const payments = await prisma.patientPayment.findMany({
        where: { tenantId, patientId },
      })
      expect(payments).toHaveLength(1)
      expect(payments[0].amount.toNumber()).toBe(200)
      expect(payments[0].note).toBe('Pago en consulta')
    })

    it('should not create payment when isPaid=false', async () => {
      const times = getFutureTime(2)
      const response = await request(app)
        .post('/api/appointments')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          patientId,
          doctorId,
          ...times,
          cost: 100,
          isPaid: false,
        })

      expect(response.status).toBe(201)
      expect(response.body.data.isPaid).toBe(false)

      const payments = await prisma.patientPayment.findMany({
        where: { tenantId, patientId },
      })
      expect(payments).toHaveLength(0)
    })

    it('should not create payment when isPaid=true but no cost', async () => {
      const times = getFutureTime(3)
      const response = await request(app)
        .post('/api/appointments')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          patientId,
          doctorId,
          ...times,
          isPaid: true,
        })

      expect(response.status).toBe(201)

      const payments = await prisma.patientPayment.findMany({
        where: { tenantId, patientId },
      })
      expect(payments).toHaveLength(0)
    })
  })

  // ============================================================================
  // LIST TESTS
  // ============================================================================

  describe('GET /api/appointments', () => {
    beforeEach(async () => {
      // Create some test appointments
      const times1 = getFutureTime(1, 9)
      const times2 = getFutureTime(1, 10)
      const times3 = getFutureTime(2, 11)

      await prisma.appointment.createMany({
        data: [
          { tenantId, patientId, doctorId, startTime: new Date(times1.startTime), endTime: new Date(times1.endTime), duration: 30, status: 'SCHEDULED' },
          { tenantId, patientId: patient2Id, doctorId, startTime: new Date(times2.startTime), endTime: new Date(times2.endTime), duration: 30, status: 'COMPLETED' },
          { tenantId, patientId, doctorId: doctor2Id, startTime: new Date(times3.startTime), endTime: new Date(times3.endTime), duration: 30, status: 'CANCELLED', isActive: false },
        ],
      })
    })

    it('should list active appointments (STAFF)', async () => {
      const response = await request(app)
        .get('/api/appointments')
        .set('Authorization', `Bearer ${staffToken}`)

      expect(response.status).toBe(200)
      expect(response.body.success).toBe(true)
      expect(response.body.data.length).toBe(2) // Only active
    })

    it('should list all appointments including inactive', async () => {
      const response = await request(app)
        .get('/api/appointments?includeInactive=true')
        .set('Authorization', `Bearer ${staffToken}`)

      expect(response.status).toBe(200)
      expect(response.body.data.length).toBe(3)
    })

    it('should filter by doctor', async () => {
      const response = await request(app)
        .get(`/api/appointments?doctorId=${doctorId}`)
        .set('Authorization', `Bearer ${staffToken}`)

      expect(response.status).toBe(200)
      expect(response.body.data.every((a: Record<string, unknown>) => a.doctorId === doctorId)).toBe(true)
    })

    it('should filter by patient', async () => {
      const response = await request(app)
        .get(`/api/appointments?patientId=${patientId}`)
        .set('Authorization', `Bearer ${staffToken}`)

      expect(response.status).toBe(200)
      expect(response.body.data.every((a: Record<string, unknown>) => a.patientId === patientId)).toBe(true)
    })

    it('should filter by status', async () => {
      const response = await request(app)
        .get('/api/appointments?status=COMPLETED')
        .set('Authorization', `Bearer ${staffToken}`)

      expect(response.status).toBe(200)
      expect(response.body.data.every((a: Record<string, unknown>) => a.status === 'COMPLETED')).toBe(true)
    })

    it('should return 401 without auth token', async () => {
      const response = await request(app).get('/api/appointments')
      expect(response.status).toBe(401)
    })
  })

  // ============================================================================
  // GET BY ID TESTS
  // ============================================================================

  describe('GET /api/appointments/:id', () => {
    let appointmentId: string

    beforeEach(async () => {
      const times = getFutureTime(1)
      const appointment = await prisma.appointment.create({
        data: {
          tenantId,
          patientId,
          doctorId,
          startTime: new Date(times.startTime),
          endTime: new Date(times.endTime),
          duration: 30,
          type: 'Checkup',
        },
      })
      appointmentId = appointment.id
    })

    it('should get appointment by ID (STAFF)', async () => {
      const response = await request(app)
        .get(`/api/appointments/${appointmentId}`)
        .set('Authorization', `Bearer ${staffToken}`)

      expect(response.status).toBe(200)
      expect(response.body.success).toBe(true)
      expect(response.body.data.id).toBe(appointmentId)
      expect(response.body.data.patient).toBeDefined()
      expect(response.body.data.doctor).toBeDefined()
    })

    it('should return 404 for non-existent appointment', async () => {
      const response = await request(app)
        .get('/api/appointments/non-existent-id')
        .set('Authorization', `Bearer ${staffToken}`)

      expect(response.status).toBe(404)
      expect(response.body.error.code).toBe('NOT_FOUND')
    })
  })

  // ============================================================================
  // UPDATE TESTS
  // ============================================================================

  describe('PUT /api/appointments/:id', () => {
    let appointmentId: string

    beforeEach(async () => {
      const times = getFutureTime(1)
      const appointment = await prisma.appointment.create({
        data: {
          tenantId,
          patientId,
          doctorId,
          startTime: new Date(times.startTime),
          endTime: new Date(times.endTime),
          duration: 30,
        },
      })
      appointmentId = appointment.id
    })

    it('should update appointment (ADMIN)', async () => {
      const response = await request(app)
        .put(`/api/appointments/${appointmentId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          type: 'Root Canal',
          notes: 'Updated notes',
          cost: 150.00,
        })

      expect(response.status).toBe(200)
      expect(response.body.success).toBe(true)
      expect(response.body.data.type).toBe('Root Canal')
      expect(response.body.data.notes).toBe('Updated notes')
    })

    it('should update status', async () => {
      const response = await request(app)
        .put(`/api/appointments/${appointmentId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          status: 'CONFIRMED',
        })

      expect(response.status).toBe(200)
      expect(response.body.data.status).toBe('CONFIRMED')
    })

    it('should update patient and doctor', async () => {
      const response = await request(app)
        .put(`/api/appointments/${appointmentId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          patientId: patient2Id,
          doctorId: doctor2Id,
        })

      expect(response.status).toBe(200)
      expect(response.body.data.patientId).toBe(patient2Id)
      expect(response.body.data.doctorId).toBe(doctor2Id)
    })

    it('should return 400 for invalid patient on update', async () => {
      const response = await request(app)
        .put(`/api/appointments/${appointmentId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          patientId: 'invalid-patient-id',
        })

      expect(response.status).toBe(400)
      expect(response.body.error.code).toBe('INVALID_PATIENT')
    })

    it('should return 400 for immutable fields', async () => {
      const response = await request(app)
        .put(`/api/appointments/${appointmentId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          tenantId: 'new-tenant-id',
        })

      expect(response.status).toBe(400)
      expect(response.body.error.code).toBe('IMMUTABLE_FIELDS')
    })

    it('should check time conflict on update', async () => {
      // Create another appointment
      const times2 = getFutureTime(5, 14)
      await prisma.appointment.create({
        data: {
          tenantId,
          patientId: patient2Id,
          doctorId,
          startTime: new Date(times2.startTime),
          endTime: new Date(times2.endTime),
          duration: 30,
        },
      })

      // Try to update first appointment to conflict
      const response = await request(app)
        .put(`/api/appointments/${appointmentId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          startTime: times2.startTime,
          endTime: times2.endTime,
        })

      expect(response.status).toBe(409)
      expect(response.body.error.code).toBe('TIME_CONFLICT')
    })

    it('should not conflict with itself when updating same time slot', async () => {
      // Get the current appointment's times
      const getRes = await request(app)
        .get(`/api/appointments/${appointmentId}`)
        .set('Authorization', `Bearer ${adminToken}`)

      const { startTime, endTime } = getRes.body.data

      // Re-send the exact same startTime and endTime (as the frontend does)
      const response = await request(app)
        .put(`/api/appointments/${appointmentId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ startTime, endTime, notes: 'Updated without time change' })

      expect(response.status).toBe(200)
      expect(response.body.success).toBe(true)
      expect(response.body.data.notes).toBe('Updated without time change')
    })

    it('should allow updating to a free time slot', async () => {
      const freeTimes = getFutureTime(8, 16)
      const response = await request(app)
        .put(`/api/appointments/${appointmentId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          startTime: freeTimes.startTime,
          endTime: freeTimes.endTime,
        })

      expect(response.status).toBe(200)
      expect(response.body.success).toBe(true)
    })

    it('should return 403 for STAFF role', async () => {
      const response = await request(app)
        .put(`/api/appointments/${appointmentId}`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ type: 'New Type' })

      expect(response.status).toBe(403)
    })

    it('should return 404 for non-existent appointment', async () => {
      const response = await request(app)
        .put('/api/appointments/non-existent-id')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ type: 'New Type' })

      expect(response.status).toBe(404)
    })
  })

  // ============================================================================
  // AUTO-PAYMENT ON UPDATE TESTS
  // ============================================================================

  describe('PUT /api/appointments/:id - auto-payment', () => {
    let appointmentId: string

    beforeEach(async () => {
      const times = getFutureTime(10)
      const appointment = await prisma.appointment.create({
        data: {
          tenantId,
          patientId,
          doctorId,
          startTime: new Date(times.startTime),
          endTime: new Date(times.endTime),
          duration: 30,
          cost: 100,
          isPaid: false,
        },
      })
      appointmentId = appointment.id
    })

    it('should auto-create payment when isPaid transitions from false to true', async () => {
      const response = await request(app)
        .put(`/api/appointments/${appointmentId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ isPaid: true })

      expect(response.status).toBe(200)
      expect(response.body.success).toBe(true)
      expect(response.body.data.isPaid).toBe(true)

      const payments = await prisma.patientPayment.findMany({
        where: { tenantId, patientId },
      })
      expect(payments).toHaveLength(1)
      expect(payments[0].amount.toNumber()).toBe(100)
      expect(payments[0].note).toBe('Pago en consulta')
    })

    it('should use new cost when both cost and isPaid change', async () => {
      const response = await request(app)
        .put(`/api/appointments/${appointmentId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ cost: 250, isPaid: true })

      expect(response.status).toBe(200)
      expect(response.body.data.isPaid).toBe(true)
      expect(Number(response.body.data.cost)).toBe(250)

      const payments = await prisma.patientPayment.findMany({
        where: { tenantId, patientId },
      })
      expect(payments).toHaveLength(1)
      expect(payments[0].amount.toNumber()).toBe(250)
    })

    it('should apply FIFO: pay older unpaid appointment first when marking newer as paid', async () => {
      // Create an older unpaid appointment for the same patient
      const olderTimes = getFutureTime(2, 9)
      await prisma.appointment.create({
        data: {
          tenantId,
          patientId,
          doctorId: doctor2Id,
          startTime: new Date(olderTimes.startTime),
          endTime: new Date(olderTimes.endTime),
          duration: 30,
          cost: 100,
          isPaid: false,
        },
      })

      // Mark the newer appointment as paid (cost 100)
      const response = await request(app)
        .put(`/api/appointments/${appointmentId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ isPaid: true })

      expect(response.status).toBe(200)
      // FIFO sends the payment to the older appointment, so the edited (newer) one stays unpaid
      expect(response.body.data.isPaid).toBe(false)

      // Older appointment should now be marked as paid
      const allActive = await prisma.appointment.findMany({
        where: { tenantId, patientId, isActive: true },
        orderBy: { startTime: 'asc' },
      })
      expect(allActive[0].isPaid).toBe(true)
      expect(allActive[1].isPaid).toBe(false)
    })

    it('should reject attempt to unmark an already paid appointment', async () => {
      // First mark it paid via the FIFO flow
      await request(app)
        .put(`/api/appointments/${appointmentId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ isPaid: true })

      // Now try to unmark it
      const response = await request(app)
        .put(`/api/appointments/${appointmentId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ isPaid: false })

      expect(response.status).toBe(400)
      expect(response.body.error.code).toBe('CANNOT_UNMARK_PAID')

      // Payment should still exist
      const payments = await prisma.patientPayment.findMany({
        where: { tenantId, patientId },
      })
      expect(payments).toHaveLength(1)
    })

    it('should be a no-op when isPaid stays true', async () => {
      // Mark paid first
      await request(app)
        .put(`/api/appointments/${appointmentId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ isPaid: true })

      // Send another update with isPaid still true
      const response = await request(app)
        .put(`/api/appointments/${appointmentId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ isPaid: true, notes: 'Re-saved' })

      expect(response.status).toBe(200)
      expect(response.body.data.isPaid).toBe(true)
      expect(response.body.data.notes).toBe('Re-saved')

      // Should not have created a duplicate payment
      const payments = await prisma.patientPayment.findMany({
        where: { tenantId, patientId },
      })
      expect(payments).toHaveLength(1)
    })

    it('should not create payment when isPaid=true but cost is 0 or null', async () => {
      // Reset cost to null
      await prisma.appointment.update({
        where: { id: appointmentId },
        data: { cost: null },
      })

      const response = await request(app)
        .put(`/api/appointments/${appointmentId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ isPaid: true })

      expect(response.status).toBe(200)

      const payments = await prisma.patientPayment.findMany({
        where: { tenantId, patientId },
      })
      expect(payments).toHaveLength(0)
    })

    it('should recalculate FIFO when cost changes alone', async () => {
      // Pay 100 first
      await request(app)
        .put(`/api/appointments/${appointmentId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ isPaid: true })

      // Confirm paid
      const before = await prisma.appointment.findUnique({ where: { id: appointmentId } })
      expect(before?.isPaid).toBe(true)

      // Raise cost to 200 — payment of 100 no longer covers the full amount.
      const response = await request(app)
        .put(`/api/appointments/${appointmentId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ cost: 200 })

      expect(response.status).toBe(200)
      expect(response.body.data.isPaid).toBe(false)
    })
  })

  // ============================================================================
  // AUTO-PAYMENT WITH EXISTING CREDIT TESTS
  // ============================================================================

  describe('Appointments - paid with existing patient credit', () => {
    it('CREATE: should not create a new payment when prior credit fully covers the cost', async () => {
      // Patient has a $200 credit (advance payment) with no debt yet.
      await prisma.patientPayment.create({
        data: { tenantId, patientId, amount: 200, date: new Date() },
      })

      const times = getFutureTime(20)
      const response = await request(app)
        .post('/api/appointments')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          patientId,
          doctorId,
          ...times,
          cost: 100,
          isPaid: true,
        })

      expect(response.status).toBe(201)
      expect(response.body.data.isPaid).toBe(true)

      // Only the original advance payment should exist — no new auto-payment.
      const payments = await prisma.patientPayment.findMany({
        where: { tenantId, patientId },
      })
      expect(payments).toHaveLength(1)
      expect(payments[0].amount.toNumber()).toBe(200)
    })

    it('CREATE: should cap the auto-payment to the outstanding when credit partially covers the cost', async () => {
      // Patient has a $50 advance payment with no debt yet.
      await prisma.patientPayment.create({
        data: { tenantId, patientId, amount: 50, date: new Date() },
      })

      const times = getFutureTime(21)
      const response = await request(app)
        .post('/api/appointments')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          patientId,
          doctorId,
          ...times,
          cost: 100,
          isPaid: true,
        })

      expect(response.status).toBe(201)
      expect(response.body.data.isPaid).toBe(true)

      // Auto-payment should only be $50 (the remaining outstanding), not $100.
      const payments = await prisma.patientPayment.findMany({
        where: { tenantId, patientId },
        orderBy: { createdAt: 'asc' },
      })
      expect(payments).toHaveLength(2)
      expect(payments[0].amount.toNumber()).toBe(50) // existing advance
      expect(payments[1].amount.toNumber()).toBe(50) // capped auto-payment
    })

    it('UPDATE: should not create a new payment when prior credit fully covers the appointment', async () => {
      // Existing unpaid appointment.
      const times = getFutureTime(22)
      const appointment = await prisma.appointment.create({
        data: {
          tenantId,
          patientId,
          doctorId,
          startTime: new Date(times.startTime),
          endTime: new Date(times.endTime),
          duration: 30,
          cost: 100,
          isPaid: false,
        },
      })

      // Patient prepaid $300 — more than covers the $100 cost.
      await prisma.patientPayment.create({
        data: { tenantId, patientId, amount: 300, date: new Date() },
      })

      const response = await request(app)
        .put(`/api/appointments/${appointment.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ isPaid: true })

      expect(response.status).toBe(200)
      expect(response.body.data.isPaid).toBe(true)

      const payments = await prisma.patientPayment.findMany({
        where: { tenantId, patientId },
      })
      expect(payments).toHaveLength(1)
      expect(payments[0].amount.toNumber()).toBe(300)
    })

    it('UPDATE: should cap the auto-payment to the outstanding when credit partially covers the appointment', async () => {
      const times = getFutureTime(23)
      const appointment = await prisma.appointment.create({
        data: {
          tenantId,
          patientId,
          doctorId,
          startTime: new Date(times.startTime),
          endTime: new Date(times.endTime),
          duration: 30,
          cost: 100,
          isPaid: false,
        },
      })

      // Patient prepaid $30 — outstanding for the appointment is $70.
      await prisma.patientPayment.create({
        data: { tenantId, patientId, amount: 30, date: new Date() },
      })

      const response = await request(app)
        .put(`/api/appointments/${appointment.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ isPaid: true })

      expect(response.status).toBe(200)
      expect(response.body.data.isPaid).toBe(true)

      const payments = await prisma.patientPayment.findMany({
        where: { tenantId, patientId },
        orderBy: { createdAt: 'asc' },
      })
      expect(payments).toHaveLength(2)
      expect(payments[0].amount.toNumber()).toBe(30)
      expect(payments[1].amount.toNumber()).toBe(70)
    })
  })

  // ============================================================================
  // DELETE TESTS
  // ============================================================================

  describe('DELETE /api/appointments/:id', () => {
    let appointmentId: string

    beforeEach(async () => {
      const times = getFutureTime(1)
      const appointment = await prisma.appointment.create({
        data: {
          tenantId,
          patientId,
          doctorId,
          startTime: new Date(times.startTime),
          endTime: new Date(times.endTime),
          duration: 30,
        },
      })
      appointmentId = appointment.id
    })

    it('should soft delete appointment (ADMIN)', async () => {
      const response = await request(app)
        .delete(`/api/appointments/${appointmentId}`)
        .set('Authorization', `Bearer ${adminToken}`)

      expect(response.status).toBe(200)
      expect(response.body.success).toBe(true)
      expect(response.body.data.isActive).toBe(false)
      expect(response.body.data.status).toBe('CANCELLED')
    })

    it('should return 400 when deleting already inactive', async () => {
      // First delete
      await request(app)
        .delete(`/api/appointments/${appointmentId}`)
        .set('Authorization', `Bearer ${adminToken}`)

      // Try to delete again
      const response = await request(app)
        .delete(`/api/appointments/${appointmentId}`)
        .set('Authorization', `Bearer ${adminToken}`)

      expect(response.status).toBe(400)
      expect(response.body.error.code).toBe('ALREADY_INACTIVE')
    })

    it('should return 403 for STAFF role', async () => {
      const response = await request(app)
        .delete(`/api/appointments/${appointmentId}`)
        .set('Authorization', `Bearer ${staffToken}`)

      expect(response.status).toBe(403)
    })

    it('should return 404 for non-existent appointment', async () => {
      const response = await request(app)
        .delete('/api/appointments/non-existent-id')
        .set('Authorization', `Bearer ${adminToken}`)

      expect(response.status).toBe(404)
    })
  })

  // ============================================================================
  // RESTORE TESTS
  // ============================================================================

  describe('PUT /api/appointments/:id/restore', () => {
    let appointmentId: string

    beforeEach(async () => {
      const times = getFutureTime(1)
      const appointment = await prisma.appointment.create({
        data: {
          tenantId,
          patientId,
          doctorId,
          startTime: new Date(times.startTime),
          endTime: new Date(times.endTime),
          duration: 30,
          isActive: false,
          status: 'CANCELLED',
        },
      })
      appointmentId = appointment.id
    })

    it('should restore deleted appointment (ADMIN)', async () => {
      const response = await request(app)
        .put(`/api/appointments/${appointmentId}/restore`)
        .set('Authorization', `Bearer ${adminToken}`)

      expect(response.status).toBe(200)
      expect(response.body.success).toBe(true)
      expect(response.body.data.isActive).toBe(true)
      expect(response.body.data.status).toBe('SCHEDULED')
    })

    it('should return 400 when restoring active appointment', async () => {
      // First restore
      await request(app)
        .put(`/api/appointments/${appointmentId}/restore`)
        .set('Authorization', `Bearer ${adminToken}`)

      // Try to restore again
      const response = await request(app)
        .put(`/api/appointments/${appointmentId}/restore`)
        .set('Authorization', `Bearer ${adminToken}`)

      expect(response.status).toBe(400)
      expect(response.body.error.code).toBe('ALREADY_ACTIVE')
    })

    it('should check for time conflict when restoring', async () => {
      // Get the deleted appointment's time
      const deletedAppt = await prisma.appointment.findUnique({ where: { id: appointmentId } })

      // Create a new appointment at the same time
      await prisma.appointment.create({
        data: {
          tenantId,
          patientId: patient2Id,
          doctorId,
          startTime: deletedAppt!.startTime,
          endTime: deletedAppt!.endTime,
          duration: 30,
        },
      })

      // Try to restore - should fail due to conflict
      const response = await request(app)
        .put(`/api/appointments/${appointmentId}/restore`)
        .set('Authorization', `Bearer ${adminToken}`)

      expect(response.status).toBe(409)
      expect(response.body.error.code).toBe('TIME_CONFLICT')
    })

    it('should return 403 for STAFF role', async () => {
      const response = await request(app)
        .put(`/api/appointments/${appointmentId}/restore`)
        .set('Authorization', `Bearer ${staffToken}`)

      expect(response.status).toBe(403)
    })
  })

  // ============================================================================
  // MARK DONE TESTS
  // ============================================================================

  describe('PUT /api/appointments/:id/mark-done', () => {
    let appointmentId: string

    beforeEach(async () => {
      const times = getFutureTime(1)
      const appointment = await prisma.appointment.create({
        data: {
          tenantId,
          patientId,
          doctorId,
          startTime: new Date(times.startTime),
          endTime: new Date(times.endTime),
          duration: 30,
          status: 'IN_PROGRESS',
        },
      })
      appointmentId = appointment.id
    })

    it('should mark appointment as done (ADMIN)', async () => {
      const response = await request(app)
        .put(`/api/appointments/${appointmentId}/mark-done`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({})

      expect(response.status).toBe(200)
      expect(response.body.success).toBe(true)
      expect(response.body.data.status).toBe('COMPLETED')
    })

    it('should mark done with notes', async () => {
      const response = await request(app)
        .put(`/api/appointments/${appointmentId}/mark-done`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          notes: 'Treatment completed successfully. Follow up in 6 months.',
        })

      expect(response.status).toBe(200)
      expect(response.body.data.status).toBe('COMPLETED')
      expect(response.body.data.notes).toBe('Treatment completed successfully. Follow up in 6 months.')
    })

    it('should return 400 when marking deleted appointment as done', async () => {
      // Delete the appointment first
      await prisma.appointment.update({
        where: { id: appointmentId },
        data: { isActive: false },
      })

      const response = await request(app)
        .put(`/api/appointments/${appointmentId}/mark-done`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({})

      expect(response.status).toBe(400)
      expect(response.body.error.code).toBe('ALREADY_INACTIVE')
    })

    it('should return 403 for STAFF role', async () => {
      const response = await request(app)
        .put(`/api/appointments/${appointmentId}/mark-done`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({})

      expect(response.status).toBe(403)
    })
  })

  // ============================================================================
  // CALENDAR TESTS
  // ============================================================================

  describe('GET /api/appointments/calendar', () => {
    beforeEach(async () => {
      // Create appointments across different days
      const today = new Date()
      const appointments = []

      for (let i = 0; i < 5; i++) {
        const start = new Date(today)
        start.setDate(start.getDate() + i)
        start.setHours(10, 0, 0, 0)
        const end = new Date(start)
        end.setMinutes(end.getMinutes() + 30)

        appointments.push({
          tenantId,
          patientId: i % 2 === 0 ? patientId : patient2Id,
          doctorId: i % 2 === 0 ? doctorId : doctor2Id,
          startTime: start,
          endTime: end,
          duration: 30,
        })
      }

      await prisma.appointment.createMany({ data: appointments })
    })

    it('should get calendar appointments for date range', async () => {
      const from = new Date()
      from.setHours(0, 0, 0, 0)
      const to = new Date(from)
      to.setDate(to.getDate() + 7)

      const response = await request(app)
        .get(`/api/appointments/calendar?from=${from.toISOString()}&to=${to.toISOString()}`)
        .set('Authorization', `Bearer ${staffToken}`)

      expect(response.status).toBe(200)
      expect(response.body.success).toBe(true)
      expect(response.body.data.length).toBeGreaterThan(0)
    })

    it('should filter calendar by doctor', async () => {
      const from = new Date()
      from.setHours(0, 0, 0, 0)
      const to = new Date(from)
      to.setDate(to.getDate() + 7)

      const response = await request(app)
        .get(`/api/appointments/calendar?from=${from.toISOString()}&to=${to.toISOString()}&doctorId=${doctorId}`)
        .set('Authorization', `Bearer ${staffToken}`)

      expect(response.status).toBe(200)
      expect(response.body.data.every((a: Record<string, unknown>) => a.doctorId === doctorId)).toBe(true)
    })

    it('should return 400 without date range', async () => {
      const response = await request(app)
        .get('/api/appointments/calendar')
        .set('Authorization', `Bearer ${staffToken}`)

      expect(response.status).toBe(400)
      expect(response.body.error.code).toBe('INVALID_DATE_RANGE')
    })
  })

  // ============================================================================
  // STATS TESTS
  // ============================================================================

  describe('GET /api/appointments/stats', () => {
    beforeEach(async () => {
      const today = new Date()
      const appointments = [
        { status: 'SCHEDULED' as const, isPaid: false, cost: null },
        { status: 'COMPLETED' as const, isPaid: true, cost: 100 },
        { status: 'COMPLETED' as const, isPaid: false, cost: 150 },
        { status: 'CANCELLED' as const, isPaid: false, cost: null },
        { status: 'NO_SHOW' as const, isPaid: false, cost: null },
      ]

      for (let i = 0; i < appointments.length; i++) {
        const start = new Date(today)
        start.setHours(9 + i, 0, 0, 0)
        const end = new Date(start)
        end.setMinutes(end.getMinutes() + 30)

        await prisma.appointment.create({
          data: {
            tenantId,
            patientId,
            doctorId,
            startTime: start,
            endTime: end,
            duration: 30,
            ...appointments[i],
          },
        })
      }
    })

    it('should get appointment stats', async () => {
      const response = await request(app)
        .get('/api/appointments/stats')
        .set('Authorization', `Bearer ${staffToken}`)

      expect(response.status).toBe(200)
      expect(response.body.success).toBe(true)
      expect(response.body.data.total).toBe(5)
      expect(response.body.data.scheduled).toBe(1)
      expect(response.body.data.completed).toBe(2)
      expect(response.body.data.cancelled).toBe(1)
      expect(response.body.data.noShow).toBe(1)
      expect(response.body.data.revenue).toBe(100)
      expect(response.body.data.pendingPayment).toBe(150)
    })

    it('should filter stats by doctor', async () => {
      const response = await request(app)
        .get(`/api/appointments/stats?doctorId=${doctorId}`)
        .set('Authorization', `Bearer ${staffToken}`)

      expect(response.status).toBe(200)
      expect(response.body.data.total).toBeGreaterThan(0)
    })
  })

  // ============================================================================
  // BY-DOCTOR AND BY-PATIENT TESTS
  // ============================================================================

  describe('GET /api/appointments/by-doctor/:doctorId', () => {
    beforeEach(async () => {
      const times = getFutureTime(1)
      await prisma.appointment.create({
        data: {
          tenantId,
          patientId,
          doctorId,
          startTime: new Date(times.startTime),
          endTime: new Date(times.endTime),
          duration: 30,
        },
      })
    })

    it('should get appointments by doctor', async () => {
      const response = await request(app)
        .get(`/api/appointments/by-doctor/${doctorId}`)
        .set('Authorization', `Bearer ${staffToken}`)

      expect(response.status).toBe(200)
      expect(response.body.success).toBe(true)
      expect(response.body.data.length).toBeGreaterThan(0)
      expect(response.body.data[0].doctorId).toBe(doctorId)
    })

    it('should return empty for invalid doctor', async () => {
      const response = await request(app)
        .get('/api/appointments/by-doctor/invalid-id')
        .set('Authorization', `Bearer ${staffToken}`)

      expect(response.status).toBe(200)
      expect(response.body.data.length).toBe(0)
    })
  })

  describe('GET /api/appointments/by-patient/:patientId', () => {
    beforeEach(async () => {
      const times = getFutureTime(1)
      await prisma.appointment.create({
        data: {
          tenantId,
          patientId,
          doctorId,
          startTime: new Date(times.startTime),
          endTime: new Date(times.endTime),
          duration: 30,
        },
      })
    })

    it('should get appointments by patient', async () => {
      const response = await request(app)
        .get(`/api/appointments/by-patient/${patientId}`)
        .set('Authorization', `Bearer ${staffToken}`)

      expect(response.status).toBe(200)
      expect(response.body.success).toBe(true)
      expect(response.body.data.length).toBeGreaterThan(0)
      expect(response.body.data[0].patientId).toBe(patientId)
    })

    it('should return empty for invalid patient', async () => {
      const response = await request(app)
        .get('/api/appointments/by-patient/invalid-id')
        .set('Authorization', `Bearer ${staffToken}`)

      expect(response.status).toBe(200)
      expect(response.body.data.length).toBe(0)
    })

    it('should expose paidAmount/outstanding using FIFO allocation', async () => {
      // Wipe the auto-created appointment from the outer beforeEach so we
      // control the entire timeline of this patient.
      await prisma.appointment.deleteMany({ where: { tenantId, patientId } })
      await prisma.patientPayment.deleteMany({ where: { tenantId, patientId } })

      // Older appointment: $100 — will be fully paid by FIFO.
      const older = getFutureTime(1, 9)
      const olderApt = await prisma.appointment.create({
        data: {
          tenantId,
          patientId,
          doctorId,
          startTime: new Date(older.startTime),
          endTime: new Date(older.endTime),
          duration: 30,
          cost: 100,
        },
      })

      // Newer appointment: $200 — only $50 of the $150 total payment will
      // be left to apply, so this should come back as partially paid.
      const newer = getFutureTime(2, 9)
      const newerApt = await prisma.appointment.create({
        data: {
          tenantId,
          patientId,
          doctorId,
          startTime: new Date(newer.startTime),
          endTime: new Date(newer.endTime),
          duration: 30,
          cost: 200,
        },
      })

      await prisma.patientPayment.create({
        data: { tenantId, patientId, amount: 150, date: new Date() },
      })

      const response = await request(app)
        .get(`/api/appointments/by-patient/${patientId}`)
        .set('Authorization', `Bearer ${staffToken}`)

      expect(response.status).toBe(200)
      const byId = new Map<string, { paidAmount: number; outstanding: number; isPaid: boolean }>(
        response.body.data.map((a: { id: string; paidAmount: number; outstanding: number; isPaid: boolean }) => [
          a.id,
          { paidAmount: a.paidAmount, outstanding: a.outstanding, isPaid: a.isPaid },
        ])
      )

      expect(byId.get(olderApt.id)).toEqual({ paidAmount: 100, outstanding: 0, isPaid: true })
      expect(byId.get(newerApt.id)).toEqual({ paidAmount: 50, outstanding: 150, isPaid: false })
    })
  })

  // ============================================================================
  // TENANT ISOLATION TESTS
  // ============================================================================

  describe('Tenant Isolation', () => {
    let otherTenantId: string
    let otherAppointmentId: string

    beforeAll(async () => {
      // Create another tenant
      const otherTenant = await prisma.tenant.create({
        data: {
          name: 'Other Clinic',
          slug: `other-clinic-${Date.now()}`,
        },
      })
      otherTenantId = otherTenant.id

      // Create user for other tenant
      const passwordHash = await hashPassword('OtherPass123!')
      await prisma.user.create({
        data: {
          email: 'other-admin@test.com',
          passwordHash,
          firstName: 'Other',
          lastName: 'Admin',
          role: 'ADMIN',
          tenantId: otherTenant.id,
        },
      })

      // Create patient and doctor for other tenant
      const otherPatient = await prisma.patient.create({
        data: {
          tenantId: otherTenantId,
          firstName: 'Other',
          lastName: 'Patient',
        },
      })

      const otherDoctor = await prisma.doctor.create({
        data: {
          tenantId: otherTenantId,
          firstName: 'Other',
          lastName: 'Doctor',
        },
      })

      // Create appointment for other tenant
      const times = getFutureTime(1)
      const otherAppointment = await prisma.appointment.create({
        data: {
          tenantId: otherTenantId,
          patientId: otherPatient.id,
          doctorId: otherDoctor.id,
          startTime: new Date(times.startTime),
          endTime: new Date(times.endTime),
          duration: 30,
        },
      })
      otherAppointmentId = otherAppointment.id
    })

    afterAll(async () => {
      await prisma.appointment.deleteMany({ where: { tenantId: otherTenantId } })
      await prisma.patient.deleteMany({ where: { tenantId: otherTenantId } })
      await prisma.doctor.deleteMany({ where: { tenantId: otherTenantId } })
      await prisma.user.deleteMany({ where: { tenantId: otherTenantId } })
      await prisma.tenant.delete({ where: { id: otherTenantId } }).catch(() => {})
    })

    it('should not access appointments from other tenant', async () => {
      const response = await request(app)
        .get(`/api/appointments/${otherAppointmentId}`)
        .set('Authorization', `Bearer ${adminToken}`)

      expect(response.status).toBe(404)
    })

    it('should not update appointments from other tenant', async () => {
      const response = await request(app)
        .put(`/api/appointments/${otherAppointmentId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ type: 'Hacked' })

      expect(response.status).toBe(404)
    })

    it('should not delete appointments from other tenant', async () => {
      const response = await request(app)
        .delete(`/api/appointments/${otherAppointmentId}`)
        .set('Authorization', `Bearer ${adminToken}`)

      expect(response.status).toBe(404)
    })

    it('should not use patient from other tenant', async () => {
      const otherPatient = await prisma.patient.findFirst({ where: { tenantId: otherTenantId } })
      const times = getFutureTime(1)

      const response = await request(app)
        .post('/api/appointments')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          patientId: otherPatient!.id,
          doctorId,
          ...times,
        })

      expect(response.status).toBe(400)
      expect(response.body.error.code).toBe('INVALID_PATIENT')
    })

    it('should not use doctor from other tenant', async () => {
      // Create a patient for the main tenant first (since beforeEach clears them)
      const mainPatient = await prisma.patient.create({
        data: {
          tenantId,
          firstName: 'Main',
          lastName: 'Patient',
          email: 'main-patient-isolation@test.com',
        },
      })
      const otherDoctor = await prisma.doctor.findFirst({ where: { tenantId: otherTenantId } })
      const times = getFutureTime(1)

      const response = await request(app)
        .post('/api/appointments')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          patientId: mainPatient.id,
          doctorId: otherDoctor!.id,
          ...times,
        })

      expect(response.status).toBe(400)
      expect(response.body.error.code).toBe('INVALID_DOCTOR')
    })
  })

  // ============================================================================
  // BUDGET ITEM ASSOCIATION TESTS (PR D-1)
  // ============================================================================

  describe('Budget item association (PR D-1)', () => {
    let doctorUserId: string
    let doctorToken: string
    let linkedDoctorId: string
    let otherTenantId: string
    let otherTenantBudgetItemId: string

    beforeAll(async () => {
      const passwordHash = await hashPassword('DoctorPass123!')
      const doctorUser = await prisma.user.create({
        data: {
          email: 'doctor-budget-appt@test.com',
          passwordHash,
          firstName: 'Doc',
          lastName: 'Budget',
          role: 'DOCTOR',
          tenantId,
        },
      })
      doctorUserId = doctorUser.id
      // Production access tokens carry `userId` (TokenPayload) — the ownership
      // middleware and route handlers read req.user.userId, not `sub`.
      doctorToken = sign({ userId: doctorUserId, tenantId, role: 'DOCTOR' }, JWT_SECRET, {
        expiresIn: '1h',
      })

      const linkedDoctor = await prisma.doctor.create({
        data: {
          tenantId,
          firstName: 'Linked',
          lastName: 'Doctor',
          email: 'linked-doctor-budget@test.com',
          userId: doctorUserId,
        },
      })
      linkedDoctorId = linkedDoctor.id

      // Second tenant, used only for the cross-tenant item guard.
      const otherTenant = await prisma.tenant.create({
        data: { name: 'Other Budget Clinic', slug: `other-budget-appt-clinic-${Date.now()}` },
      })
      otherTenantId = otherTenant.id
      const otherPatient = await prisma.patient.create({
        data: { tenantId: otherTenantId, firstName: 'Other', lastName: 'Patient' },
      })
      const otherBudget = await prisma.budget.create({
        data: { tenantId: otherTenantId, patientId: otherPatient.id, status: 'APPROVED' },
      })
      const otherItem = await prisma.budgetItem.create({
        data: {
          budgetId: otherBudget.id,
          description: 'Other tenant item',
          quantity: 1,
          unitPrice: 100,
          totalPrice: 100,
          status: 'PENDING',
          order: 0,
        },
      })
      otherTenantBudgetItemId = otherItem.id
    })

    afterAll(async () => {
      await prisma.budget.deleteMany({ where: { tenantId: otherTenantId } })
      await prisma.patient.deleteMany({ where: { tenantId: otherTenantId } })
      await prisma.tenant.delete({ where: { id: otherTenantId } }).catch(() => {})

      await prisma.doctor.delete({ where: { id: linkedDoctorId } }).catch(() => {})
      await prisma.refreshToken.deleteMany({ where: { userId: doctorUserId } })
      await prisma.user.delete({ where: { id: doctorUserId } }).catch(() => {})
    })

    afterEach(async () => {
      await prisma.budget.deleteMany({ where: { tenantId } })
    })

    /** APPROVED budget with `itemCount` PENDING items, each worth 100. */
    async function createApprovedBudget(itemCount = 2) {
      return prisma.budget.create({
        data: {
          tenantId,
          patientId,
          status: 'APPROVED',
          items: {
            create: Array.from({ length: itemCount }, (_, i) => ({
              description: `Item ${i + 1}`,
              quantity: 1,
              unitPrice: 100,
              totalPrice: 100,
              order: i,
            })),
          },
        },
        include: { items: { orderBy: { order: 'asc' } } },
      })
    }

    it('authoritative full-flow: APPROVED budget -> SCHEDULED on create -> PARTIAL after one execution -> COMPLETED after both', async () => {
      const budget = await createApprovedBudget(2)
      const [itemA, itemB] = budget.items
      const times = getFutureTime(3)

      const createRes = await request(app)
        .post('/api/appointments')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ patientId, doctorId, ...times, budgetItemIds: [itemA.id, itemB.id] })

      expect(createRes.status).toBe(201)
      const apptId = createRes.body.data.id

      const scheduledLinks = await prisma.budgetItemAppointment.findMany({
        where: { appointmentId: apptId },
      })
      expect(scheduledLinks).toHaveLength(2)
      expect(scheduledLinks.every((l) => l.role === 'SCHEDULED')).toBe(true)

      const itemsAfterCreate = await prisma.budgetItem.findMany({
        where: { budgetId: budget.id },
        orderBy: { order: 'asc' },
      })
      expect(itemsAfterCreate.map((i) => i.status)).toEqual(['SCHEDULED', 'SCHEDULED'])

      // Confirm only item A as executed at mark-done time.
      const markDoneRes = await request(app)
        .put(`/api/appointments/${apptId}/mark-done`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ executedBudgetItemIds: [itemA.id] })

      expect(markDoneRes.status).toBe(200)
      expect(markDoneRes.body.data.status).toBe('COMPLETED')

      const itemAAfter = await prisma.budgetItem.findUnique({ where: { id: itemA.id } })
      const itemBAfter = await prisma.budgetItem.findUnique({ where: { id: itemB.id } })
      expect(itemAAfter?.status).toBe('EXECUTED')
      expect(itemBAfter?.status).toBe('SCHEDULED')

      const itemALinks = await prisma.budgetItemAppointment.findMany({
        where: { budgetItemId: itemA.id, appointmentId: apptId },
      })
      expect(itemALinks.map((l) => l.role).sort()).toEqual(['EXECUTED', 'SCHEDULED'])

      const budgetAfterFirst = await prisma.budget.findUnique({ where: { id: budget.id } })
      expect(budgetAfterFirst?.status).toBe('PARTIAL')

      // Confirm the second item too.
      const confirmSecond = await request(app)
        .put(`/api/appointments/${apptId}/mark-done`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ executedBudgetItemIds: [itemB.id] })

      expect(confirmSecond.status).toBe(200)

      const budgetAfterSecond = await prisma.budget.findUnique({ where: { id: budget.id } })
      expect(budgetAfterSecond?.status).toBe('COMPLETED')
    })

    it('replace-set: budgetItemIds on update links items to SCHEDULED', async () => {
      const budget = await createApprovedBudget(1)
      const [item] = budget.items
      const times = getFutureTime(1)
      const appt = await prisma.appointment.create({
        data: {
          tenantId,
          patientId,
          doctorId,
          startTime: new Date(times.startTime),
          endTime: new Date(times.endTime),
          duration: 30,
        },
      })

      const res = await request(app)
        .put(`/api/appointments/${appt.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ budgetItemIds: [item.id] })

      expect(res.status).toBe(200)
      const updatedItem = await prisma.budgetItem.findUnique({ where: { id: item.id } })
      expect(updatedItem?.status).toBe('SCHEDULED')
    })

    it('replace-set: omitting budgetItemIds on update leaves existing associations untouched', async () => {
      const budget = await createApprovedBudget(1)
      const [item] = budget.items
      const times = getFutureTime(1)
      const appt = await prisma.appointment.create({
        data: {
          tenantId,
          patientId,
          doctorId,
          startTime: new Date(times.startTime),
          endTime: new Date(times.endTime),
          duration: 30,
        },
      })
      await request(app)
        .put(`/api/appointments/${appt.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ budgetItemIds: [item.id] })

      const res = await request(app)
        .put(`/api/appointments/${appt.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ notes: 'No budgetItemIds field in this payload' })

      expect(res.status).toBe(200)
      const item2 = await prisma.budgetItem.findUnique({ where: { id: item.id } })
      expect(item2?.status).toBe('SCHEDULED')
      const links = await prisma.budgetItemAppointment.findMany({ where: { budgetItemId: item.id } })
      expect(links).toHaveLength(1)
    })

    it('replace-set: budgetItemIds=[] clears SCHEDULED associations and reverts PENDING, but not an EXECUTED item', async () => {
      const budget = await createApprovedBudget(2)
      const [itemA, itemB] = budget.items
      const times = getFutureTime(1)
      const appt = await prisma.appointment.create({
        data: {
          tenantId,
          patientId,
          doctorId,
          startTime: new Date(times.startTime),
          endTime: new Date(times.endTime),
          duration: 30,
        },
      })
      await request(app)
        .put(`/api/appointments/${appt.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ budgetItemIds: [itemA.id, itemB.id] })
      // Execute item A before clearing.
      await request(app)
        .put(`/api/appointments/${appt.id}/mark-done`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ executedBudgetItemIds: [itemA.id] })

      const res = await request(app)
        .put(`/api/appointments/${appt.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ budgetItemIds: [] })

      expect(res.status).toBe(200)
      const itemAAfter = await prisma.budgetItem.findUnique({ where: { id: itemA.id } })
      const itemBAfter = await prisma.budgetItem.findUnique({ where: { id: itemB.id } })
      // Executed item is never un-executed by unassociation.
      expect(itemAAfter?.status).toBe('EXECUTED')
      // Plain SCHEDULED item reverts to PENDING.
      expect(itemBAfter?.status).toBe('PENDING')
      const bLinks = await prisma.budgetItemAppointment.findMany({ where: { budgetItemId: itemB.id } })
      expect(bLinks).toHaveLength(0)
    })

    it('mark-done with an omitted executedBudgetItemIds leaves associated items SCHEDULED (no auto-execution)', async () => {
      const budget = await createApprovedBudget(1)
      const [item] = budget.items
      const times = getFutureTime(1)
      const appt = await prisma.appointment.create({
        data: {
          tenantId,
          patientId,
          doctorId,
          startTime: new Date(times.startTime),
          endTime: new Date(times.endTime),
          duration: 30,
          status: 'IN_PROGRESS',
        },
      })
      await request(app)
        .put(`/api/appointments/${appt.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ budgetItemIds: [item.id] })

      const res = await request(app)
        .put(`/api/appointments/${appt.id}/mark-done`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({})

      expect(res.status).toBe(200)
      expect(res.body.data.status).toBe('COMPLETED')
      const itemAfter = await prisma.budgetItem.findUnique({ where: { id: item.id } })
      expect(itemAfter?.status).toBe('SCHEDULED')
    })

    it('mark-done with executedBudgetItemIds=[] leaves associated items SCHEDULED (no auto-execution)', async () => {
      const budget = await createApprovedBudget(1)
      const [item] = budget.items
      const times = getFutureTime(1)
      const appt = await prisma.appointment.create({
        data: {
          tenantId,
          patientId,
          doctorId,
          startTime: new Date(times.startTime),
          endTime: new Date(times.endTime),
          duration: 30,
        },
      })
      await request(app)
        .put(`/api/appointments/${appt.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ budgetItemIds: [item.id] })

      const res = await request(app)
        .put(`/api/appointments/${appt.id}/mark-done`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ executedBudgetItemIds: [] })

      expect(res.status).toBe(200)
      const itemAfter = await prisma.budgetItem.findUnique({ where: { id: item.id } })
      expect(itemAfter?.status).toBe('SCHEDULED')
    })

    it('mark-done rejects an executedBudgetItemIds entry not associated to the appointment (400 ITEM_NOT_ASSOCIATED)', async () => {
      const budget = await createApprovedBudget(1)
      const [item] = budget.items
      const times = getFutureTime(1)
      const appt = await prisma.appointment.create({
        data: {
          tenantId,
          patientId,
          doctorId,
          startTime: new Date(times.startTime),
          endTime: new Date(times.endTime),
          duration: 30,
        },
      })
      // Never associated to this appointment.

      const res = await request(app)
        .put(`/api/appointments/${appt.id}/mark-done`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ executedBudgetItemIds: [item.id] })

      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('ITEM_NOT_ASSOCIATED')
      // executedBudgetItemIds is pre-validated (read-only) before
      // markAppointmentDone runs, so a rejected id leaves the appointment
      // entirely untouched at its prior (pre-call) status.
      const appointment = await prisma.appointment.findUnique({ where: { id: appt.id } })
      expect(appointment?.status).toBe('SCHEDULED')
    })

    it('mark-done with a valid executedBudgetItemIds subset still succeeds after pre-validation (happy path)', async () => {
      const budget = await createApprovedBudget(2)
      const [itemA, itemB] = budget.items
      const times = getFutureTime(1)
      const appt = await prisma.appointment.create({
        data: {
          tenantId,
          patientId,
          doctorId,
          startTime: new Date(times.startTime),
          endTime: new Date(times.endTime),
          duration: 30,
        },
      })
      await request(app)
        .put(`/api/appointments/${appt.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ budgetItemIds: [itemA.id, itemB.id] })

      const res = await request(app)
        .put(`/api/appointments/${appt.id}/mark-done`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ executedBudgetItemIds: [itemA.id] })

      expect(res.status).toBe(200)
      expect(res.body.data.status).toBe('COMPLETED')

      const appointment = await prisma.appointment.findUnique({ where: { id: appt.id } })
      expect(appointment?.status).toBe('COMPLETED')

      const itemAAfter = await prisma.budgetItem.findUnique({ where: { id: itemA.id } })
      const itemBAfter = await prisma.budgetItem.findUnique({ where: { id: itemB.id } })
      expect(itemAAfter?.status).toBe('EXECUTED')
      expect(itemBAfter?.status).toBe('SCHEDULED')
    })

    it('associating an EXECUTED item via update is rejected (400 ITEM_NOT_ELIGIBLE)', async () => {
      const budget = await createApprovedBudget(1)
      const [item] = budget.items
      await prisma.budgetItem.update({ where: { id: item.id }, data: { status: 'EXECUTED' } })
      const times = getFutureTime(1)
      const appt = await prisma.appointment.create({
        data: {
          tenantId,
          patientId,
          doctorId,
          startTime: new Date(times.startTime),
          endTime: new Date(times.endTime),
          duration: 30,
        },
      })

      const res = await request(app)
        .put(`/api/appointments/${appt.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ budgetItemIds: [item.id] })

      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('ITEM_NOT_ELIGIBLE')
    })

    it('associating an item from another tenant is rejected (404 ITEM_NOT_FOUND) and does not partially apply', async () => {
      const budget = await createApprovedBudget(1)
      const [validItem] = budget.items
      const times = getFutureTime(1)
      const appt = await prisma.appointment.create({
        data: {
          tenantId,
          patientId,
          doctorId,
          startTime: new Date(times.startTime),
          endTime: new Date(times.endTime),
          duration: 30,
        },
      })

      const res = await request(app)
        .put(`/api/appointments/${appt.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ budgetItemIds: [validItem.id, otherTenantBudgetItemId] })

      expect(res.status).toBe(404)
      expect(res.body.error.code).toBe('ITEM_NOT_FOUND')

      // Rollback: the valid id from this tenant must not have been linked either.
      const getRes = await request(app)
        .get(`/api/appointments/${appt.id}/budget-items`)
        .set('Authorization', `Bearer ${adminToken}`)
      expect(getRes.status).toBe(200)
      expect(getRes.body.data).toEqual([])
      const validItemAfter = await prisma.budgetItem.findUnique({ where: { id: validItem.id } })
      expect(validItemAfter?.status).toBe('PENDING')
    })

    it('returns 404 APPOINTMENT_NOT_FOUND from GET /:id/budget-items for a non-existent appointment', async () => {
      const res = await request(app)
        .get('/api/appointments/does-not-exist/budget-items')
        .set('Authorization', `Bearer ${adminToken}`)

      expect(res.status).toBe(404)
      expect(res.body.error.code).toBe('APPOINTMENT_NOT_FOUND')
    })

    it('GET /:id/budget-items returns the associated items with their roles', async () => {
      const budget = await createApprovedBudget(1)
      const [item] = budget.items
      const times = getFutureTime(1)
      const appt = await prisma.appointment.create({
        data: {
          tenantId,
          patientId,
          doctorId,
          startTime: new Date(times.startTime),
          endTime: new Date(times.endTime),
          duration: 30,
        },
      })
      await request(app)
        .put(`/api/appointments/${appt.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ budgetItemIds: [item.id] })

      const res = await request(app)
        .get(`/api/appointments/${appt.id}/budget-items`)
        .set('Authorization', `Bearer ${staffToken}`)

      expect(res.status).toBe(200)
      expect(res.body.data).toHaveLength(1)
      expect(res.body.data[0].id).toBe(item.id)
      expect(res.body.data[0].roles).toEqual(['SCHEDULED'])
    })

    it('STAFF is 403 when supplying budgetItemIds on update (STAFF cannot reach the mutating route at all)', async () => {
      const budget = await createApprovedBudget(1)
      const [item] = budget.items
      const times = getFutureTime(1)
      const appt = await prisma.appointment.create({
        data: {
          tenantId,
          patientId,
          doctorId,
          startTime: new Date(times.startTime),
          endTime: new Date(times.endTime),
          duration: 30,
        },
      })

      const res = await request(app)
        .put(`/api/appointments/${appt.id}`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ budgetItemIds: [item.id] })

      expect(res.status).toBe(403)
      const itemAfter = await prisma.budgetItem.findUnique({ where: { id: item.id } })
      expect(itemAfter?.status).toBe('PENDING')
    })

    it('STAFF is 403 when supplying executedBudgetItemIds on mark-done', async () => {
      const budget = await createApprovedBudget(1)
      const [item] = budget.items
      const times = getFutureTime(1)
      const appt = await prisma.appointment.create({
        data: {
          tenantId,
          patientId,
          doctorId,
          startTime: new Date(times.startTime),
          endTime: new Date(times.endTime),
          duration: 30,
        },
      })
      await request(app)
        .put(`/api/appointments/${appt.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ budgetItemIds: [item.id] })

      const res = await request(app)
        .put(`/api/appointments/${appt.id}/mark-done`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ executedBudgetItemIds: [item.id] })

      expect(res.status).toBe(403)
    })

    it('DOCTOR with BUDGETS_UPDATE can attach budget items via PUT /:id on an appointment they are assigned to', async () => {
      const budget = await createApprovedBudget(1)
      const [item] = budget.items
      const times = getFutureTime(1)
      const appt = await prisma.appointment.create({
        data: {
          tenantId,
          patientId,
          doctorId: linkedDoctorId,
          startTime: new Date(times.startTime),
          endTime: new Date(times.endTime),
          duration: 30,
        },
      })

      const res = await request(app)
        .put(`/api/appointments/${appt.id}`)
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({ budgetItemIds: [item.id] })

      expect(res.status).toBe(200)
      const itemAfter = await prisma.budgetItem.findUnique({ where: { id: item.id } })
      expect(itemAfter?.status).toBe('SCHEDULED')
    })
  })
})
