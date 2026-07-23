import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { app } from '../app.js'
import { prisma } from '@dental/database'
import { hashPassword } from '../services/auth.service.js'
import { sign } from 'jsonwebtoken'

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret'

describe('Stats API', () => {
  let tenantId: string
  let ownerToken: string
  let adminToken: string
  let staffToken: string
  let patientId: string
  let doctorId: string
  const testSlug = `test-clinic-stats-${Date.now()}`

  // Helper to generate JWT token
  function generateToken(userId: string, tenantId: string, role: string) {
    return sign({ sub: userId, tenantId, role }, JWT_SECRET, { expiresIn: '1h' })
  }

  beforeAll(async () => {
    // Create a test tenant with a free plan subscription
    const tenant = await prisma.tenant.create({
      data: {
        name: 'Test Clinic for Stats',
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

    // Create users with different roles
    const passwordHash = await hashPassword('TestPass123!')

    const owner = await prisma.user.create({
      data: {
        email: 'owner-stats@test.com',
        passwordHash,
        firstName: 'Owner',
        lastName: 'User',
        role: 'OWNER',
        tenantId: tenant.id,
      },
    })
    ownerToken = generateToken(owner.id, tenant.id, 'OWNER')

    const admin = await prisma.user.create({
      data: {
        email: 'admin-stats@test.com',
        passwordHash,
        firstName: 'Admin',
        lastName: 'User',
        role: 'ADMIN',
        tenantId: tenant.id,
      },
    })
    adminToken = generateToken(admin.id, tenant.id, 'ADMIN')

    const staff = await prisma.user.create({
      data: {
        email: 'staff-stats@test.com',
        passwordHash,
        firstName: 'Staff',
        lastName: 'User',
        role: 'STAFF',
        tenantId: tenant.id,
      },
    })
    staffToken = generateToken(staff.id, tenant.id, 'STAFF')

    // Create test doctor
    const doctor = await prisma.doctor.create({
      data: {
        firstName: 'Dr. Stats',
        lastName: 'Test',
        email: 'dr.stats@test.com',
        tenantId: tenant.id,
      },
    })
    doctorId = doctor.id

    // Create test patient
    const patient = await prisma.patient.create({
      data: {
        firstName: 'Patient',
        lastName: 'Stats',
        email: 'patient.stats@test.com',
        tenantId: tenant.id,
      },
    })
    patientId = patient.id

    // Create some appointments for statistics
    const now = new Date()
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1)

    // Completed paid appointment
    await prisma.appointment.create({
      data: {
        tenantId,
        patientId,
        doctorId,
        startTime: new Date(thisMonthStart.getTime() + 24 * 60 * 60 * 1000),
        endTime: new Date(thisMonthStart.getTime() + 24 * 60 * 60 * 1000 + 30 * 60 * 1000),
        duration: 30,
        status: 'COMPLETED',
        cost: 100,
        isPaid: true,
      },
    })

    // Completed unpaid appointment
    await prisma.appointment.create({
      data: {
        tenantId,
        patientId,
        doctorId,
        startTime: new Date(thisMonthStart.getTime() + 2 * 24 * 60 * 60 * 1000),
        endTime: new Date(thisMonthStart.getTime() + 2 * 24 * 60 * 60 * 1000 + 30 * 60 * 1000),
        duration: 30,
        status: 'COMPLETED',
        cost: 150,
        isPaid: false,
      },
    })

    // Scheduled appointment
    await prisma.appointment.create({
      data: {
        tenantId,
        patientId,
        doctorId,
        startTime: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
        endTime: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000 + 30 * 60 * 1000),
        duration: 30,
        status: 'SCHEDULED',
      },
    })

    // Create a labwork
    await prisma.labwork.create({
      data: {
        tenantId,
        patientId,
        lab: 'Test Lab',
        date: new Date(),
        note: 'Test Labwork',
        isPaid: false,
        isDelivered: false,
        price: 200,
      },
    })
  })

  afterAll(async () => {
    // Clean up in correct order (respect FK constraints)
    await prisma.labwork.deleteMany({ where: { tenantId } })
    await prisma.appointment.deleteMany({ where: { tenantId } })
    await prisma.patient.deleteMany({ where: { tenantId } })
    await prisma.doctor.deleteMany({ where: { tenantId } })
    await prisma.user.deleteMany({ where: { tenantId } })
    await prisma.subscription.deleteMany({ where: { tenantId } })
    await prisma.tenant.delete({ where: { id: tenantId } })
  })

  // ============================================================================
  // GET /api/stats/overview
  // ============================================================================

  describe('GET /api/stats/overview', () => {
    it('should return overview stats for authenticated user', async () => {
      const res = await request(app)
        .get('/api/stats/overview')
        .set('Authorization', `Bearer ${staffToken}`)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data).toHaveProperty('totalPatients')
      expect(res.body.data).toHaveProperty('totalDoctors')
      expect(res.body.data).toHaveProperty('totalAppointments')
      expect(res.body.data).toHaveProperty('appointmentsThisMonth')
      expect(res.body.data).toHaveProperty('monthlyRevenue')
      expect(res.body.data).toHaveProperty('pendingPayments')
      expect(res.body.data).toHaveProperty('pendingLabworks')
      expect(res.body.data.totalPatients).toBe(1)
      expect(res.body.data.totalDoctors).toBe(1)
      expect(res.body.data.pendingLabworks).toBe(1)
    })

    it('should return 401 without authentication', async () => {
      const res = await request(app).get('/api/stats/overview')

      expect(res.status).toBe(401)
    })
  })

  // ============================================================================
  // GET /api/stats/appointments
  // ============================================================================

  describe('GET /api/stats/appointments', () => {
    it('should return appointment stats for current month by default', async () => {
      const res = await request(app)
        .get('/api/stats/appointments')
        .set('Authorization', `Bearer ${staffToken}`)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data).toHaveProperty('total')
      expect(res.body.data).toHaveProperty('byStatus')
      expect(res.body.data).toHaveProperty('byDay')
      expect(typeof res.body.data.total).toBe('number')
    })

    it('should accept custom date range', async () => {
      const now = new Date()
      const startDate = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
      const endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString()

      const res = await request(app)
        .get('/api/stats/appointments')
        .query({ startDate, endDate })
        .set('Authorization', `Bearer ${staffToken}`)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
    })

    it('should return 400 for invalid date format', async () => {
      const res = await request(app)
        .get('/api/stats/appointments')
        .query({ startDate: 'invalid-date' })
        .set('Authorization', `Bearer ${staffToken}`)

      expect(res.status).toBe(400)
    })

    it('should return 400 when startDate is after endDate', async () => {
      const res = await request(app)
        .get('/api/stats/appointments')
        .query({
          startDate: '2026-01-31T00:00:00.000Z',
          endDate: '2026-01-01T00:00:00.000Z',
        })
        .set('Authorization', `Bearer ${staffToken}`)

      expect(res.status).toBe(400)
      expect(res.body.error.message).toBe('startDate must be before or equal to endDate')
    })
  })

  // ============================================================================
  // GET /api/stats/revenue
  // ============================================================================

  describe('GET /api/stats/revenue', () => {
    it('should return revenue stats with default 6 months', async () => {
      const res = await request(app)
        .get('/api/stats/revenue')
        .set('Authorization', `Bearer ${staffToken}`)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data).toHaveProperty('total')
      expect(res.body.data).toHaveProperty('paid')
      expect(res.body.data).toHaveProperty('pending')
      expect(res.body.data).toHaveProperty('byMonth')
      expect(Array.isArray(res.body.data.byMonth)).toBe(true)
    })

    it('should accept custom months parameter', async () => {
      const res = await request(app)
        .get('/api/stats/revenue')
        .query({ months: '12' })
        .set('Authorization', `Bearer ${staffToken}`)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
    })

    it('should return 400 for invalid months parameter', async () => {
      const res = await request(app)
        .get('/api/stats/revenue')
        .query({ months: '100' }) // exceeds max of 24
        .set('Authorization', `Bearer ${staffToken}`)

      expect(res.status).toBe(400)
    })
  })

  // ============================================================================
  // GET /api/stats/patients-growth
  // ============================================================================

  describe('GET /api/stats/patients-growth', () => {
    it('should return patients growth stats', async () => {
      const res = await request(app)
        .get('/api/stats/patients-growth')
        .set('Authorization', `Bearer ${staffToken}`)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data).toHaveProperty('total')
      expect(res.body.data).toHaveProperty('thisMonth')
      expect(res.body.data).toHaveProperty('lastMonth')
      expect(res.body.data).toHaveProperty('growthPercentage')
      expect(res.body.data).toHaveProperty('byMonth')
      expect(res.body.data.total).toBe(1)
    })

    it('should accept custom months parameter', async () => {
      const res = await request(app)
        .get('/api/stats/patients-growth')
        .query({ months: '12' })
        .set('Authorization', `Bearer ${staffToken}`)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
    })
  })

  // ============================================================================
  // GET /api/stats/doctors-performance
  // ============================================================================

  describe('GET /api/stats/doctors-performance', () => {
    it('should return doctor performance stats for admin', async () => {
      const res = await request(app)
        .get('/api/stats/doctors-performance')
        .set('Authorization', `Bearer ${adminToken}`)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(Array.isArray(res.body.data)).toBe(true)
      if (res.body.data.length > 0) {
        expect(res.body.data[0]).toHaveProperty('doctorId')
        expect(res.body.data[0]).toHaveProperty('doctorName')
        expect(res.body.data[0]).toHaveProperty('appointmentsCount')
        expect(res.body.data[0]).toHaveProperty('completedCount')
        expect(res.body.data[0]).toHaveProperty('revenue')
        expect(res.body.data[0]).toHaveProperty('completionRate')
      }
    })

    it('should return doctor performance stats for owner', async () => {
      const res = await request(app)
        .get('/api/stats/doctors-performance')
        .set('Authorization', `Bearer ${ownerToken}`)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
    })

    it('should return 403 for staff user (insufficient role)', async () => {
      const res = await request(app)
        .get('/api/stats/doctors-performance')
        .set('Authorization', `Bearer ${staffToken}`)

      expect(res.status).toBe(403)
    })

    it('should return 400 for invalid startDate format', async () => {
      const res = await request(app)
        .get('/api/stats/doctors-performance')
        .query({ startDate: 'not-a-date' })
        .set('Authorization', `Bearer ${adminToken}`)

      expect(res.status).toBe(400)
    })
  })

  // ============================================================================
  // GET /api/stats/doctors-performance — commission
  // ============================================================================

  describe('GET /api/stats/doctors-performance — commission', () => {
    // A fixed date window in the past keeps this block fully isolated from
    // the "current month" fixtures created in the outer beforeAll (and from
    // real-clock drift), so the range filter can be asserted exactly.
    const rangeStartIso = '2020-01-01T00:00:00.000Z'
    const rangeEndIso = '2020-01-31T23:59:59.999Z'

    let commissionDoctorId: string // 25% commission
    let noCommissionDoctorId: string // commissionPercentage left null

    beforeAll(async () => {
      const doctorWithCommission = await prisma.doctor.create({
        data: {
          tenantId,
          firstName: 'Commission',
          lastName: 'Doctor',
          email: 'commission.doctor@test.com',
          commissionPercentage: 25,
        },
      })
      commissionDoctorId = doctorWithCommission.id

      const doctorWithoutCommission = await prisma.doctor.create({
        data: {
          tenantId,
          firstName: 'NoCommission',
          lastName: 'Doctor',
          email: 'no-commission.doctor@test.com',
        },
      })
      noCommissionDoctorId = doctorWithoutCommission.id

      // In-range, paid, completed: counts toward both revenue and commission base.
      await prisma.appointment.create({
        data: {
          tenantId,
          patientId,
          doctorId: commissionDoctorId,
          startTime: new Date('2020-01-10T10:00:00.000Z'),
          endTime: new Date('2020-01-10T10:30:00.000Z'),
          duration: 30,
          status: 'COMPLETED',
          cost: 100,
          isPaid: true,
        },
      })

      // In-range, UNPAID and not completed: must still count toward the
      // billed commission base (unlike `revenue`, which excludes it).
      await prisma.appointment.create({
        data: {
          tenantId,
          patientId,
          doctorId: commissionDoctorId,
          startTime: new Date('2020-01-15T10:00:00.000Z'),
          endTime: new Date('2020-01-15T10:30:00.000Z'),
          duration: 30,
          status: 'SCHEDULED',
          cost: 50,
          isPaid: false,
        },
      })

      // Out of range: must be excluded from the commission base.
      await prisma.appointment.create({
        data: {
          tenantId,
          patientId,
          doctorId: commissionDoctorId,
          startTime: new Date('2019-12-31T10:00:00.000Z'),
          endTime: new Date('2019-12-31T10:30:00.000Z'),
          duration: 30,
          status: 'COMPLETED',
          cost: 999,
          isPaid: true,
        },
      })

      // In-range labwork with TWO doctors: full price credited to BOTH.
      await prisma.labwork.create({
        data: {
          tenantId,
          patientId,
          lab: 'Commission Lab',
          date: new Date('2020-01-12T00:00:00.000Z'),
          price: 200,
          isPaid: false,
          isDelivered: false,
          doctorIds: [commissionDoctorId, noCommissionDoctorId],
        },
      })

      // Out of range labwork: must be excluded from the commission base.
      await prisma.labwork.create({
        data: {
          tenantId,
          patientId,
          lab: 'Commission Lab Out Of Range',
          date: new Date('2020-02-01T00:00:00.000Z'),
          price: 500,
          isPaid: false,
          isDelivered: false,
          doctorIds: [commissionDoctorId],
        },
      })
    })

    afterAll(async () => {
      await prisma.labwork.deleteMany({
        where: { tenantId, lab: { in: ['Commission Lab', 'Commission Lab Out Of Range'] } },
      })
      await prisma.appointment.deleteMany({
        where: { tenantId, doctorId: { in: [commissionDoctorId, noCommissionDoctorId] } },
      })
      await prisma.doctor.deleteMany({
        where: { id: { in: [commissionDoctorId, noCommissionDoctorId] } },
      })
    })

    it('computes billed commission over the requested date range, crediting a shared labwork in full to both doctors', async () => {
      const res = await request(app)
        .get('/api/stats/doctors-performance')
        .query({ startDate: rangeStartIso, endDate: rangeEndIso })
        .set('Authorization', `Bearer ${adminToken}`)

      expect(res.status).toBe(200)

      const commissionDoctorStats = res.body.data.find(
        (d: { doctorId: string }) => d.doctorId === commissionDoctorId
      )
      const noCommissionDoctorStats = res.body.data.find(
        (d: { doctorId: string }) => d.doctorId === noCommissionDoctorId
      )

      // consultationBase = 100 (paid) + 50 (unpaid) = 150 (999 out-of-range excluded)
      // labworkBase = 200 (500 out-of-range excluded)
      // commission = (150 + 200) * 25 / 100 = 87.5
      expect(commissionDoctorStats.commissionPercentage).toBe(25)
      expect(commissionDoctorStats.appointmentsCount).toBe(2)
      expect(commissionDoctorStats.revenue).toBe(100) // only the paid + COMPLETED appointment
      expect(commissionDoctorStats.commission).toBe(87.5)

      // No appointments of its own, but credited the FULL $200 labwork (not
      // split), and commissionPercentage is null so commission is 0.
      expect(noCommissionDoctorStats.commissionPercentage).toBeNull()
      expect(noCommissionDoctorStats.appointmentsCount).toBe(0)
      expect(noCommissionDoctorStats.commission).toBe(0)
    })
  })

  // ============================================================================
  // Doctor-scope authorization (intra-tenant IDOR guard)
  // ============================================================================

  describe('doctor-scope authorization', () => {
    let doctorUserToken: string
    let otherDoctorId: string

    beforeAll(async () => {
      // A DOCTOR-role user linked to the existing `doctorId`.
      const passwordHash = await hashPassword('TestPass123!')
      const doctorUser = await prisma.user.create({
        data: {
          email: 'dr.user-stats@test.com',
          passwordHash,
          firstName: 'Dr',
          lastName: 'User',
          role: 'DOCTOR',
          tenantId,
        },
      })
      await prisma.doctor.update({ where: { id: doctorId }, data: { userId: doctorUser.id } })
      doctorUserToken = generateToken(doctorUser.id, tenantId, 'DOCTOR')

      // A second, unrelated doctor in the same tenant.
      const otherDoctor = await prisma.doctor.create({
        data: { firstName: 'Other', lastName: 'Doctor', email: 'other.dr-stats@test.com', tenantId },
      })
      otherDoctorId = otherDoctor.id
    })

    it('lets a doctor read their OWN scoped stats', async () => {
      const res = await request(app)
        .get(`/api/stats/overview?doctorId=${doctorId}`)
        .set('Authorization', `Bearer ${doctorUserToken}`)
      expect(res.status).toBe(200)
    })

    it('forbids a doctor from reading another doctor\'s stats (403)', async () => {
      const res = await request(app)
        .get(`/api/stats/overview?doctorId=${otherDoctorId}`)
        .set('Authorization', `Bearer ${doctorUserToken}`)
      expect(res.status).toBe(403)
    })

    it('also forbids cross-doctor access on revenue and upcoming', async () => {
      const revenue = await request(app)
        .get(`/api/stats/revenue?doctorId=${otherDoctorId}`)
        .set('Authorization', `Bearer ${doctorUserToken}`)
      expect(revenue.status).toBe(403)

      const upcoming = await request(app)
        .get(`/api/stats/upcoming?doctorId=${otherDoctorId}`)
        .set('Authorization', `Bearer ${doctorUserToken}`)
      expect(upcoming.status).toBe(403)
    })

    it('still lets a non-admin view tenant-wide stats (no doctorId)', async () => {
      const res = await request(app)
        .get('/api/stats/overview')
        .set('Authorization', `Bearer ${doctorUserToken}`)
      expect(res.status).toBe(200)
    })

    it('lets an admin read any doctor\'s scoped stats', async () => {
      const res = await request(app)
        .get(`/api/stats/overview?doctorId=${otherDoctorId}`)
        .set('Authorization', `Bearer ${adminToken}`)
      expect(res.status).toBe(200)
    })
  })
})
