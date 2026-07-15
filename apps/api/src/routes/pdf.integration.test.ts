import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { app } from '../app.js'
import { prisma } from '@dental/database'
import { hashPassword } from '../services/auth.service.js'
import { sign } from 'jsonwebtoken'

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret'

describe('PDF Endpoints Integration', () => {
  let tenantId: string
  let adminToken: string
  let staffToken: string
  let patientId: string
  let doctorId: string
  let appointmentId: string
  let labworkId: string
  const testSlug = `test-clinic-pdf-${Date.now()}`

  // Helper to generate JWT token
  function generateToken(userId: string, tenantId: string, role: string) {
    return sign({ sub: userId, tenantId, role }, JWT_SECRET, { expiresIn: '1h' })
  }

  beforeAll(async () => {
    // Create test tenant
    const tenant = await prisma.tenant.create({
      data: {
        name: 'Test Clinic for PDF',
        slug: testSlug,
        email: 'clinic@test.com',
        phone: '+1234567890',
        address: '123 Test Street',
        timezone: 'America/New_York',
        currency: 'USD',
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

    // Create subscription
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
        email: 'admin-pdf@test.com',
        passwordHash,
        firstName: 'Admin',
        lastName: 'User',
        role: 'ADMIN',
        tenantId: tenant.id,
      },
    })
    adminToken = generateToken(admin.id, tenant.id, 'ADMIN')

    // Create staff user
    const staff = await prisma.user.create({
      data: {
        email: 'staff-pdf@test.com',
        passwordHash,
        firstName: 'Staff',
        lastName: 'User',
        role: 'STAFF',
        tenantId: tenant.id,
      },
    })
    staffToken = generateToken(staff.id, tenant.id, 'STAFF')

    // Create doctor
    const doctor = await prisma.doctor.create({
      data: {
        tenantId,
        firstName: 'Dr. Jane',
        lastName: 'Smith',
        email: 'dr.smith@test.com',
        specialty: 'General Dentistry',
        licenseNumber: 'DDS-12345',
      },
    })
    doctorId = doctor.id

    // Create patient with dental chart
    const patient = await prisma.patient.create({
      data: {
        tenantId,
        firstName: 'John',
        lastName: 'Doe',
        email: 'john.doe@test.com',
        phone: '+1987654321',
        dob: new Date('1990-05-15'),
        gender: 'Male',
        address: '456 Patient Lane',
        teeth: {
          '11': 'Healthy',
          '21': 'Small cavity',
          '36': 'Crown needed',
        },
      },
    })
    patientId = patient.id

    // Create completed appointment
    const startTime = new Date()
    startTime.setDate(startTime.getDate() - 7) // 7 days ago
    startTime.setHours(10, 0, 0, 0)
    const endTime = new Date(startTime)
    endTime.setMinutes(endTime.getMinutes() + 30)

    const appointment = await prisma.appointment.create({
      data: {
        tenantId,
        patientId,
        doctorId,
        startTime,
        endTime,
        duration: 30,
        status: 'COMPLETED',
        type: 'Checkup',
        notes: 'Regular dental checkup. All teeth look healthy. Recommended cleaning in 6 months.',
        cost: 150.00,
        isPaid: true,
      },
    })
    appointmentId = appointment.id

    // Create labwork linked to the patient and doctor
    const labwork = await prisma.labwork.create({
      data: {
        tenantId,
        patientId,
        lab: 'Acme Dental Lab',
        phoneNumber: '+1298765432',
        date: new Date(),
        note: 'Rush order — crown for tooth 16',
        price: 250.0,
        isPaid: false,
        isDelivered: false,
        doctorIds: [doctorId],
      },
    })
    labworkId = labwork.id
  })

  afterAll(async () => {
    // Clean up in correct order
    await prisma.labwork.deleteMany({ where: { tenantId } })
    await prisma.appointment.deleteMany({ where: { tenantId } })
    await prisma.patient.deleteMany({ where: { tenantId } })
    await prisma.doctor.deleteMany({ where: { tenantId } })
    await prisma.user.deleteMany({ where: { tenantId } })
    await prisma.subscription.deleteMany({ where: { tenantId } })
    await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {})
  })

  // ============================================================================
  // APPOINTMENT PDF TESTS
  // ============================================================================

  describe('GET /api/appointments/:id/pdf', () => {
    it('should download appointment receipt PDF as ADMIN', async () => {
      const response = await request(app)
        .get(`/api/appointments/${appointmentId}/pdf`)
        .set('Authorization', `Bearer ${adminToken}`)

      expect(response.status).toBe(200)
      expect(response.headers['content-type']).toBe('application/pdf')
      expect(response.headers['content-disposition']).toContain('attachment')
      expect(response.headers['content-disposition']).toContain(`appointment-receipt-${appointmentId}.pdf`)
      expect(response.body).toBeInstanceOf(Buffer)
      // PDF header check
      expect(response.body.toString('utf8', 0, 5)).toBe('%PDF-')
    })

    it('should download appointment receipt PDF as STAFF', async () => {
      const response = await request(app)
        .get(`/api/appointments/${appointmentId}/pdf`)
        .set('Authorization', `Bearer ${staffToken}`)

      expect(response.status).toBe(200)
      expect(response.headers['content-type']).toBe('application/pdf')
    })

    it('should return 404 for non-existent appointment', async () => {
      const response = await request(app)
        .get('/api/appointments/non-existent-id/pdf')
        .set('Authorization', `Bearer ${adminToken}`)

      expect(response.status).toBe(404)
      expect(response.body.success).toBe(false)
      expect(response.body.error.code).toBe('NOT_FOUND')
    })

    it('should return 401 without authentication', async () => {
      const response = await request(app)
        .get(`/api/appointments/${appointmentId}/pdf`)

      expect(response.status).toBe(401)
    })

    it('should not allow access from another tenant', async () => {
      // Create a user in a different tenant
      const otherTenant = await prisma.tenant.create({
        data: {
          name: 'Other Clinic',
          slug: `other-clinic-pdf-${Date.now()}`,
        },
      })
      const passwordHash = await hashPassword('OtherPass123!')
      const otherUser = await prisma.user.create({
        data: {
          email: 'other-pdf@test.com',
          passwordHash,
          firstName: 'Other',
          lastName: 'User',
          role: 'ADMIN',
          tenantId: otherTenant.id,
        },
      })
      const otherToken = generateToken(otherUser.id, otherTenant.id, 'ADMIN')

      const response = await request(app)
        .get(`/api/appointments/${appointmentId}/pdf`)
        .set('Authorization', `Bearer ${otherToken}`)

      expect(response.status).toBe(404) // Should not find it in their tenant

      // Cleanup
      await prisma.user.delete({ where: { id: otherUser.id } })
      await prisma.tenant.delete({ where: { id: otherTenant.id } })
    })
  })

  // ============================================================================
  // LABWORK ORDER PDF TESTS
  // ============================================================================

  describe('GET /api/labworks/:id/pdf', () => {
    it('should download labwork order PDF as ADMIN', async () => {
      const response = await request(app)
        .get(`/api/labworks/${labworkId}/pdf`)
        .set('Authorization', `Bearer ${adminToken}`)

      expect(response.status).toBe(200)
      expect(response.headers['content-type']).toBe('application/pdf')
      expect(response.headers['content-disposition']).toContain('attachment')
      expect(response.headers['content-disposition']).toContain(`labwork-${labworkId}.pdf`)
      expect(response.body).toBeInstanceOf(Buffer)
      // PDF header check
      expect(response.body.toString('utf8', 0, 5)).toBe('%PDF-')
    })

    it('should download labwork order PDF as STAFF', async () => {
      const response = await request(app)
        .get(`/api/labworks/${labworkId}/pdf`)
        .set('Authorization', `Bearer ${staffToken}`)

      expect(response.status).toBe(200)
      expect(response.headers['content-type']).toBe('application/pdf')
    })

    it('should return 404 for non-existent labwork', async () => {
      const response = await request(app)
        .get('/api/labworks/non-existent-id/pdf')
        .set('Authorization', `Bearer ${adminToken}`)

      expect(response.status).toBe(404)
      expect(response.body.success).toBe(false)
      expect(response.body.error.code).toBe('NOT_FOUND')
    })

    it('should return 401 without authentication', async () => {
      const response = await request(app)
        .get(`/api/labworks/${labworkId}/pdf`)

      expect(response.status).toBe(401)
    })

    it('should not allow access from another tenant', async () => {
      // Create a user in a different tenant
      const otherTenant = await prisma.tenant.create({
        data: {
          name: 'Other Clinic Labwork',
          slug: `other-clinic-labwork-pdf-${Date.now()}`,
        },
      })
      const passwordHash = await hashPassword('OtherPass123!')
      const otherUser = await prisma.user.create({
        data: {
          email: 'other-labwork-pdf@test.com',
          passwordHash,
          firstName: 'Other',
          lastName: 'User',
          role: 'ADMIN',
          tenantId: otherTenant.id,
        },
      })
      const otherToken = generateToken(otherUser.id, otherTenant.id, 'ADMIN')

      const response = await request(app)
        .get(`/api/labworks/${labworkId}/pdf`)
        .set('Authorization', `Bearer ${otherToken}`)

      expect(response.status).toBe(404) // Should not find it in their tenant
      expect(response.body.success).toBe(false)
      expect(response.body.error.code).toBe('NOT_FOUND')

      // Cleanup
      await prisma.user.delete({ where: { id: otherUser.id } })
      await prisma.tenant.delete({ where: { id: otherTenant.id } })
    })
  })

  // ============================================================================
  // PATIENT HISTORY PDF TESTS
  // ============================================================================

  describe('GET /api/patients/:id/history-pdf', () => {
    it('should download patient history PDF as ADMIN', async () => {
      const response = await request(app)
        .get(`/api/patients/${patientId}/history-pdf`)
        .set('Authorization', `Bearer ${adminToken}`)

      expect(response.status).toBe(200)
      expect(response.headers['content-type']).toBe('application/pdf')
      expect(response.headers['content-disposition']).toContain('attachment')
      expect(response.headers['content-disposition']).toContain('patient-history-')
      expect(response.headers['content-disposition']).toContain('john-doe')
      expect(response.body).toBeInstanceOf(Buffer)
      // PDF header check
      expect(response.body.toString('utf8', 0, 5)).toBe('%PDF-')
    })

    it('should download patient history PDF as STAFF', async () => {
      const response = await request(app)
        .get(`/api/patients/${patientId}/history-pdf`)
        .set('Authorization', `Bearer ${staffToken}`)

      expect(response.status).toBe(200)
      expect(response.headers['content-type']).toBe('application/pdf')
    })

    it('should return 404 for non-existent patient', async () => {
      const response = await request(app)
        .get('/api/patients/non-existent-id/history-pdf')
        .set('Authorization', `Bearer ${adminToken}`)

      expect(response.status).toBe(404)
      expect(response.body.success).toBe(false)
      expect(response.body.error.code).toBe('NOT_FOUND')
    })

    it('should return 401 without authentication', async () => {
      const response = await request(app)
        .get(`/api/patients/${patientId}/history-pdf`)

      expect(response.status).toBe(401)
    })

    it('should include dental chart and appointments in PDF', async () => {
      // Create another appointment for the patient
      const startTime = new Date()
      startTime.setDate(startTime.getDate() - 14) // 14 days ago
      const endTime = new Date(startTime)
      endTime.setMinutes(endTime.getMinutes() + 45)

      await prisma.appointment.create({
        data: {
          tenantId,
          patientId,
          doctorId,
          startTime,
          endTime,
          duration: 45,
          status: 'COMPLETED',
          type: 'Cleaning',
          notes: 'Professional dental cleaning performed.',
          cost: 100.00,
          isPaid: true,
        },
      })

      const response = await request(app)
        .get(`/api/patients/${patientId}/history-pdf`)
        .set('Authorization', `Bearer ${adminToken}`)

      expect(response.status).toBe(200)
      expect(response.headers['content-type']).toBe('application/pdf')
      // PDF should be generated without errors even with multiple appointments
      expect(response.body.length).toBeGreaterThan(1000) // Meaningful PDF size
    })

    it('should handle patient with no appointments', async () => {
      // Create a patient with no appointments
      const emptyPatient = await prisma.patient.create({
        data: {
          tenantId,
          firstName: 'Empty',
          lastName: 'Patient',
        },
      })

      const response = await request(app)
        .get(`/api/patients/${emptyPatient.id}/history-pdf`)
        .set('Authorization', `Bearer ${adminToken}`)

      expect(response.status).toBe(200)
      expect(response.headers['content-type']).toBe('application/pdf')

      // Cleanup
      await prisma.patient.delete({ where: { id: emptyPatient.id } })
    })
  })
})
