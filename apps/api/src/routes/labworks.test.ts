import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { app } from '../app.js'
import { prisma } from '@dental/database'
import { hashPassword } from '../services/auth.service.js'
import { sign } from 'jsonwebtoken'

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret'

describe('Labworks Routes - Permission Tests', () => {
  let tenantId: string
  let adminToken: string
  let staffToken: string
  let testLabworkId: string
  const testSlug = `test-labworks-${Date.now()}`

  // Helper to generate JWT token
  function generateToken(userId: string, tenantId: string, role: string) {
    return sign(
      { sub: userId, tenantId, role },
      JWT_SECRET,
      { expiresIn: '1h' }
    )
  }

  beforeAll(async () => {
    // Create test tenant
    const tenant = await prisma.tenant.create({
      data: {
        name: 'Test Clinic for Labworks',
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
          maxPatients: 15,
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

    // Create ADMIN user
    const hashedPassword = await hashPassword('password123')
    const adminUser = await prisma.user.create({
      data: {
        tenantId,
        email: 'admin@labworks-test.com',
        firstName: 'Admin',
        lastName: 'User',
        passwordHash: hashedPassword,
        role: 'ADMIN',
      },
    })
    adminToken = generateToken(adminUser.id, tenantId, 'ADMIN')

    // Create STAFF user
    const staffUser = await prisma.user.create({
      data: {
        tenantId,
        email: 'staff@labworks-test.com',
        firstName: 'Staff',
        lastName: 'User',
        passwordHash: hashedPassword,
        role: 'STAFF',
      },
    })
    staffToken = generateToken(staffUser.id, tenantId, 'STAFF')

    // Create a labwork as ADMIN for testing
    const labworkData = {
      lab: 'Test Lab',
      date: new Date().toISOString(),
      note: 'Test dental work',
      price: 100,
    }

    const response = await request(app)
      .post('/api/labworks')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(labworkData)

    testLabworkId = response.body.data?.id
  })

  afterAll(async () => {
    // Clean up test data
    await prisma.labwork.deleteMany({ where: { tenantId } })
    await prisma.user.deleteMany({ where: { tenantId } })
    await prisma.subscription.deleteMany({ where: { tenantId } })
    await prisma.tenant.delete({ where: { id: tenantId } })
  })

  describe('POST /api/labworks (Create)', () => {
    it('should allow ADMIN to create labwork', async () => {
      const labworkData = {
        lab: 'Dental Lab Inc',
        date: new Date().toISOString(),
        note: 'Crown preparation',
        price: 150,
      }

      const response = await request(app)
        .post('/api/labworks')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(labworkData)

      expect(response.status).toBe(201)
      expect(response.body.data).toHaveProperty('id')
      expect(response.body.data.lab).toBe(labworkData.lab)
    })

    it('should deny STAFF from creating labwork', async () => {
      const labworkData = {
        lab: 'Lab Plus',
        date: new Date().toISOString(),
        note: 'Bridge work',
        price: 200,
      }

      const response = await request(app)
        .post('/api/labworks')
        .set('Authorization', `Bearer ${staffToken}`)
        .send(labworkData)

      expect(response.status).toBe(403)
      expect(response.body).toHaveProperty('error')
    })
  })

  describe('PUT /api/labworks/:id (Update)', () => {
    it('should allow ADMIN to update labwork', async () => {
      const updateData = {
        isDelivered: true,
        isPaid: true,
      }

      const response = await request(app)
        .put(`/api/labworks/${testLabworkId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send(updateData)

      expect(response.status).toBe(200)
      expect(response.body.data.isDelivered).toBe(true)
    })

    it('should deny STAFF from updating labwork', async () => {
      const updateData = {
        isPaid: true,
      }

      const response = await request(app)
        .put(`/api/labworks/${testLabworkId}`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send(updateData)

      expect(response.status).toBe(403)
      expect(response.body).toHaveProperty('error')
    })
  })

  describe('DELETE /api/labworks/:id (Delete)', () => {
    it('should deny STAFF from deleting labwork', async () => {
      const response = await request(app)
        .delete(`/api/labworks/${testLabworkId}`)
        .set('Authorization', `Bearer ${staffToken}`)

      expect(response.status).toBe(403)
      expect(response.body).toHaveProperty('error')
    })

    it('should allow ADMIN to delete labwork', async () => {
      // Create a new labwork to delete
      const labworkData = {
        lab: 'Test Lab',
        date: new Date().toISOString(),
        note: 'To be deleted',
        price: 50,
      }

      const createResponse = await request(app)
        .post('/api/labworks')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(labworkData)

      const labworkId = createResponse.body.data.id

      const deleteResponse = await request(app)
        .delete(`/api/labworks/${labworkId}`)
        .set('Authorization', `Bearer ${adminToken}`)

      expect(deleteResponse.status).toBe(200)
    })
  })

  describe('GET /api/labworks (View)', () => {
    it('should allow STAFF to view labworks', async () => {
      const response = await request(app)
        .get('/api/labworks')
        .set('Authorization', `Bearer ${staffToken}`)

      expect(response.status).toBe(200)
      expect(Array.isArray(response.body.data)).toBe(true)
    })

    it('should allow ADMIN to view labworks', async () => {
      const response = await request(app)
        .get('/api/labworks')
        .set('Authorization', `Bearer ${adminToken}`)

      expect(response.status).toBe(200)
      expect(Array.isArray(response.body.data)).toBe(true)
    })
  })

  describe('Appointment linking', () => {
    let patientId: string
    let appointmentId: string
    let doctorId: string

    beforeAll(async () => {
      const patient = await prisma.patient.create({
        data: { tenantId, firstName: 'Link', lastName: 'Patient' },
      })
      patientId = patient.id

      const doctor = await prisma.doctor.create({
        data: { tenantId, firstName: 'Dr', lastName: 'Link' },
      })
      doctorId = doctor.id

      const appointment = await prisma.appointment.create({
        data: {
          tenantId,
          patientId,
          doctorId,
          startTime: new Date('2025-08-01T10:00:00Z'),
          endTime: new Date('2025-08-01T10:30:00Z'),
          cost: 300,
          status: 'COMPLETED',
        },
      })
      appointmentId = appointment.id
    })

    it('should create labwork linked to appointment', async () => {
      const res = await request(app)
        .post('/api/labworks')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          patientId,
          appointmentId,
          priceIncludedInAppointment: true,
          lab: 'Linked Lab',
          date: '2025-08-01',
          price: 100,
        })

      expect(res.status).toBe(201)
      expect(res.body.data.appointmentId).toBe(appointmentId)
      expect(res.body.data.priceIncludedInAppointment).toBe(true)
    })

    it('should update labwork to unlink appointment', async () => {
      // Create linked labwork
      const createRes = await request(app)
        .post('/api/labworks')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          patientId,
          appointmentId,
          lab: 'To Unlink',
          date: '2025-08-02',
          price: 50,
        })

      const labworkId = createRes.body.data.id

      // Unlink
      const updateRes = await request(app)
        .put(`/api/labworks/${labworkId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ appointmentId: null })

      expect(updateRes.status).toBe(200)
      expect(updateRes.body.data.appointmentId).toBeNull()
      expect(updateRes.body.data.priceIncludedInAppointment).toBe(false)
    })

    it('should return new fields in labwork response', async () => {
      const res = await request(app)
        .post('/api/labworks')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          lab: 'No Link Lab',
          date: '2025-08-03',
          price: 25,
        })

      expect(res.status).toBe(201)
      expect(res.body.data).toHaveProperty('appointmentId')
      expect(res.body.data).toHaveProperty('priceIncludedInAppointment')
      expect(res.body.data.appointmentId).toBeNull()
      expect(res.body.data.priceIncludedInAppointment).toBe(false)
    })
  })
})

describe('GET /api/labworks/labs (Lab name autocomplete)', () => {
  // Isolated tenants so seeded lab names/dedup/sort assertions aren't polluted
  // by labworks created in the describe block above.
  let tenantId: string
  let otherTenantId: string
  let staffToken: string
  let emptyTenantStaffToken: string
  const testSlug = `test-labworks-labs-${Date.now()}`
  const otherSlug = `test-labworks-labs-other-${Date.now()}`
  const emptySlug = `test-labworks-labs-empty-${Date.now()}`

  function generateToken(userId: string, tenantId: string, role: string) {
    return sign(
      { sub: userId, tenantId, role },
      JWT_SECRET,
      { expiresIn: '1h' }
    )
  }

  async function createTenant(slug: string, name: string) {
    const tenant = await prisma.tenant.create({
      data: {
        name,
        slug,
        currency: 'USD',
        timezone: 'America/New_York',
      },
    })

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

    await prisma.subscription.create({
      data: {
        tenantId: tenant.id,
        planId: freePlan.id,
        status: 'ACTIVE',
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    })

    return tenant
  }

  beforeAll(async () => {
    const hashedPassword = await hashPassword('password123')

    // Main tenant: seeded with duplicate/active/inactive lab names.
    const tenant = await createTenant(testSlug, 'Test Clinic for Lab Autocomplete')
    tenantId = tenant.id

    const staffUser = await prisma.user.create({
      data: {
        tenantId,
        email: 'staff@labworks-labs-test.com',
        firstName: 'Staff',
        lastName: 'User',
        passwordHash: hashedPassword,
        role: 'STAFF',
      },
    })
    staffToken = generateToken(staffUser.id, tenantId, 'STAFF')

    // Duplicate active lab names -> should collapse to one entry each.
    await prisma.labwork.create({
      data: { tenantId, lab: 'Zeta Dental Lab', date: new Date('2026-01-01'), isActive: true },
    })
    await prisma.labwork.create({
      data: { tenantId, lab: 'Zeta Dental Lab', date: new Date('2026-01-02'), isActive: true },
    })
    await prisma.labwork.create({
      data: { tenantId, lab: 'Alpha Dental Lab', date: new Date('2026-01-03'), isActive: true },
    })
    // Soft-deleted (inactive) labwork -> its lab name must be excluded.
    await prisma.labwork.create({
      data: { tenantId, lab: 'Inactive Only Lab', date: new Date('2026-01-04'), isActive: false },
    })

    // Other tenant: must never leak into the main tenant's results.
    const otherTenant = await createTenant(otherSlug, 'Other Clinic for Lab Autocomplete')
    otherTenantId = otherTenant.id
    await prisma.labwork.create({
      data: { tenantId: otherTenantId, lab: 'Only In Other Tenant Lab', date: new Date('2026-01-01'), isActive: true },
    })

    // Empty tenant: no labworks at all.
    const emptyTenant = await createTenant(emptySlug, 'Empty Clinic for Lab Autocomplete')
    const emptyStaffUser = await prisma.user.create({
      data: {
        tenantId: emptyTenant.id,
        email: 'staff@labworks-labs-empty-test.com',
        firstName: 'Staff',
        lastName: 'User',
        passwordHash: hashedPassword,
        role: 'STAFF',
      },
    })
    emptyTenantStaffToken = generateToken(emptyStaffUser.id, emptyTenant.id, 'STAFF')
  })

  afterAll(async () => {
    await prisma.labwork.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } })
    await prisma.user.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } })
    await prisma.subscription.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } })
    await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, otherTenantId] } } })

    // Empty tenant cleanup (no labworks were ever created for it).
    await prisma.user.deleteMany({ where: { email: 'staff@labworks-labs-empty-test.com' } })
    await prisma.subscription.deleteMany({ where: { tenant: { slug: emptySlug } } })
    await prisma.tenant.deleteMany({ where: { slug: emptySlug } })
  })

  it('allows STAFF to read the endpoint (200)', async () => {
    const response = await request(app)
      .get('/api/labworks/labs')
      .set('Authorization', `Bearer ${staffToken}`)

    expect(response.status).toBe(200)
    expect(response.body.success).toBe(true)
  })

  it('returns distinct, alphabetically sorted, active-only lab names for the tenant', async () => {
    const response = await request(app)
      .get('/api/labworks/labs')
      .set('Authorization', `Bearer ${staffToken}`)

    expect(response.status).toBe(200)
    expect(response.body.data).toEqual(['Alpha Dental Lab', 'Zeta Dental Lab'])
  })

  it('de-duplicates a lab name that appears on multiple active labworks (only one entry)', async () => {
    const response = await request(app)
      .get('/api/labworks/labs')
      .set('Authorization', `Bearer ${staffToken}`)

    const occurrences = response.body.data.filter((name: string) => name === 'Zeta Dental Lab')
    expect(occurrences).toHaveLength(1)
  })

  it('excludes lab names that only exist on inactive (soft-deleted) labworks', async () => {
    const response = await request(app)
      .get('/api/labworks/labs')
      .set('Authorization', `Bearer ${staffToken}`)

    expect(response.body.data).not.toContain('Inactive Only Lab')
  })

  it('does not leak lab names from another tenant', async () => {
    const response = await request(app)
      .get('/api/labworks/labs')
      .set('Authorization', `Bearer ${staffToken}`)

    expect(response.body.data).not.toContain('Only In Other Tenant Lab')
  })

  it('returns an empty array for a tenant with no labworks', async () => {
    const response = await request(app)
      .get('/api/labworks/labs')
      .set('Authorization', `Bearer ${emptyTenantStaffToken}`)

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ success: true, data: [] })
  })

  it('resolves to the /labs handler rather than being swallowed by /:id (route ordering)', async () => {
    const response = await request(app)
      .get('/api/labworks/labs')
      .set('Authorization', `Bearer ${staffToken}`)

    // The /:id handler would respond with `{ success: false, error: 'Labwork not found' }`
    // (404) if "labs" were treated as an :id param. Asserting the actual /labs
    // contract (200, array payload, no error envelope) pins the route ordering.
    expect(response.status).toBe(200)
    expect(Array.isArray(response.body.data)).toBe(true)
    expect(response.body).not.toHaveProperty('error')
  })
})
