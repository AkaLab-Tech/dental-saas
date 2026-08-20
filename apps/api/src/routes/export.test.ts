import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import jwt from 'jsonwebtoken'
import { prisma } from '@dental/database'
import { api } from '../test/http.js'
import { ExportService } from '../services/export.service.js'

describe('Export Routes', () => {
  let tenantId: string
  let planId: string
  let ownerToken: string
  let adminToken: string
  let staffToken: string
  let doctorId: string
  let patientId: string

  function generateToken(payload: {
    userId: string
    tenantId: string
    email: string
    role: string
  }) {
    return jwt.sign(payload, process.env.JWT_SECRET || 'test-jwt-secret-minimum-32-characters-here')
  }

  beforeAll(async () => {
    // Create plan
    const plan = await prisma.plan.upsert({
      where: { name: 'enterprise' },
      update: {},
      create: {
        name: 'enterprise',
        displayName: 'Enterprise',
        price: 0,
        maxAdmins: 5,
        maxDoctors: 10,
        maxPatients: 60,
        features: [],
      },
    })
    planId = plan.id

    // Create tenant
    const tenant = await prisma.tenant.create({
      data: {
        name: 'Export Test Clinic',
        slug: `export-routes-test-${Date.now()}`,
        email: 'clinic@test.com',
        phone: '123456789',
        address: '123 Test St',
        subscription: {
          create: {
            planId,
            status: 'ACTIVE',
            currentPeriodStart: new Date(),
            currentPeriodEnd: new Date('2099-12-31'),
          },
        },
      },
    })
    tenantId = tenant.id

    // Create owner user
    const owner = await prisma.user.create({
      data: {
        tenantId,
        email: `owner-export-${Date.now()}@test.com`,
        passwordHash: 'hashed',
        firstName: 'Owner',
        lastName: 'User',
        role: 'OWNER',
      },
    })
    ownerToken = generateToken({
      userId: owner.id,
      tenantId,
      email: owner.email,
      role: 'OWNER',
    })

    // Create admin user
    const admin = await prisma.user.create({
      data: {
        tenantId,
        email: `admin-export-${Date.now()}@test.com`,
        passwordHash: 'hashed',
        firstName: 'Admin',
        lastName: 'User',
        role: 'ADMIN',
      },
    })
    adminToken = generateToken({
      userId: admin.id,
      tenantId,
      email: admin.email,
      role: 'ADMIN',
    })

    // Create staff user
    const staff = await prisma.user.create({
      data: {
        tenantId,
        email: `staff-export-${Date.now()}@test.com`,
        passwordHash: 'hashed',
        firstName: 'Staff',
        lastName: 'User',
        role: 'STAFF',
      },
    })
    staffToken = generateToken({
      userId: staff.id,
      tenantId,
      email: staff.email,
      role: 'STAFF',
    })

    // Create test data
    const doctor = await prisma.doctor.create({
      data: {
        tenantId,
        firstName: 'Dr. John',
        lastName: 'Doe',
        email: 'doctor@test.com',
        specialty: 'General Dentistry',
      },
    })
    doctorId = doctor.id

    const patient = await prisma.patient.create({
      data: {
        tenantId,
        firstName: 'Jane',
        lastName: 'Smith',
        email: 'patient@test.com',
        phone: '555-1234',
        teeth: { '11': 'Crown needed' },
      },
    })
    patientId = patient.id

    await prisma.appointment.create({
      data: {
        tenantId,
        patientId,
        doctorId,
        startTime: new Date('2026-01-20T10:00:00Z'),
        endTime: new Date('2026-01-20T10:30:00Z'),
        duration: 30,
        status: 'SCHEDULED',
        type: 'Checkup',
        cost: 100,
      },
    })

    await prisma.labwork.create({
      data: {
        tenantId,
        patientId,
        lab: 'Test Lab',
        date: new Date('2026-01-15'),
        price: 250,
        note: 'Crown for tooth 11',
      },
    })

    await prisma.expense.create({
      data: {
        tenantId,
        date: new Date('2026-01-10'),
        amount: 500,
        issuer: 'Dental Supplies Inc',
        note: 'Monthly supplies',
      },
    })
  })

  afterAll(async () => {
    await prisma.expense.deleteMany({ where: { tenantId } })
    await prisma.labwork.deleteMany({ where: { tenantId } })
    await prisma.appointment.deleteMany({ where: { tenantId } })
    await prisma.patient.deleteMany({ where: { tenantId } })
    await prisma.doctor.deleteMany({ where: { tenantId } })
    await prisma.user.deleteMany({ where: { tenantId } })
    await prisma.subscription.deleteMany({ where: { tenantId } })
    await prisma.tenant.delete({ where: { id: tenantId } })
  })

  describe('GET /api/export', () => {
    it('should export all tenant data as OWNER', async () => {
      const res = await api()
        .get('/api/export')
        .set('Authorization', `Bearer ${ownerToken}`)

      expect(res.status).toBe(200)
      expect(res.headers['content-type']).toContain('application/json')
      expect(res.headers['content-disposition']).toContain('attachment')
      expect(res.headers['content-disposition']).toContain('.json')

      // Check structure
      expect(res.body).toHaveProperty('exportedAt')
      expect(res.body).toHaveProperty('tenant')
      expect(res.body).toHaveProperty('patients')
      expect(res.body).toHaveProperty('doctors')
      expect(res.body).toHaveProperty('appointments')
      expect(res.body).toHaveProperty('labworks')
      expect(res.body).toHaveProperty('expenses')

      // Check tenant data
      expect(res.body.tenant.name).toBe('Export Test Clinic')

      // Check data counts
      expect(res.body.patients).toHaveLength(1)
      expect(res.body.doctors).toHaveLength(1)
      expect(res.body.appointments).toHaveLength(1)
      expect(res.body.labworks).toHaveLength(1)
      expect(res.body.expenses).toHaveLength(1)

      // Check patient data
      expect(res.body.patients[0].firstName).toBe('Jane')
      expect(res.body.patients[0].teeth).toEqual({ '11': 'Crown needed' })

      // Check doctor data
      expect(res.body.doctors[0].specialty).toBe('General Dentistry')

      // Check appointment data
      expect(res.body.appointments[0].type).toBe('Checkup')
      expect(res.body.appointments[0].cost).toBe('100')

      // Check labwork data
      expect(res.body.labworks[0].lab).toBe('Test Lab')

      // Check expense data
      expect(res.body.expenses[0].issuer).toBe('Dental Supplies Inc')
    })

    it('should export all tenant data as ADMIN', async () => {
      const res = await api()
        .get('/api/export')
        .set('Authorization', `Bearer ${adminToken}`)

      expect(res.status).toBe(200)
      expect(res.body).toHaveProperty('exportedAt')
      expect(res.body.patients).toHaveLength(1)
    })

    it('should deny export to STAFF users', async () => {
      const res = await api()
        .get('/api/export')
        .set('Authorization', `Bearer ${staffToken}`)

      expect(res.status).toBe(403)
    })

    it('should require authentication', async () => {
      const res = await api().get('/api/export')

      expect(res.status).toBe(401)
    })
  })

  describe('ExportService', () => {
    it('should export all active records only', async () => {
      // Create an inactive patient
      const inactivePatient = await prisma.patient.create({
        data: {
          tenantId,
          firstName: 'Inactive',
          lastName: 'Patient',
          isActive: false,
        },
      })

      const data = await ExportService.exportTenantData(tenantId)

      // Should not include inactive patient
      expect(data.patients.find((p) => p.firstName === 'Inactive')).toBeUndefined()
      expect(data.patients).toHaveLength(1)

      // Cleanup
      await prisma.patient.delete({ where: { id: inactivePatient.id } })
    })

    it('should throw error for non-existent tenant', async () => {
      await expect(ExportService.exportTenantData('non-existent-id')).rejects.toThrow(
        'Tenant not found'
      )
    })

    it('should format dates as ISO strings', async () => {
      const data = await ExportService.exportTenantData(tenantId)

      // Check exportedAt is ISO format
      expect(data.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)

      // Check patient createdAt
      expect(data.patients[0].createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)

      // Check appointment times
      expect(data.appointments[0].startTime).toMatch(/^\d{4}-\d{2}-\d{2}T/)
      expect(data.appointments[0].endTime).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    })

    it('should format decimal values as strings', async () => {
      const data = await ExportService.exportTenantData(tenantId)

      // Costs should be strings (from Decimal)
      expect(typeof data.appointments[0].cost).toBe('string')
      expect(typeof data.labworks[0].price).toBe('string')
      expect(typeof data.expenses[0].amount).toBe('string')
    })
  })
})
