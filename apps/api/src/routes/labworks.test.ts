import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { api } from '../test/http.js'
import { prisma } from '@dental/database'
import { hashPassword } from '../services/auth.service.js'
import { generateToken } from '../test/tokens.js'

describe('Labworks Routes - Permission Tests', () => {
  let tenantId: string
  let adminToken: string
  let staffToken: string
  let testLabworkId: string
  const testSlug = `test-labworks-${Date.now()}`


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

    const response = await api()
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

      const response = await api()
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

      const response = await api()
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

      const response = await api()
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

      const response = await api()
        .put(`/api/labworks/${testLabworkId}`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send(updateData)

      expect(response.status).toBe(403)
      expect(response.body).toHaveProperty('error')
    })
  })

  describe('DELETE /api/labworks/:id (Delete)', () => {
    it('should deny STAFF from deleting labwork', async () => {
      const response = await api()
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

      const createResponse = await api()
        .post('/api/labworks')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(labworkData)

      const labworkId = createResponse.body.data.id

      const deleteResponse = await api()
        .delete(`/api/labworks/${labworkId}`)
        .set('Authorization', `Bearer ${adminToken}`)

      expect(deleteResponse.status).toBe(200)
    })
  })

  describe('GET /api/labworks (View)', () => {
    it('should allow STAFF to view labworks', async () => {
      const response = await api()
        .get('/api/labworks')
        .set('Authorization', `Bearer ${staffToken}`)

      expect(response.status).toBe(200)
      expect(Array.isArray(response.body.data)).toBe(true)
    })

    it('should allow ADMIN to view labworks', async () => {
      const response = await api()
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
      const res = await api()
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
      const createRes = await api()
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
      const updateRes = await api()
        .put(`/api/labworks/${labworkId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ appointmentId: null })

      expect(updateRes.status).toBe(200)
      expect(updateRes.body.data.appointmentId).toBeNull()
      expect(updateRes.body.data.priceIncludedInAppointment).toBe(false)
    })

    it('should return new fields in labwork response', async () => {
      const res = await api()
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

describe('GET /api/labworks?search= (server-side search by lab and patient)', () => {
  let tenantId: string
  let otherTenantId: string
  let staffToken: string
  let garciaPatientId: string
  let smithPatientId: string
  const testSlug = `test-labworks-search-${Date.now()}`
  const otherSlug = `test-labworks-search-other-${Date.now()}`


  async function createTenant(slug: string, name: string) {
    const tenant = await prisma.tenant.create({
      data: { name, slug, currency: 'USD', timezone: 'America/New_York' },
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
          maxPatients: 50,
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

    const tenant = await createTenant(testSlug, 'Test Clinic for Labwork Search')
    tenantId = tenant.id

    const staffUser = await prisma.user.create({
      data: {
        tenantId,
        email: 'staff@labworks-search-test.com',
        firstName: 'Staff',
        lastName: 'User',
        passwordHash: hashedPassword,
        role: 'STAFF',
      },
    })
    staffToken = generateToken(staffUser.id, tenantId, 'STAFF')

    const garciaPatient = await prisma.patient.create({
      data: { tenantId, firstName: 'Maria', lastName: 'Garcia' },
    })
    garciaPatientId = garciaPatient.id

    const smithPatient = await prisma.patient.create({
      data: { tenantId, firstName: 'John', lastName: 'Smith' },
    })
    smithPatientId = smithPatient.id

    // Matches by lab name.
    await prisma.labwork.create({
      data: {
        tenantId,
        lab: 'Acme Dental Lab',
        date: new Date('2026-02-01'),
        isPaid: true,
        isDelivered: false,
      },
    })
    // Matches by patient first name ("Maria"), lab unrelated.
    await prisma.labwork.create({
      data: {
        tenantId,
        patientId: garciaPatientId,
        lab: 'Unrelated Lab Co',
        date: new Date('2026-02-02'),
        isPaid: false,
        isDelivered: false,
      },
    })
    // Matches by patient last name ("Smith"), lab unrelated, isPaid=true so it
    // can be used to prove search AND-combines with the isPaid filter.
    await prisma.labwork.create({
      data: {
        tenantId,
        patientId: smithPatientId,
        lab: 'Other Lab',
        date: new Date('2026-02-03'),
        isPaid: true,
        isDelivered: false,
      },
    })
    // No match for any of the search terms used below.
    await prisma.labwork.create({
      data: {
        tenantId,
        lab: 'Zzz Nonmatching Lab',
        date: new Date('2026-02-04'),
        isPaid: false,
        isDelivered: false,
      },
    })
    // Soft-deleted labwork whose lab name would otherwise match "Acme" —
    // must be excluded (search combines with the default isActive filter).
    await prisma.labwork.create({
      data: {
        tenantId,
        lab: 'Acme Deleted Lab',
        date: new Date('2026-02-05'),
        isActive: false,
      },
    })

    // Other tenant: a labwork with a lab name that would match "Acme" must
    // never leak into the first tenant's search results.
    const otherTenant = await createTenant(otherSlug, 'Other Clinic for Labwork Search')
    otherTenantId = otherTenant.id
    await prisma.labwork.create({
      data: { tenantId: otherTenantId, lab: 'Acme Other Tenant Lab', date: new Date('2026-02-01') },
    })
  })

  afterAll(async () => {
    await prisma.labwork.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } })
    await prisma.patient.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } })
    await prisma.user.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } })
    await prisma.subscription.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } })
    await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, otherTenantId] } } })
  })

  it('filters by lab name when search matches the lab field', async () => {
    const response = await api()
      .get('/api/labworks?search=Acme')
      .set('Authorization', `Bearer ${staffToken}`)

    expect(response.status).toBe(200)
    const labs = response.body.data.map((l: { lab: string }) => l.lab)
    expect(labs).toEqual(['Acme Dental Lab'])
  })

  it('is case-insensitive when matching the lab field', async () => {
    const response = await api()
      .get('/api/labworks?search=aCmE')
      .set('Authorization', `Bearer ${staffToken}`)

    expect(response.status).toBe(200)
    const labs = response.body.data.map((l: { lab: string }) => l.lab)
    expect(labs).toEqual(['Acme Dental Lab'])
  })

  it('filters by patient first name when search matches firstName', async () => {
    const response = await api()
      .get('/api/labworks?search=Maria')
      .set('Authorization', `Bearer ${staffToken}`)

    expect(response.status).toBe(200)
    expect(response.body.data).toHaveLength(1)
    expect(response.body.data[0].patientId).toBe(garciaPatientId)
    expect(response.body.data[0].lab).toBe('Unrelated Lab Co')
  })

  it('filters by patient last name when search matches lastName, case-insensitively', async () => {
    const response = await api()
      .get('/api/labworks?search=smith')
      .set('Authorization', `Bearer ${staffToken}`)

    expect(response.status).toBe(200)
    expect(response.body.data).toHaveLength(1)
    expect(response.body.data[0].patientId).toBe(smithPatientId)
  })

  it('returns an empty list when search matches nothing', async () => {
    const response = await api()
      .get('/api/labworks?search=NoSuchLabOrPatientAtAll')
      .set('Authorization', `Bearer ${staffToken}`)

    expect(response.status).toBe(200)
    expect(response.body.data).toEqual([])
    expect(response.body.pagination.total).toBe(0)
  })

  it('excludes soft-deleted labworks even when their lab name matches the search term', async () => {
    const response = await api()
      .get('/api/labworks?search=Acme')
      .set('Authorization', `Bearer ${staffToken}`)

    const labs = response.body.data.map((l: { lab: string }) => l.lab)
    expect(labs).not.toContain('Acme Deleted Lab')
  })

  it('does not leak matches from another tenant', async () => {
    const response = await api()
      .get('/api/labworks?search=Acme')
      .set('Authorization', `Bearer ${staffToken}`)

    const labs = response.body.data.map((l: { lab: string }) => l.lab)
    expect(labs).not.toContain('Acme Other Tenant Lab')
  })

  it('combines search with the isPaid filter (AND), not replacing it', async () => {
    // "Other Lab" (patient Smith) has isPaid=true. search=smith + isPaid=true
    // should return that single row; search=smith + isPaid=false should
    // return nothing, proving isPaid keeps filtering alongside search rather
    // than being ignored once search is present.
    const paidResponse = await api()
      .get('/api/labworks?search=smith&isPaid=true')
      .set('Authorization', `Bearer ${staffToken}`)

    expect(paidResponse.status).toBe(200)
    expect(paidResponse.body.data).toHaveLength(1)
    expect(paidResponse.body.data[0].patientId).toBe(smithPatientId)

    // Same search term but isPaid=false must exclude that same row, proving
    // search doesn't override/ignore the isPaid filter.
    const unpaidResponse = await api()
      .get('/api/labworks?search=smith&isPaid=false')
      .set('Authorization', `Bearer ${staffToken}`)

    expect(unpaidResponse.status).toBe(200)
    expect(unpaidResponse.body.data).toEqual([])
  })

  it('returns the full unfiltered set when search is omitted (existing behavior unchanged)', async () => {
    // 4 active labworks were seeded in this describe block (a 5th is
    // soft-deleted and excluded by the default isActive filter).
    const response = await api()
      .get('/api/labworks')
      .set('Authorization', `Bearer ${staffToken}`)

    expect(response.status).toBe(200)
    expect(response.body.data.length).toBeGreaterThanOrEqual(4)
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
          maxPatients: 50,
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
    const response = await api()
      .get('/api/labworks/labs')
      .set('Authorization', `Bearer ${staffToken}`)

    expect(response.status).toBe(200)
    expect(response.body.success).toBe(true)
  })

  it('returns distinct, alphabetically sorted, active-only lab names for the tenant', async () => {
    const response = await api()
      .get('/api/labworks/labs')
      .set('Authorization', `Bearer ${staffToken}`)

    expect(response.status).toBe(200)
    expect(response.body.data).toEqual(['Alpha Dental Lab', 'Zeta Dental Lab'])
  })

  it('de-duplicates a lab name that appears on multiple active labworks (only one entry)', async () => {
    const response = await api()
      .get('/api/labworks/labs')
      .set('Authorization', `Bearer ${staffToken}`)

    const occurrences = response.body.data.filter((name: string) => name === 'Zeta Dental Lab')
    expect(occurrences).toHaveLength(1)
  })

  it('excludes lab names that only exist on inactive (soft-deleted) labworks', async () => {
    const response = await api()
      .get('/api/labworks/labs')
      .set('Authorization', `Bearer ${staffToken}`)

    expect(response.body.data).not.toContain('Inactive Only Lab')
  })

  it('does not leak lab names from another tenant', async () => {
    const response = await api()
      .get('/api/labworks/labs')
      .set('Authorization', `Bearer ${staffToken}`)

    expect(response.body.data).not.toContain('Only In Other Tenant Lab')
  })

  it('returns an empty array for a tenant with no labworks', async () => {
    const response = await api()
      .get('/api/labworks/labs')
      .set('Authorization', `Bearer ${emptyTenantStaffToken}`)

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ success: true, data: [] })
  })

  it('resolves to the /labs handler rather than being swallowed by /:id (route ordering)', async () => {
    const response = await api()
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

describe('GET /api/labworks?overdue= (overdue filter & stats)', () => {
  // Isolated tenant so the overdue counts/results aren't polluted by
  // labworks seeded in the describe blocks above.
  let tenantId: string
  let staffToken: string
  const testSlug = `test-labworks-overdue-${Date.now()}`

  // Boundaries computed the same way the service computes them
  // (getStartOfToday: local "now" truncated to local midnight), so this
  // suite is correct regardless of which timezone/date it runs on.
  function daysFromToday(offsetDays: number): Date {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    d.setDate(d.getDate() + offsetDays)
    return d
  }


  let overdueLabworkId: string

  beforeAll(async () => {
    const tenant = await prisma.tenant.create({
      data: { name: 'Test Clinic for Labwork Overdue', slug: testSlug, currency: 'USD', timezone: 'America/New_York' },
    })
    tenantId = tenant.id

    let freePlan = await prisma.plan.findUnique({ where: { name: 'free' } })
    if (!freePlan) {
      freePlan = await prisma.plan.create({
        data: { name: 'free', displayName: 'Free', price: 0, maxAdmins: 1, maxDoctors: 3, maxPatients: 50 },
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

    const hashedPassword = await hashPassword('password123')
    const staffUser = await prisma.user.create({
      data: {
        tenantId,
        email: 'staff@labworks-overdue-test.com',
        firstName: 'Staff',
        lastName: 'User',
        passwordHash: hashedPassword,
        role: 'STAFF',
      },
    })
    staffToken = generateToken(staffUser.id, tenantId, 'STAFF')

    // Active, undelivered, due yesterday -> the only labwork that should be
    // considered overdue.
    const overdue = await prisma.labwork.create({
      data: { tenantId, lab: 'Overdue Lab', date: daysFromToday(-1), isDelivered: false, isActive: true, price: 100 },
    })
    overdueLabworkId = overdue.id

    // Active, undelivered, due today -> NOT overdue (boundary: due today is
    // not yet overdue).
    await prisma.labwork.create({
      data: { tenantId, lab: 'Due Today Lab', date: daysFromToday(0), isDelivered: false, isActive: true, price: 100 },
    })

    // Active, undelivered, due tomorrow -> NOT overdue (future).
    await prisma.labwork.create({
      data: { tenantId, lab: 'Future Lab', date: daysFromToday(1), isDelivered: false, isActive: true, price: 100 },
    })

    // Active, DELIVERED, due yesterday -> NOT overdue (delivered).
    await prisma.labwork.create({
      data: { tenantId, lab: 'Delivered Past Lab', date: daysFromToday(-1), isDelivered: true, isActive: true, price: 100 },
    })

    // Inactive (soft-deleted), undelivered, due yesterday -> NOT overdue and
    // excluded from the default active-only listing regardless of the
    // overdue filter.
    await prisma.labwork.create({
      data: { tenantId, lab: 'Deleted Past Lab', date: daysFromToday(-1), isDelivered: false, isActive: false, price: 100 },
    })
  })

  afterAll(async () => {
    await prisma.labwork.deleteMany({ where: { tenantId } })
    await prisma.user.deleteMany({ where: { tenantId } })
    await prisma.subscription.deleteMany({ where: { tenantId } })
    await prisma.tenant.delete({ where: { id: tenantId } })
  })

  describe('GET /api/labworks?overdue=true', () => {
    it('returns only the active, undelivered, strictly-past labwork', async () => {
      const response = await api()
        .get('/api/labworks?overdue=true')
        .set('Authorization', `Bearer ${staffToken}`)

      expect(response.status).toBe(200)
      const labs = response.body.data.map((l: { lab: string }) => l.lab)
      expect(labs).toEqual(['Overdue Lab'])
    })

    it('excludes a labwork due today (boundary: due today is not overdue)', async () => {
      const response = await api()
        .get('/api/labworks?overdue=true')
        .set('Authorization', `Bearer ${staffToken}`)

      const labs = response.body.data.map((l: { lab: string }) => l.lab)
      expect(labs).not.toContain('Due Today Lab')
    })

    it('excludes a future-dated labwork', async () => {
      const response = await api()
        .get('/api/labworks?overdue=true')
        .set('Authorization', `Bearer ${staffToken}`)

      const labs = response.body.data.map((l: { lab: string }) => l.lab)
      expect(labs).not.toContain('Future Lab')
    })

    it('excludes a delivered labwork even if its date is in the past', async () => {
      const response = await api()
        .get('/api/labworks?overdue=true')
        .set('Authorization', `Bearer ${staffToken}`)

      const labs = response.body.data.map((l: { lab: string }) => l.lab)
      expect(labs).not.toContain('Delivered Past Lab')
    })

    it('excludes a soft-deleted (inactive) labwork even if its date is in the past', async () => {
      const response = await api()
        .get('/api/labworks?overdue=true')
        .set('Authorization', `Bearer ${staffToken}`)

      const labs = response.body.data.map((l: { lab: string }) => l.lab)
      expect(labs).not.toContain('Deleted Past Lab')
    })

    it('returns the correct pagination total for the overdue-filtered set', async () => {
      const response = await api()
        .get('/api/labworks?overdue=true')
        .set('Authorization', `Bearer ${staffToken}`)

      expect(response.body.pagination.total).toBe(1)
    })
  })

  describe('GET /api/labworks?overdue=false / omitted (route parsing regression)', () => {
    it('returns the full unfiltered active set when overdue is explicitly false', async () => {
      const response = await api()
        .get('/api/labworks?overdue=false')
        .set('Authorization', `Bearer ${staffToken}`)

      expect(response.status).toBe(200)
      const labs = response.body.data.map((l: { lab: string }) => l.lab)
      // All 4 active labworks (the 5th is soft-deleted and excluded by the
      // default isActive filter), regardless of delivery/date.
      expect(labs.sort()).toEqual(['Due Today Lab', 'Future Lab', 'Overdue Lab', 'Delivered Past Lab'].sort())
    })

    it('returns the same full unfiltered active set when overdue is omitted entirely', async () => {
      const response = await api()
        .get('/api/labworks')
        .set('Authorization', `Bearer ${staffToken}`)

      expect(response.status).toBe(200)
      const labs = response.body.data.map((l: { lab: string }) => l.lab)
      expect(labs.sort()).toEqual(['Due Today Lab', 'Future Lab', 'Overdue Lab', 'Delivered Past Lab'].sort())
    })
  })

  describe('GET /api/labworks/stats — overdue count', () => {
    it('reports the overdue count alongside the other stats fields', async () => {
      const response = await api()
        .get('/api/labworks/stats')
        .set('Authorization', `Bearer ${staffToken}`)

      expect(response.status).toBe(200)
      expect(response.body.data.overdue).toBe(1)
      expect(response.body.data.total).toBe(4)
    })

    it('excludes the overdue labwork from the count once it is marked delivered (respects live state, not a cached flag)', async () => {
      // STAFF cannot update labworks; use a fresh ADMIN token scoped to this tenant.
      const hashedPassword = await hashPassword('password123')
      const adminUser = await prisma.user.create({
        data: {
          tenantId,
          email: 'admin@labworks-overdue-test.com',
          firstName: 'Admin',
          lastName: 'User',
          passwordHash: hashedPassword,
          role: 'ADMIN',
        },
      })
      const adminToken = generateToken(adminUser.id, tenantId, 'ADMIN')

      const updateResponse = await api()
        .put(`/api/labworks/${overdueLabworkId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ isDelivered: true })
      expect(updateResponse.status).toBe(200)

      const statsResponse = await api()
        .get('/api/labworks/stats')
        .set('Authorization', `Bearer ${staffToken}`)

      expect(statsResponse.body.data.overdue).toBe(0)

      // Restore state for any tests that might run after this one in the
      // same describe block (none currently do, but keeps this test
      // self-contained rather than leaking mutated state).
      await api()
        .put(`/api/labworks/${overdueLabworkId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ isDelivered: false })
    })

    it('intersects the overdue count with an explicit from/to window', async () => {
      // The seeded "Overdue Lab" is dated yesterday. A `to` window that ends
      // before yesterday must exclude it from the overdue count.
      const farPastTo = daysFromToday(-10).toISOString().slice(0, 10)

      const response = await api()
        .get(`/api/labworks/stats?to=${farPastTo}`)
        .set('Authorization', `Bearer ${staffToken}`)

      expect(response.status).toBe(200)
      expect(response.body.data.overdue).toBe(0)
    })
  })
})

describe('GET /api/labworks/export (CSV export)', () => {
  let tenantId: string
  let otherTenantId: string
  let staffToken: string
  let doctorToken: string
  let clinicAdminToken: string
  let adminToken: string
  let ownerToken: string
  let doctorId: string
  let garciaPatientId: string
  const testSlug = `test-labworks-export-${Date.now()}`
  const otherSlug = `test-labworks-export-other-${Date.now()}`

  async function createTenant(slug: string, name: string) {
    const tenant = await prisma.tenant.create({
      data: { name, slug, currency: 'USD', timezone: 'America/New_York' },
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
          maxPatients: 50,
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

    const tenant = await createTenant(testSlug, 'Test Clinic for Labwork Export')
    tenantId = tenant.id

    const staffUser = await prisma.user.create({
      data: {
        tenantId,
        email: 'staff@labworks-export-test.com',
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
        email: 'doctor@labworks-export-test.com',
        firstName: 'Doctor',
        lastName: 'User',
        passwordHash: hashedPassword,
        role: 'DOCTOR',
      },
    })
    doctorToken = generateToken(doctorUser.id, tenantId, 'DOCTOR')

    const clinicAdminUser = await prisma.user.create({
      data: {
        tenantId,
        email: 'clinic-admin@labworks-export-test.com',
        firstName: 'Clinic',
        lastName: 'Admin',
        passwordHash: hashedPassword,
        role: 'CLINIC_ADMIN',
      },
    })
    clinicAdminToken = generateToken(clinicAdminUser.id, tenantId, 'CLINIC_ADMIN')

    const adminUser = await prisma.user.create({
      data: {
        tenantId,
        email: 'admin@labworks-export-test.com',
        firstName: 'Admin',
        lastName: 'User',
        passwordHash: hashedPassword,
        role: 'ADMIN',
      },
    })
    adminToken = generateToken(adminUser.id, tenantId, 'ADMIN')

    const ownerUser = await prisma.user.create({
      data: {
        tenantId,
        email: 'owner@labworks-export-test.com',
        firstName: 'Owner',
        lastName: 'User',
        passwordHash: hashedPassword,
        role: 'OWNER',
      },
    })
    ownerToken = generateToken(ownerUser.id, tenantId, 'OWNER')

    const doctor = await prisma.doctor.create({
      data: { tenantId, firstName: 'Dr. Jane', lastName: 'Root', email: 'dr-jane-root@labworks-export-test.com' },
    })
    doctorId = doctor.id

    const garciaPatient = await prisma.patient.create({
      data: { tenantId, firstName: 'Maria', lastName: 'Garcia' },
    })
    garciaPatientId = garciaPatient.id

    // Paid, delivered, has a doctor assigned, lab name contains a comma (CSV escaping).
    await prisma.labwork.create({
      data: {
        tenantId,
        patientId: garciaPatientId,
        lab: 'Acme, Dental Lab',
        phoneNumber: '+1 555-0100',
        date: new Date('2026-02-01'),
        note: 'Said "ready" on pickup',
        price: 150,
        isPaid: true,
        isDelivered: true,
        doctorIds: [doctorId],
      },
    })
    // Unpaid, undelivered, no patient/doctor/phone/note.
    await prisma.labwork.create({
      data: {
        tenantId,
        lab: 'Budget Lab',
        date: new Date('2026-02-10'),
        price: 75,
        isPaid: false,
        isDelivered: false,
      },
    })
    // Outside the from/to window used below, for date-range filter coverage.
    await prisma.labwork.create({
      data: {
        tenantId,
        lab: 'Out Of Range Lab',
        date: new Date('2025-01-01'),
        price: 50,
        isPaid: false,
        isDelivered: false,
      },
    })
    // Soft-deleted — must never appear in the export regardless of filters.
    await prisma.labwork.create({
      data: {
        tenantId,
        lab: 'Deleted Lab',
        date: new Date('2026-02-05'),
        price: 20,
        isActive: false,
      },
    })

    // Other tenant: a labwork that would match filters below must never leak in.
    const otherTenant = await createTenant(otherSlug, 'Other Clinic for Labwork Export')
    otherTenantId = otherTenant.id
    await prisma.labwork.create({
      data: { tenantId: otherTenantId, lab: 'Acme, Dental Lab', date: new Date('2026-02-01'), price: 999 },
    })
  })

  afterAll(async () => {
    await prisma.labwork.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } })
    await prisma.patient.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } })
    await prisma.doctor.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } })
    await prisma.user.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } })
    await prisma.subscription.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } })
    await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, otherTenantId] } } })
  })

  it('rejects an unauthenticated request (401), same as GET /', async () => {
    const response = await api().get('/api/labworks/export')

    expect(response.status).toBe(401)
  })

  describe('permission boundary (requires Permission.DATA_EXPORT, ADMIN+ only)', () => {
    it('denies STAFF (403)', async () => {
      const response = await api()
        .get('/api/labworks/export')
        .set('Authorization', `Bearer ${staffToken}`)

      expect(response.status).toBe(403)
      expect(response.body).toHaveProperty('error')
    })

    it('denies DOCTOR (403)', async () => {
      const response = await api()
        .get('/api/labworks/export')
        .set('Authorization', `Bearer ${doctorToken}`)

      expect(response.status).toBe(403)
      expect(response.body).toHaveProperty('error')
    })

    it('denies CLINIC_ADMIN (403)', async () => {
      const response = await api()
        .get('/api/labworks/export')
        .set('Authorization', `Bearer ${clinicAdminToken}`)

      expect(response.status).toBe(403)
      expect(response.body).toHaveProperty('error')
    })

    it('allows ADMIN (200)', async () => {
      const response = await api()
        .get('/api/labworks/export')
        .set('Authorization', `Bearer ${adminToken}`)

      expect(response.status).toBe(200)
    })

    it('allows OWNER (200)', async () => {
      const response = await api()
        .get('/api/labworks/export')
        .set('Authorization', `Bearer ${ownerToken}`)

      expect(response.status).toBe(200)
    })
  })

  it('responds with a text/csv content type (charset=utf-8)', async () => {
    const response = await api()
      .get('/api/labworks/export')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(response.headers['content-type']).toBe('text/csv; charset=utf-8')
  })

  it('responds with a Content-Disposition attachment header naming a .csv file', async () => {
    const response = await api()
      .get('/api/labworks/export')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(response.headers['content-disposition']).toMatch(
      /^attachment; filename="labworks-\d{4}-\d{2}-\d{2}\.csv"$/
    )
  })

  it('resolves to the /export handler rather than being swallowed by /:id (route ordering)', async () => {
    const response = await api()
      .get('/api/labworks/export')
      .set('Authorization', `Bearer ${adminToken}`)

    // The /:id handler would respond 404 with `{ success: false, error: 'Labwork not found' }`
    // (treating "export" as an :id param) instead of a 200 CSV payload.
    expect(response.status).toBe(200)
    expect(response.body).not.toHaveProperty('error')
    expect(response.headers['content-type']).toContain('text/csv')
  })

  it('prepends a UTF-8 BOM before the header row', async () => {
    const response = await api()
      .get('/api/labworks/export')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(response.text.charCodeAt(0)).toBe(0xfeff)
    expect(response.text.slice(1)).toMatch(/^Fecha,Laboratorio,Teléfono,Paciente,Doctor\(es\),Precio,Pagado,Entregado,Nota/)
  })

  it('includes all active labworks for the tenant when no filters are applied', async () => {
    const response = await api()
      .get('/api/labworks/export')
      .set('Authorization', `Bearer ${adminToken}`)

    const body = response.text.replace(/^\uFEFF/, '')
    const dataRows = body.split('\n').slice(1)
    expect(dataRows).toHaveLength(3) // 4 seeded minus 1 soft-deleted

    expect(body).toContain('"Acme, Dental Lab"')
    expect(body).toContain('Budget Lab')
    expect(body).toContain('Out Of Range Lab')
    expect(body).not.toContain('Deleted Lab')
  })

  it('escapes the comma in a lab name and the embedded quote in a note (RFC4180)', async () => {
    const response = await api()
      .get('/api/labworks/export')
      .set('Authorization', `Bearer ${adminToken}`)

    const body = response.text.replace(/^\uFEFF/, '')
    expect(body).toContain('"Acme, Dental Lab"')
    expect(body).toContain('"Said ""ready"" on pickup"')
  })

  it('resolves the assigned doctor name and patient name into their respective columns', async () => {
    const response = await api()
      .get('/api/labworks/export')
      .set('Authorization', `Bearer ${adminToken}`)

    const body = response.text.replace(/^\uFEFF/, '')
    const row = body.split('\n').find((line) => line.includes('Acme, Dental Lab'))
    expect(row).toContain('Maria Garcia')
    expect(row).toContain('Dr. Jane Root')
  })

  it('renders Sí/No for isPaid/isDelivered and leaves empty columns for a labwork with no patient/doctor/phone/note', async () => {
    const response = await api()
      .get('/api/labworks/export')
      .set('Authorization', `Bearer ${adminToken}`)

    const body = response.text.replace(/^\uFEFF/, '')
    const budgetRow = body.split('\n').find((line) => line.includes('Budget Lab'))
    expect(budgetRow).toBe('2026-02-10,Budget Lab,,,,75,No,No,')

    const acmeRow = body.split('\n').find((line) => line.includes('Acme, Dental Lab'))
    expect(acmeRow).toContain(',Sí,Sí,')
  })

  it('applies the search filter, returning only labworks matching the lab or patient name', async () => {
    const response = await api()
      .get('/api/labworks/export?search=Budget')
      .set('Authorization', `Bearer ${adminToken}`)

    const body = response.text.replace(/^\uFEFF/, '')
    const dataRows = body.split('\n').slice(1)
    expect(dataRows).toHaveLength(1)
    expect(body).toContain('Budget Lab')
  })

  it('applies the isPaid filter', async () => {
    const response = await api()
      .get('/api/labworks/export?isPaid=true')
      .set('Authorization', `Bearer ${adminToken}`)

    const body = response.text.replace(/^\uFEFF/, '')
    const dataRows = body.split('\n').slice(1)
    expect(dataRows).toHaveLength(1)
    expect(body).toContain('Acme, Dental Lab')
    expect(body).not.toContain('Budget Lab')
  })

  it('applies the isDelivered filter', async () => {
    const response = await api()
      .get('/api/labworks/export?isDelivered=false')
      .set('Authorization', `Bearer ${adminToken}`)

    const body = response.text.replace(/^\uFEFF/, '')
    expect(body).not.toContain('Acme, Dental Lab')
    expect(body).toContain('Budget Lab')
    expect(body).toContain('Out Of Range Lab')
  })

  it('applies the patientId filter', async () => {
    const response = await api()
      .get(`/api/labworks/export?patientId=${garciaPatientId}`)
      .set('Authorization', `Bearer ${adminToken}`)

    const body = response.text.replace(/^\uFEFF/, '')
    const dataRows = body.split('\n').slice(1)
    expect(dataRows).toHaveLength(1)
    expect(body).toContain('Acme, Dental Lab')
  })

  it('applies the from/to date-range filter', async () => {
    const response = await api()
      .get('/api/labworks/export?from=2026-02-01&to=2026-02-28')
      .set('Authorization', `Bearer ${adminToken}`)

    const body = response.text.replace(/^\uFEFF/, '')
    expect(body).toContain('Acme, Dental Lab')
    expect(body).toContain('Budget Lab')
    expect(body).not.toContain('Out Of Range Lab')
  })

  it('applies the overdue filter (active, undelivered, strictly-past labworks only)', async () => {
    const response = await api()
      .get('/api/labworks/export?overdue=true')
      .set('Authorization', `Bearer ${adminToken}`)

    const body = response.text.replace(/^\uFEFF/, '')
    // Both "Budget Lab" (2026-02-10) and "Out Of Range Lab" (2025-01-01) are
    // undelivered and in the past relative to "now" in this test suite's era
    // (seeded dates are far in the past relative to any real run date), so
    // both are overdue; "Acme, Dental Lab" is delivered and must be excluded.
    expect(body).not.toContain('Acme, Dental Lab')
    expect(body).toContain('Budget Lab')
    expect(body).toContain('Out Of Range Lab')
  })

  it('never leaks another tenant\'s labworks into the export', async () => {
    const response = await api()
      .get('/api/labworks/export')
      .set('Authorization', `Bearer ${adminToken}`)

    const body = response.text.replace(/^\uFEFF/, '')
    const dataRows = body.split('\n').slice(1)
    expect(dataRows).toHaveLength(3)
  })

  it('returns just the header row (no data rows) when filters match nothing', async () => {
    const response = await api()
      .get('/api/labworks/export?search=NoSuchLabAtAll')
      .set('Authorization', `Bearer ${adminToken}`)

    const body = response.text.replace(/^\uFEFF/, '')
    expect(body).toBe('Fecha,Laboratorio,Teléfono,Paciente,Doctor(es),Precio,Pagado,Entregado,Nota')
  })
})

describe('Doctor assignment on labworks (task #242)', () => {
  let tenantId: string
  let otherTenantId: string
  let adminToken: string
  let clinicAdminToken: string
  let doctorToken: string
  let doctorAId: string
  let doctorBId: string
  let doctorInactiveId: string
  let otherDoctorId: string
  const testSlug = `test-labworks-doctors-${Date.now()}`
  const otherSlug = `test-labworks-doctors-other-${Date.now()}`

  async function createTenant(slug: string, name: string) {
    const tenant = await prisma.tenant.create({
      data: { name, slug, currency: 'USD', timezone: 'America/New_York' },
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
          maxPatients: 50,
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

    const tenant = await createTenant(testSlug, 'Test Clinic for Labwork Doctors')
    tenantId = tenant.id

    const adminUser = await prisma.user.create({
      data: {
        tenantId,
        email: 'admin@labworks-doctors-test.com',
        firstName: 'Admin',
        lastName: 'User',
        passwordHash: hashedPassword,
        role: 'ADMIN',
      },
    })
    adminToken = generateToken(adminUser.id, tenantId, 'ADMIN')

    const clinicAdminUser = await prisma.user.create({
      data: {
        tenantId,
        email: 'clinic-admin@labworks-doctors-test.com',
        firstName: 'Clinic',
        lastName: 'Admin',
        passwordHash: hashedPassword,
        role: 'CLINIC_ADMIN',
      },
    })
    clinicAdminToken = generateToken(clinicAdminUser.id, tenantId, 'CLINIC_ADMIN')

    const doctorUser = await prisma.user.create({
      data: {
        tenantId,
        email: 'doctor@labworks-doctors-test.com',
        firstName: 'Doctor',
        lastName: 'User',
        passwordHash: hashedPassword,
        role: 'DOCTOR',
      },
    })
    doctorToken = generateToken(doctorUser.id, tenantId, 'DOCTOR')

    // Linked to doctorUser via userId, so getLinkedDoctorId() resolves it —
    // this is what lets the DOCTOR-role caller pass requireOwnership at all.
    const doctorA = await prisma.doctor.create({
      data: { tenantId, firstName: 'Alice', lastName: 'Root', userId: doctorUser.id },
    })
    doctorAId = doctorA.id

    const doctorB = await prisma.doctor.create({
      data: { tenantId, firstName: 'Bob', lastName: 'Crown' },
    })
    doctorBId = doctorB.id

    const doctorInactive = await prisma.doctor.create({
      data: { tenantId, firstName: 'Carol', lastName: 'Bridge', isActive: false },
    })
    doctorInactiveId = doctorInactive.id

    const otherTenant = await createTenant(otherSlug, 'Other Clinic for Labwork Doctors')
    otherTenantId = otherTenant.id
    const otherDoctor = await prisma.doctor.create({
      data: { tenantId: otherTenantId, firstName: 'Zoe', lastName: 'Outside' },
    })
    otherDoctorId = otherDoctor.id
  })

  afterAll(async () => {
    await prisma.labwork.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } })
    await prisma.doctor.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } })
    await prisma.user.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } })
    await prisma.subscription.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } })
    await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, otherTenantId] } } })
  })

  describe('doctor resolution across CRUD', () => {
    it('POST create resolves doctorIds into a doctors array (id, name, isActive), in doctorIds order', async () => {
      const res = await api()
        .post('/api/labworks')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ lab: 'Doctor Resolution Lab', date: '2026-04-01', price: 100, doctorIds: [doctorAId, doctorBId] })

      expect(res.status).toBe(201)
      expect(res.body.data.doctorIds).toEqual([doctorAId, doctorBId])
      expect(res.body.data.doctors).toEqual([
        { id: doctorAId, firstName: 'Alice', lastName: 'Root', isActive: true },
        { id: doctorBId, firstName: 'Bob', lastName: 'Crown', isActive: true },
      ])
    })

    it('a deactivated doctor still resolves in `doctors` (isActive: false), not dropped', async () => {
      const res = await api()
        .post('/api/labworks')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ lab: 'Inactive Doctor Lab', date: '2026-04-02', price: 50, doctorIds: [doctorInactiveId] })

      expect(res.status).toBe(201)
      expect(res.body.data.doctors).toEqual([
        { id: doctorInactiveId, firstName: 'Carol', lastName: 'Bridge', isActive: false },
      ])
    })

    it('GET /:id resolves the same doctors array as create', async () => {
      const createRes = await api()
        .post('/api/labworks')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ lab: 'Get By Id Lab', date: '2026-04-03', price: 60, doctorIds: [doctorAId] })
      const id = createRes.body.data.id

      const res = await api().get(`/api/labworks/${id}`).set('Authorization', `Bearer ${adminToken}`)

      expect(res.status).toBe(200)
      expect(res.body.data.doctors).toEqual([{ id: doctorAId, firstName: 'Alice', lastName: 'Root', isActive: true }])
    })

    it('GET / (list) resolves the doctors array for each item on the page', async () => {
      const createRes = await api()
        .post('/api/labworks')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ lab: 'List Doctor Lab', date: '2026-04-03', price: 60, doctorIds: [doctorAId] })
      const id = createRes.body.data.id

      const res = await api().get('/api/labworks?limit=100').set('Authorization', `Bearer ${adminToken}`)

      expect(res.status).toBe(200)
      const created = res.body.data.find((l: { id: string }) => l.id === id)
      expect(created.doctors).toEqual([{ id: doctorAId, firstName: 'Alice', lastName: 'Root', isActive: true }])
    })

    it('PUT update re-resolves doctors after changing doctorIds', async () => {
      const createRes = await api()
        .post('/api/labworks')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ lab: 'Update Doctor Lab', date: '2026-04-04', price: 70, doctorIds: [doctorAId] })
      const id = createRes.body.data.id

      const res = await api()
        .put(`/api/labworks/${id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ doctorIds: [doctorBId] })

      expect(res.status).toBe(200)
      expect(res.body.data.doctors).toEqual([{ id: doctorBId, firstName: 'Bob', lastName: 'Crown', isActive: true }])
    })

    it('DELETE (soft delete) response still resolves the assigned doctors', async () => {
      const createRes = await api()
        .post('/api/labworks')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ lab: 'Delete Doctor Lab', date: '2026-04-05', price: 80, doctorIds: [doctorAId] })
      const id = createRes.body.data.id

      const res = await api().delete(`/api/labworks/${id}`).set('Authorization', `Bearer ${adminToken}`)

      expect(res.status).toBe(200)
      expect(res.body.data.doctors).toEqual([{ id: doctorAId, firstName: 'Alice', lastName: 'Root', isActive: true }])
    })

    it('PUT /:id/restore response still resolves the assigned doctors', async () => {
      const createRes = await api()
        .post('/api/labworks')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ lab: 'Restore Doctor Lab', date: '2026-04-06', price: 90, doctorIds: [doctorAId] })
      const id = createRes.body.data.id
      await api().delete(`/api/labworks/${id}`).set('Authorization', `Bearer ${adminToken}`)

      const res = await api().put(`/api/labworks/${id}/restore`).set('Authorization', `Bearer ${adminToken}`)

      expect(res.status).toBe(200)
      expect(res.body.data.doctors).toEqual([{ id: doctorAId, firstName: 'Alice', lastName: 'Root', isActive: true }])
    })
  })

  describe('DOCTOR_NOT_FOUND validation (cross-tenant and nonexistent doctor ids)', () => {
    it('rejects create with a doctor id belonging to a different tenant (400 DOCTOR_NOT_FOUND)', async () => {
      const res = await api()
        .post('/api/labworks')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ lab: 'Cross Tenant Lab', date: '2026-04-07', price: 40, doctorIds: [otherDoctorId] })

      expect(res.status).toBe(400)
      expect(res.body.error).toBe('One or more doctors do not belong to this clinic')
    })

    it('rejects update with a doctor id belonging to a different tenant (400 DOCTOR_NOT_FOUND)', async () => {
      const createRes = await api()
        .post('/api/labworks')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ lab: 'Cross Tenant Update Lab', date: '2026-04-08', price: 45 })
      const id = createRes.body.data.id

      const res = await api()
        .put(`/api/labworks/${id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ doctorIds: [otherDoctorId] })

      expect(res.status).toBe(400)
      expect(res.body.error).toBe('One or more doctors do not belong to this clinic')
    })

    it('rejects create with a doctor id that does not exist at all (400 DOCTOR_NOT_FOUND)', async () => {
      const res = await api()
        .post('/api/labworks')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ lab: 'Nonexistent Doctor Lab', date: '2026-04-09', price: 35, doctorIds: ['nonexistent-doctor-id'] })

      expect(res.status).toBe(400)
      expect(res.body.error).toBe('One or more doctors do not belong to this clinic')
    })
  })

  describe('DOCTOR role cannot reassign doctorIds via PUT (403); CLINIC_ADMIN+ can', () => {
    it('denies a DOCTOR caller who sends a different doctorIds set (403)', async () => {
      const createRes = await api()
        .post('/api/labworks')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ lab: 'Doctor Guard Lab 1', date: '2026-04-10', price: 55, doctorIds: [doctorAId] })
      const id = createRes.body.data.id

      const res = await api()
        .put(`/api/labworks/${id}`)
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({ doctorIds: [doctorBId] })

      expect(res.status).toBe(403)
      expect(res.body.error).toBe('Only clinic admins can change the doctors assigned to a labwork')
    })

    it('allows a DOCTOR caller who resends the SAME doctorIds set alongside another field change', async () => {
      const createRes = await api()
        .post('/api/labworks')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ lab: 'Doctor Guard Lab 2', date: '2026-04-11', price: 65, doctorIds: [doctorAId] })
      const id = createRes.body.data.id

      const res = await api()
        .put(`/api/labworks/${id}`)
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({ doctorIds: [doctorAId], note: 'seen by the assigned doctor' })

      expect(res.status).toBe(200)
      expect(res.body.data.note).toBe('seen by the assigned doctor')
    })

    it('allows a DOCTOR caller who resends an EQUIVALENT set (reordered + duplicated)', async () => {
      const createRes = await api()
        .post('/api/labworks')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ lab: 'Doctor Guard Lab 3', date: '2026-04-12', price: 75, doctorIds: [doctorAId, doctorBId] })
      const id = createRes.body.data.id

      const res = await api()
        .put(`/api/labworks/${id}`)
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({ doctorIds: [doctorBId, doctorAId, doctorAId] })

      expect(res.status).toBe(200)
    })

    it('allows CLINIC_ADMIN to reassign doctorIds to a different set (guard only restricts below CLINIC_ADMIN)', async () => {
      const createRes = await api()
        .post('/api/labworks')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ lab: 'Doctor Guard Lab 4', date: '2026-04-13', price: 85, doctorIds: [doctorAId] })
      const id = createRes.body.data.id

      const res = await api()
        .put(`/api/labworks/${id}`)
        .set('Authorization', `Bearer ${clinicAdminToken}`)
        .send({ doctorIds: [doctorBId] })

      expect(res.status).toBe(200)
      expect(res.body.data.doctorIds).toEqual([doctorBId])
    })
  })
})

// Task #243: `status` lifecycle (schema + backend). Covers the
// resolveLifecycle lockstep invariant (isDelivered === (status === 'RECEIVED'))
// through the real create/update routes, the contradiction 400, and the
// `status` query-param parsing on both GET / and GET /export.
describe('Labwork status lifecycle (task #243)', () => {
  let tenantId: string
  let adminToken: string
  const testSlug = `test-labworks-status-${Date.now()}`

  beforeAll(async () => {
    const tenant = await prisma.tenant.create({
      data: { name: 'Test Clinic for Labwork Status', slug: testSlug, currency: 'USD', timezone: 'America/New_York' },
    })
    tenantId = tenant.id

    let freePlan = await prisma.plan.findUnique({ where: { name: 'free' } })
    if (!freePlan) {
      freePlan = await prisma.plan.create({
        data: { name: 'free', displayName: 'Free', price: 0, maxAdmins: 1, maxDoctors: 3, maxPatients: 50 },
      })
    }

    await prisma.subscription.create({
      data: {
        tenantId,
        planId: freePlan.id,
        status: 'ACTIVE',
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    })

    const hashedPassword = await hashPassword('password123')
    const adminUser = await prisma.user.create({
      data: {
        tenantId,
        email: 'admin@labworks-status-test.com',
        firstName: 'Admin',
        lastName: 'User',
        passwordHash: hashedPassword,
        role: 'ADMIN',
      },
    })
    adminToken = generateToken(adminUser.id, tenantId, 'ADMIN')
  })

  afterAll(async () => {
    await prisma.labwork.deleteMany({ where: { tenantId } })
    await prisma.user.deleteMany({ where: { tenantId } })
    await prisma.subscription.deleteMany({ where: { tenantId } })
    await prisma.tenant.delete({ where: { id: tenantId } })
  })

  async function createLabwork(body: Record<string, unknown>) {
    return api().post('/api/labworks').set('Authorization', `Bearer ${adminToken}`).send({
      lab: 'Status Test Lab',
      date: '2026-05-01',
      price: 10,
      ...body,
    })
  }

  describe('createLabwork — lockstep invariant', () => {
    it('form path: status given, no isDelivered -> isDelivered derived (status:SENT -> isDelivered:false)', async () => {
      const res = await createLabwork({ status: 'SENT' })

      expect(res.status).toBe(201)
      expect(res.body.data.status).toBe('SENT')
      expect(res.body.data.isDelivered).toBe(false)
    })

    it('form path: status:RECEIVED -> isDelivered derived true', async () => {
      const res = await createLabwork({ status: 'RECEIVED' })

      expect(res.status).toBe(201)
      expect(res.body.data.status).toBe('RECEIVED')
      expect(res.body.data.isDelivered).toBe(true)
    })

    it('card-toggle path: only isDelivered:true given -> status forced to RECEIVED', async () => {
      const res = await createLabwork({ isDelivered: true })

      expect(res.status).toBe(201)
      expect(res.body.data.status).toBe('RECEIVED')
      expect(res.body.data.isDelivered).toBe(true)
    })

    it('neither status nor isDelivered given -> defaults to PENDING/false', async () => {
      const res = await createLabwork({})

      expect(res.status).toBe(201)
      expect(res.body.data.status).toBe('PENDING')
      expect(res.body.data.isDelivered).toBe(false)
    })

    it('every created labwork satisfies isDelivered === (status === RECEIVED)', async () => {
      const res = await createLabwork({ status: 'IN_PROGRESS' })

      expect(res.status).toBe(201)
      expect(res.body.data.isDelivered).toBe(res.body.data.status === 'RECEIVED')
    })
  })

  describe('createLabwork — contradiction -> 400', () => {
    it('rejects status:SENT with isDelivered:true (400 INVALID_STATUS)', async () => {
      const res = await createLabwork({ status: 'SENT', isDelivered: true })

      expect(res.status).toBe(400)
      expect(res.body.error).toBe('status and isDelivered are contradictory')
    })

    it('rejects status:RECEIVED with isDelivered:false (400 INVALID_STATUS)', async () => {
      const res = await createLabwork({ status: 'RECEIVED', isDelivered: false })

      expect(res.status).toBe(400)
      expect(res.body.error).toBe('status and isDelivered are contradictory')
    })
  })

  describe('updateLabwork — lockstep invariant', () => {
    it('card-toggle path (isDelivered:false only): RECEIVED -> demotes to SENT, not left as RECEIVED', async () => {
      const createRes = await createLabwork({ status: 'RECEIVED' })
      const id = createRes.body.data.id
      expect(createRes.body.data.status).toBe('RECEIVED')

      const res = await api()
        .put(`/api/labworks/${id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ isDelivered: false })

      expect(res.status).toBe(200)
      expect(res.body.data.status).toBe('SENT')
      expect(res.body.data.isDelivered).toBe(false)
    })

    it('card-toggle path (isDelivered:false only): a non-RECEIVED current (SENT) is left unchanged', async () => {
      const createRes = await createLabwork({ status: 'SENT' })
      const id = createRes.body.data.id

      const res = await api()
        .put(`/api/labworks/${id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ isDelivered: false })

      expect(res.status).toBe(200)
      expect(res.body.data.status).toBe('SENT')
      expect(res.body.data.isDelivered).toBe(false)
    })

    it('card-toggle path (isDelivered:true only): forces RECEIVED from any prior status', async () => {
      const createRes = await createLabwork({ status: 'IN_PROGRESS' })
      const id = createRes.body.data.id

      const res = await api()
        .put(`/api/labworks/${id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ isDelivered: true })

      expect(res.status).toBe(200)
      expect(res.body.data.status).toBe('RECEIVED')
      expect(res.body.data.isDelivered).toBe(true)
    })

    it('form path: sends status + agreeing isDelivered together -> accepted, lockstep holds', async () => {
      const createRes = await createLabwork({ status: 'PENDING' })
      const id = createRes.body.data.id

      const res = await api()
        .put(`/api/labworks/${id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'RECEIVED', isDelivered: true })

      expect(res.status).toBe(200)
      expect(res.body.data.status).toBe('RECEIVED')
      expect(res.body.data.isDelivered).toBe(true)
    })

    it('updating status alone (no isDelivered) still keeps isDelivered in lockstep', async () => {
      const createRes = await createLabwork({ status: 'PENDING' })
      const id = createRes.body.data.id

      const res = await api()
        .put(`/api/labworks/${id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'IN_PROGRESS' })

      expect(res.status).toBe(200)
      expect(res.body.data.status).toBe('IN_PROGRESS')
      expect(res.body.data.isDelivered).toBe(false)
    })
  })

  describe('updateLabwork — contradiction -> 400', () => {
    it('rejects status:PENDING with isDelivered:true on an existing labwork (400 INVALID_STATUS)', async () => {
      const createRes = await createLabwork({ status: 'PENDING' })
      const id = createRes.body.data.id

      const res = await api()
        .put(`/api/labworks/${id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'PENDING', isDelivered: true })

      expect(res.status).toBe(400)
      expect(res.body.error).toBe('status and isDelivered are contradictory')

      // The rejected write must not have touched the row.
      const unchanged = await api()
        .get(`/api/labworks/${id}`)
        .set('Authorization', `Bearer ${adminToken}`)
      expect(unchanged.body.data.status).toBe('PENDING')
      expect(unchanged.body.data.isDelivered).toBe(false)
    })
  })

  describe('updateLabwork — neither status nor isDelivered in the payload leaves both columns untouched', () => {
    it('a PUT that only changes an unrelated field (note) does not touch status/isDelivered', async () => {
      const createRes = await createLabwork({ status: 'IN_PROGRESS' })
      const id = createRes.body.data.id

      const res = await api()
        .put(`/api/labworks/${id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ note: 'unrelated change' })

      expect(res.status).toBe(200)
      expect(res.body.data.note).toBe('unrelated change')
      expect(res.body.data.status).toBe('IN_PROGRESS')
      expect(res.body.data.isDelivered).toBe(false)
    })

    it('a PUT that only changes an unrelated field does not flip a RECEIVED/delivered row back to PENDING', async () => {
      const createRes = await createLabwork({ status: 'RECEIVED' })
      const id = createRes.body.data.id

      const res = await api()
        .put(`/api/labworks/${id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ price: 20 })

      expect(res.status).toBe(200)
      expect(res.body.data.price).toBe('20')
      expect(res.body.data.status).toBe('RECEIVED')
      expect(res.body.data.isDelivered).toBe(true)
    })
  })

  describe('GET /api/labworks?status= (query-param parsing)', () => {
    let sentId: string
    let inProgressId: string
    let receivedId: string

    beforeAll(async () => {
      sentId = (await createLabwork({ lab: 'Status Filter Sent', status: 'SENT' })).body.data.id
      inProgressId = (await createLabwork({ lab: 'Status Filter InProgress', status: 'IN_PROGRESS' })).body.data.id
      receivedId = (await createLabwork({ lab: 'Status Filter Received', status: 'RECEIVED' })).body.data.id
    })

    it('filters by a single status value', async () => {
      const res = await api()
        .get('/api/labworks?status=SENT')
        .set('Authorization', `Bearer ${adminToken}`)

      expect(res.status).toBe(200)
      const ids = res.body.data.map((l: { id: string }) => l.id)
      expect(ids).toContain(sentId)
      expect(ids).not.toContain(inProgressId)
      expect(ids).not.toContain(receivedId)
    })

    it('filters by a comma-separated list of statuses ({ in: [...] })', async () => {
      const res = await api()
        .get('/api/labworks?status=SENT,IN_PROGRESS')
        .set('Authorization', `Bearer ${adminToken}`)

      expect(res.status).toBe(200)
      const ids = res.body.data.map((l: { id: string }) => l.id)
      expect(ids).toContain(sentId)
      expect(ids).toContain(inProgressId)
      expect(ids).not.toContain(receivedId)
    })

    it('returns 400 for an invalid/unknown status value', async () => {
      const res = await api()
        .get('/api/labworks?status=NOT_A_REAL_STATUS')
        .set('Authorization', `Bearer ${adminToken}`)

      expect(res.status).toBe(400)
      expect(res.body.error).toBe('Invalid status filter')
    })

    it('returns 400 when one value in a comma list is invalid', async () => {
      const res = await api()
        .get('/api/labworks?status=SENT,NOT_A_REAL_STATUS')
        .set('Authorization', `Bearer ${adminToken}`)

      expect(res.status).toBe(400)
      expect(res.body.error).toBe('Invalid status filter')
    })
  })

  describe('GET /api/labworks/export?status= (query-param parsing)', () => {
    beforeAll(async () => {
      await createLabwork({ lab: 'Export Status Filter Sent', status: 'SENT' })
      await createLabwork({ lab: 'Export Status Filter Received', status: 'RECEIVED' })
    })

    it('filters the CSV export by a single status value', async () => {
      const res = await api()
        .get('/api/labworks/export?status=SENT')
        .set('Authorization', `Bearer ${adminToken}`)

      expect(res.status).toBe(200)
      expect(res.text).toContain('Export Status Filter Sent')
      expect(res.text).not.toContain('Export Status Filter Received')
    })

    it('filters the CSV export by a comma-separated list of statuses', async () => {
      const res = await api()
        .get('/api/labworks/export?status=SENT,RECEIVED')
        .set('Authorization', `Bearer ${adminToken}`)

      expect(res.status).toBe(200)
      expect(res.text).toContain('Export Status Filter Sent')
      expect(res.text).toContain('Export Status Filter Received')
    })

    it('returns 400 for an invalid status value on export', async () => {
      const res = await api()
        .get('/api/labworks/export?status=NOT_A_REAL_STATUS')
        .set('Authorization', `Bearer ${adminToken}`)

      expect(res.status).toBe(400)
      expect(res.body.error).toBe('Invalid status filter')
    })
  })
})
