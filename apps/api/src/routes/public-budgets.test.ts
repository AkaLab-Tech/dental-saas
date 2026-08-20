import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { api } from '../test/http.js'
import { prisma } from '@dental/database'
import { generateShareToken } from '../services/budget.service.js'

describe('Public budgets routes', () => {
  let tenantId: string
  let patientId: string
  const suffix = Date.now()

  beforeAll(async () => {
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

    const tenant = await prisma.tenant.create({
      data: {
        name: 'Public Budget Test Clinic',
        slug: `public-budget-test-${suffix}`,
        currency: 'USD',
        timezone: 'America/New_York',
        email: 'clinic@public-budget-test.com',
        phone: '+15551234567',
        address: '1 Public Street',
      },
    })
    tenantId = tenant.id

    await prisma.subscription.create({
      data: {
        tenantId,
        planId: freePlan.id,
        status: 'ACTIVE',
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    })

    const patient = await prisma.patient.create({
      data: { tenantId, firstName: 'Public', lastName: 'Patient' },
    })
    patientId = patient.id
  })

  afterAll(async () => {
    await prisma.budget.deleteMany({ where: { tenantId } })
    await prisma.patient.deleteMany({ where: { tenantId } })
    await prisma.subscription.deleteMany({ where: { tenantId } })
    await prisma.tenant.deleteMany({ where: { id: tenantId } })
  })

  describe('GET /api/public/budgets/:token', () => {
    it('returns branding + items for a valid token with NO auth header', async () => {
      const budget = await prisma.budget.create({
        data: {
          tenantId,
          patientId,
          notes: 'Root canal treatment',
          items: {
            create: [
              { description: 'Root canal', quantity: 1, unitPrice: 300, totalPrice: 300, order: 0 },
            ],
          },
        },
      })
      const share = await generateShareToken(tenantId, budget.id)
      expect(share.success).toBe(true)
      if (!share.success) return

      const res = await api().get(`/api/public/budgets/${share.data.token}`)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data.id).toBe(budget.id)
      expect(res.body.data.notes).toBe('Root canal treatment')
      expect(res.body.data.patient).toEqual({ firstName: 'Public', lastName: 'Patient' })
      expect(res.body.data.tenant.name).toBe('Public Budget Test Clinic')
      expect(res.body.data.tenant.currency).toBe('USD')
      expect(res.body.data.items).toHaveLength(1)
      expect(res.body.data.items[0].description).toBe('Root canal')
      // Never leaks tenantId or other internal fields
      expect(res.body.data).not.toHaveProperty('tenantId')
      expect(res.body.data).not.toHaveProperty('patientId')
      expect(res.body.data.tenant).not.toHaveProperty('tenantId')
    })

    it('returns 404 with the same shape for an unknown token', async () => {
      const res = await api().get('/api/public/budgets/totally-unknown-token')

      expect(res.status).toBe(404)
      expect(res.body).toEqual({ success: false, error: 'Budget not found' })
    })

    it('returns 404 with the same shape for an expired token', async () => {
      const budget = await prisma.budget.create({ data: { tenantId, patientId } })
      const token = `expired-route-token-${suffix}`
      await prisma.budget.update({
        where: { id: budget.id },
        data: { publicToken: token, publicTokenExpiresAt: new Date(Date.now() - 1000) },
      })

      const res = await api().get(`/api/public/budgets/${token}`)

      expect(res.status).toBe(404)
      expect(res.body).toEqual({ success: false, error: 'Budget not found' })
    })

    it('returns 404 with the same shape for an inactive (soft-deleted) budget', async () => {
      const budget = await prisma.budget.create({ data: { tenantId, patientId } })
      const share = await generateShareToken(tenantId, budget.id)
      expect(share.success).toBe(true)
      if (!share.success) return
      await prisma.budget.update({ where: { id: budget.id }, data: { isActive: false } })

      const res = await api().get(`/api/public/budgets/${share.data.token}`)

      expect(res.status).toBe(404)
      expect(res.body).toEqual({ success: false, error: 'Budget not found' })
    })

    it('works without any Authorization header set at all (no 401)', async () => {
      const res = await api().get('/api/public/budgets/some-token')
      expect(res.status).not.toBe(401)
    })

    it('sets standard rate-limit headers, confirming the limiter is wired', async () => {
      const res = await api().get('/api/public/budgets/some-token')

      expect(res.headers).toHaveProperty('ratelimit-limit')
      expect(res.headers['ratelimit-limit']).toBe('30')
    })
  })
})
