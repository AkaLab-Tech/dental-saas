import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { app } from '../app.js'
import { prisma } from '@dental/database'
import { hashPassword } from '../services/auth.service.js'
import { sign } from 'jsonwebtoken'

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret'

describe('Billing API', () => {
  let tenantId: string
  let ownerToken: string
  let adminToken: string
  let staffToken: string

  // Helper to generate JWT token
  function generateToken(userId: string, tenantId: string, role: string) {
    return sign(
      { sub: userId, tenantId, role },
      JWT_SECRET,
      { expiresIn: '1h' }
    )
  }

  beforeAll(async () => {
    // Get or create free plan
    const plan = await prisma.plan.upsert({
      where: { name: 'free' },
      update: {},
      create: {
        name: 'free',
        displayName: 'Free',
        price: 0,
        maxAdmins: 1,
        maxDoctors: 3,
        maxPatients: 50,
        features: ['Basic features'],
      },
    })

    // Also ensure basic plan exists
    await prisma.plan.upsert({
      where: { name: 'basic' },
      update: {},
      create: {
        name: 'basic',
        displayName: 'Basic',
        price: 5.99,
        maxAdmins: 2,
        maxDoctors: 5,
        maxPatients: 25,
        features: ['More features'],
      },
    })

    // Create test tenant
    const tenant = await prisma.tenant.create({
      data: {
        name: 'Billing Test Clinic',
        slug: `billing-test-${Date.now()}`,
      },
    })
    tenantId = tenant.id

    // Create subscription
    await prisma.subscription.create({
      data: {
        tenantId: tenant.id,
        planId: plan.id,
        status: 'ACTIVE',
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    })

    // Create users
    const passwordHash = await hashPassword('TestPass123!')

    const owner = await prisma.user.create({
      data: {
        email: 'owner-billing@test.com',
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
        email: 'admin-billing@test.com',
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
        email: 'staff-billing@test.com',
        passwordHash,
        firstName: 'Staff',
        lastName: 'User',
        role: 'STAFF',
        tenantId: tenant.id,
      },
    })
    staffToken = generateToken(staff.id, tenant.id, 'STAFF')
  })

  afterAll(async () => {
    // Clean up
    await prisma.payment.deleteMany({
      where: { subscription: { tenantId } },
    })
    await prisma.subscription.deleteMany({ where: { tenantId } })
    await prisma.user.deleteMany({ where: { tenantId } })
    await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {})
    await prisma.$disconnect()
  })

  describe('GET /api/plans', () => {
    it('should return all available plans (public)', async () => {
      const response = await request(app).get('/api/plans')

      expect(response.status).toBe(200)
      expect(response.body.plans).toBeDefined()
      expect(response.body.plans.length).toBeGreaterThanOrEqual(2)

      const freePlan = response.body.plans.find((p: { name: string }) => p.name === 'free')
      expect(freePlan).toBeDefined()
      expect(freePlan.price).toBe(0)
      expect(freePlan.limits).toBeDefined()
      expect(freePlan.limits.maxDoctors).toBe(3)
    })
  })

  describe('GET /api/billing/subscription', () => {
    it('should return subscription details for authenticated user', async () => {
      const response = await request(app)
        .get('/api/billing/subscription')
        .set('Authorization', `Bearer ${staffToken}`)

      expect(response.status).toBe(200)
      expect(response.body.plan).toBeDefined()
      expect(response.body.plan.name).toBe('free')
      expect(response.body.subscription).toBeDefined()
      expect(response.body.subscription.status).toBe('ACTIVE')
      expect(response.body.doctors).toBeDefined()
      expect(response.body.patients).toBeDefined()
    })

    it('should return 401 without authentication', async () => {
      const response = await request(app).get('/api/billing/subscription')

      expect(response.status).toBe(401)
    })
  })

  describe('GET /api/billing/usage', () => {
    it('should return usage for authenticated user', async () => {
      const response = await request(app)
        .get('/api/billing/usage')
        .set('Authorization', `Bearer ${adminToken}`)

      expect(response.status).toBe(200)
      expect(response.body.usage).toBeDefined()
      expect(response.body.limits).toBeDefined()
      expect(response.body.percentages).toBeDefined()
    })
  })

  describe('GET /api/billing/payments', () => {
    it('should return payment history for owner', async () => {
      const response = await request(app)
        .get('/api/billing/payments')
        .set('Authorization', `Bearer ${ownerToken}`)

      expect(response.status).toBe(200)
      expect(response.body.payments).toBeDefined()
      expect(Array.isArray(response.body.payments)).toBe(true)
    })

    it('should return payment history for admin', async () => {
      const response = await request(app)
        .get('/api/billing/payments')
        .set('Authorization', `Bearer ${adminToken}`)

      expect(response.status).toBe(200)
    })

    it('should return 403 for staff', async () => {
      const response = await request(app)
        .get('/api/billing/payments')
        .set('Authorization', `Bearer ${staffToken}`)

      expect(response.status).toBe(403)
    })
  })

  describe('POST /api/billing/upgrade', () => {
    it('should initiate upgrade for owner', async () => {
      const response = await request(app)
        .post('/api/billing/upgrade')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ planName: 'basic' })

      expect(response.status).toBe(200)
      expect(response.body.currentPlan).toBe('free')
      expect(response.body.newPlan).toBe('basic')
      expect(response.body.price).toBe(5.99)
    })

    it('should return 400 for invalid plan name', async () => {
      const response = await request(app)
        .post('/api/billing/upgrade')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ planName: 'invalid' })

      expect(response.status).toBe(400)
    })

    it('should return 403 for non-owner', async () => {
      const response = await request(app)
        .post('/api/billing/upgrade')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ planName: 'basic' })

      expect(response.status).toBe(403)
    })
  })

  describe('POST /api/billing/cancel', () => {
    it('should cancel subscription for owner', async () => {
      const response = await request(app)
        .post('/api/billing/cancel')
        .set('Authorization', `Bearer ${ownerToken}`)

      expect(response.status).toBe(200)
      expect(response.body.cancelAtPeriodEnd).toBe(true)
      expect(response.body.currentPeriodEnd).toBeDefined()
    })

    it('should return 403 for non-owner', async () => {
      const response = await request(app)
        .post('/api/billing/cancel')
        .set('Authorization', `Bearer ${adminToken}`)

      expect(response.status).toBe(403)
    })
  })

  describe('POST /api/billing/reactivate', () => {
    it('should reactivate subscription for owner', async () => {
      const response = await request(app)
        .post('/api/billing/reactivate')
        .set('Authorization', `Bearer ${ownerToken}`)

      expect(response.status).toBe(200)
      expect(response.body.cancelAtPeriodEnd).toBe(false)
    })
  })
})
