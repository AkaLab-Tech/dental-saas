import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import jwt from 'jsonwebtoken'
import { api } from '../../test/http.js'
import { prisma } from '@dental/database'
import { hashPassword } from '../../services/auth.service.js'

describe('Admin Stats Routes', () => {
  let superAdminToken: string
  let superAdminId: string
  let testTenantId: string
  let testUserId: string
  let testPatientId: string
  let testDoctorId: string
  let testAppointmentId: string

  const testEmail = `superadmin-stats-${Date.now()}@test.com`

  beforeAll(async () => {
    // Create a test SUPER_ADMIN user
    const passwordHash = await hashPassword('TestPassword123!')
    const superAdmin = await prisma.user.create({
      data: {
        email: testEmail,
        passwordHash,
        firstName: 'Stats',
        lastName: 'Admin',
        role: 'SUPER_ADMIN',
        tenantId: null,
        isActive: true,
      },
    })
    superAdminId = superAdmin.id

    // Generate a valid JWT token
    superAdminToken = jwt.sign(
      {
        userId: superAdminId,
        email: testEmail,
        role: 'SUPER_ADMIN',
        tenantId: null,
      },
      process.env.JWT_SECRET || 'test-secret',
      { expiresIn: '1h' }
    )

    // Create test tenant with related data
    const tenant = await prisma.tenant.create({
      data: {
        name: 'Stats Test Clinic',
        slug: `stats-test-clinic-${Date.now()}`,
        isActive: true,
      },
    })
    testTenantId = tenant.id

    // Create tenant user
    const tenantUser = await prisma.user.create({
      data: {
        email: `owner-${Date.now()}@test.com`,
        passwordHash,
        firstName: 'Owner',
        lastName: 'User',
        role: 'OWNER',
        tenantId: testTenantId,
        isActive: true,
      },
    })
    testUserId = tenantUser.id

    // Create doctor
    const doctor = await prisma.doctor.create({
      data: {
        firstName: 'Test',
        lastName: 'Doctor',
        specialty: 'General',
        tenantId: testTenantId,
      },
    })
    testDoctorId = doctor.id

    // Create patient
    const patient = await prisma.patient.create({
      data: {
        firstName: 'Test',
        lastName: 'Patient',
        tenantId: testTenantId,
      },
    })
    testPatientId = patient.id

    // Create appointment scheduled for this month
    const appointment = await prisma.appointment.create({
      data: {
        startTime: new Date(),
        endTime: new Date(Date.now() + 60 * 60 * 1000),
        status: 'SCHEDULED',
        tenantId: testTenantId,
        doctorId: testDoctorId,
        patientId: testPatientId,
      },
    })
    testAppointmentId = appointment.id
  })

  afterAll(async () => {
    // Clean up in reverse order of creation
    if (testAppointmentId) {
      await prisma.appointment.delete({ where: { id: testAppointmentId } }).catch(() => {})
    }
    if (testPatientId) {
      await prisma.patient.delete({ where: { id: testPatientId } }).catch(() => {})
    }
    if (testDoctorId) {
      await prisma.doctor.delete({ where: { id: testDoctorId } }).catch(() => {})
    }
    if (testUserId) {
      await prisma.user.delete({ where: { id: testUserId } }).catch(() => {})
    }
    if (testTenantId) {
      await prisma.tenant.delete({ where: { id: testTenantId } }).catch(() => {})
    }
    if (superAdminId) {
      await prisma.user.delete({ where: { id: superAdminId } }).catch(() => {})
    }
  })

  describe('GET /api/admin/stats', () => {
    it('should return 401 without authentication', async () => {
      const response = await api().get('/api/admin/stats')

      expect(response.status).toBe(401)
    })

    it('should return platform stats with correct structure', async () => {
      const response = await api()
        .get('/api/admin/stats')
        .set('Authorization', `Bearer ${superAdminToken}`)

      expect(response.status).toBe(200)
      expect(response.body).toHaveProperty('tenants')
      expect(response.body.tenants).toHaveProperty('total')
      expect(response.body.tenants).toHaveProperty('active')
      expect(response.body.tenants).toHaveProperty('inactive')

      expect(response.body).toHaveProperty('users')
      expect(response.body.users).toHaveProperty('total')
      expect(response.body.users).toHaveProperty('active')
      expect(response.body.users).toHaveProperty('byRole')

      expect(response.body).toHaveProperty('patients')
      expect(response.body.patients).toHaveProperty('total')

      expect(response.body).toHaveProperty('appointments')
      expect(response.body.appointments).toHaveProperty('total')
      expect(response.body.appointments).toHaveProperty('thisMonth')
    })

    it('should count appointments by startTime (not createdAt)', async () => {
      const response = await api()
        .get('/api/admin/stats')
        .set('Authorization', `Bearer ${superAdminToken}`)

      expect(response.status).toBe(200)
      // Our test appointment is scheduled for this month
      expect(response.body.appointments.thisMonth).toBeGreaterThanOrEqual(1)
    })

    it('should include users grouped by role', async () => {
      const response = await api()
        .get('/api/admin/stats')
        .set('Authorization', `Bearer ${superAdminToken}`)

      expect(response.status).toBe(200)
      expect(response.body.users.byRole).toBeDefined()
      expect(typeof response.body.users.byRole).toBe('object')
      // Should have OWNER role from our test user
      expect(response.body.users.byRole.OWNER).toBeGreaterThanOrEqual(1)
    })
  })

  describe('GET /api/admin/stats/top-tenants', () => {
    it('should return 401 without authentication', async () => {
      const response = await api().get('/api/admin/stats/top-tenants')

      expect(response.status).toBe(401)
    })

    it('should return top tenants with correct structure', async () => {
      const response = await api()
        .get('/api/admin/stats/top-tenants')
        .set('Authorization', `Bearer ${superAdminToken}`)

      expect(response.status).toBe(200)
      expect(response.body).toHaveProperty('tenants')
      expect(Array.isArray(response.body.tenants)).toBe(true)
    })

    it('should return tenants with patient and appointment counts', async () => {
      const response = await api()
        .get('/api/admin/stats/top-tenants')
        .set('Authorization', `Bearer ${superAdminToken}`)

      expect(response.status).toBe(200)

      if (response.body.tenants.length > 0) {
        const tenant = response.body.tenants[0]
        expect(tenant).toHaveProperty('id')
        expect(tenant).toHaveProperty('name')
        expect(tenant).toHaveProperty('slug')
        expect(tenant).toHaveProperty('_count')
        expect(tenant._count).toHaveProperty('patients')
        expect(tenant._count).toHaveProperty('appointments')
      }
    })

    it('should limit results to 10 tenants', async () => {
      const response = await api()
        .get('/api/admin/stats/top-tenants')
        .set('Authorization', `Bearer ${superAdminToken}`)

      expect(response.status).toBe(200)
      expect(response.body.tenants.length).toBeLessThanOrEqual(10)
    })

    it('should only include active tenants', async () => {
      const response = await api()
        .get('/api/admin/stats/top-tenants')
        .set('Authorization', `Bearer ${superAdminToken}`)

      expect(response.status).toBe(200)

      // The endpoint must never surface inactive tenants. Assert this against
      // whatever it returns rather than expecting our low-activity test tenant
      // to rank in the top 10 (that assertion is non-deterministic: it depends
      // on how much data other tenants in the database already have).
      const returnedIds = response.body.tenants.map((t: { id: string }) => t.id)
      if (returnedIds.length > 0) {
        const inactiveReturned = await prisma.tenant.count({
          where: { id: { in: returnedIds }, isActive: false },
        })
        expect(inactiveReturned).toBe(0)
      }
    })

    it('should exclude an inactive tenant even with high activity', async () => {
      // Deterministic check of the isActive filter: an inactive tenant must be
      // absent from the results regardless of its activity / ranking.
      const inactiveTenant = await prisma.tenant.create({
        data: {
          name: 'Inactive Stats Clinic',
          slug: `inactive-stats-clinic-${Date.now()}`,
          isActive: false,
        },
      })

      try {
        const response = await api()
          .get('/api/admin/stats/top-tenants')
          .set('Authorization', `Bearer ${superAdminToken}`)

        expect(response.status).toBe(200)
        const found = response.body.tenants.some(
          (t: { id: string }) => t.id === inactiveTenant.id
        )
        expect(found).toBe(false)
      } finally {
        await prisma.tenant.delete({ where: { id: inactiveTenant.id } })
      }
    })
  })

  describe('GET /api/admin/stats/recent-activity', () => {
    it('should return 401 without authentication', async () => {
      const response = await api().get('/api/admin/stats/recent-activity')

      expect(response.status).toBe(401)
    })

    it('should return activity with correct structure', async () => {
      const response = await api()
        .get('/api/admin/stats/recent-activity')
        .set('Authorization', `Bearer ${superAdminToken}`)

      expect(response.status).toBe(200)
      expect(response.body).toHaveProperty('activity')
      expect(Array.isArray(response.body.activity)).toBe(true)
    })

    it('should return activity items with type discriminator', async () => {
      const response = await api()
        .get('/api/admin/stats/recent-activity')
        .set('Authorization', `Bearer ${superAdminToken}`)

      expect(response.status).toBe(200)

      if (response.body.activity.length > 0) {
        const activity = response.body.activity[0]
        expect(activity).toHaveProperty('type')
        expect(activity).toHaveProperty('id')
        expect(activity).toHaveProperty('createdAt')
        expect(['tenant_created', 'user_created']).toContain(activity.type)
      }
    })

    it('should include tenant_created activities with name', async () => {
      const response = await api()
        .get('/api/admin/stats/recent-activity')
        .set('Authorization', `Bearer ${superAdminToken}`)

      expect(response.status).toBe(200)

      const tenantActivities = response.body.activity.filter(
        (a: { type: string }) => a.type === 'tenant_created'
      )
      if (tenantActivities.length > 0) {
        expect(tenantActivities[0]).toHaveProperty('name')
      }
    })

    it('should include user_created activities with email and tenantName', async () => {
      const response = await api()
        .get('/api/admin/stats/recent-activity')
        .set('Authorization', `Bearer ${superAdminToken}`)

      expect(response.status).toBe(200)

      const userActivities = response.body.activity.filter(
        (a: { type: string }) => a.type === 'user_created'
      )
      if (userActivities.length > 0) {
        expect(userActivities[0]).toHaveProperty('email')
        // tenantName is optional (can be undefined for users without tenant)
      }
    })

    it('should limit results to 15 activities', async () => {
      const response = await api()
        .get('/api/admin/stats/recent-activity')
        .set('Authorization', `Bearer ${superAdminToken}`)

      expect(response.status).toBe(200)
      expect(response.body.activity.length).toBeLessThanOrEqual(15)
    })

    it('should sort activities by createdAt descending', async () => {
      const response = await api()
        .get('/api/admin/stats/recent-activity')
        .set('Authorization', `Bearer ${superAdminToken}`)

      expect(response.status).toBe(200)

      const activities = response.body.activity
      if (activities.length >= 2) {
        const dates = activities.map((a: { createdAt: string }) => new Date(a.createdAt).getTime())
        for (let i = 0; i < dates.length - 1; i++) {
          expect(dates[i]).toBeGreaterThanOrEqual(dates[i + 1])
        }
      }
    })
  })
})
