import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { prisma } from '@dental/database'
import { generateShareToken, getBudgetByPublicToken, listBudgetsByPatient } from './budget.service.js'

describe('budget.service — share token', () => {
  let tenantId: string
  let otherTenantId: string
  let patientId: string
  let otherPatientId: string
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
        name: 'Share Token Test Clinic',
        slug: `share-token-test-${suffix}`,
        currency: 'USD',
        timezone: 'America/New_York',
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
      data: { tenantId, firstName: 'Share', lastName: 'Patient' },
    })
    patientId = patient.id

    const otherTenant = await prisma.tenant.create({
      data: {
        name: 'Other Share Clinic',
        slug: `other-share-test-${suffix}`,
        currency: 'USD',
        timezone: 'America/New_York',
      },
    })
    otherTenantId = otherTenant.id

    await prisma.subscription.create({
      data: {
        tenantId: otherTenantId,
        planId: freePlan.id,
        status: 'ACTIVE',
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    })

    const otherPatient = await prisma.patient.create({
      data: { tenantId: otherTenantId, firstName: 'Other', lastName: 'Patient' },
    })
    otherPatientId = otherPatient.id
  })

  afterAll(async () => {
    await prisma.budget.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } })
    await prisma.patient.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } })
    await prisma.subscription.deleteMany({
      where: { tenantId: { in: [tenantId, otherTenantId] } },
    })
    await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, otherTenantId] } } })
  })

  beforeEach(async () => {
    await prisma.budget.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } })
  })

  describe('generateShareToken', () => {
    it('generates a hex token and persists it with no expiry by default', async () => {
      const budget = await prisma.budget.create({ data: { tenantId, patientId } })

      const result = await generateShareToken(tenantId, budget.id)

      expect(result.success).toBe(true)
      if (!result.success) return
      expect(result.data.token).toMatch(/^[0-9a-f]{64}$/)
      expect(result.data.expiresAt).toBeNull()

      const stored = await prisma.budget.findUnique({ where: { id: budget.id } })
      expect(stored?.publicToken).toBe(result.data.token)
      expect(stored?.publicTokenExpiresAt).toBeNull()
    })

    it('sets publicTokenExpiresAt roughly expiresInDays from now when provided', async () => {
      const budget = await prisma.budget.create({ data: { tenantId, patientId } })

      const before = Date.now()
      const result = await generateShareToken(tenantId, budget.id, { expiresInDays: 7 })
      const after = Date.now()

      expect(result.success).toBe(true)
      if (!result.success) return
      expect(result.data.expiresAt).not.toBeNull()
      const expiresAtMs = result.data.expiresAt!.getTime()
      const sevenDaysMs = 7 * 24 * 60 * 60 * 1000
      expect(expiresAtMs).toBeGreaterThanOrEqual(before + sevenDaysMs - 5000)
      expect(expiresAtMs).toBeLessThanOrEqual(after + sevenDaysMs + 5000)
    })

    it('rotates the token on a second call, overwriting the old one', async () => {
      const budget = await prisma.budget.create({ data: { tenantId, patientId } })

      const first = await generateShareToken(tenantId, budget.id)
      const second = await generateShareToken(tenantId, budget.id)

      expect(first.success).toBe(true)
      expect(second.success).toBe(true)
      if (!first.success || !second.success) return
      expect(second.data.token).not.toBe(first.data.token)

      const stored = await prisma.budget.findUnique({ where: { id: budget.id } })
      expect(stored?.publicToken).toBe(second.data.token)

      // The old token must no longer resolve
      const oldLookup = await getBudgetByPublicToken(first.data.token)
      expect(oldLookup.success).toBe(false)
    })

    it('returns NOT_FOUND for a budget belonging to another tenant', async () => {
      const otherBudget = await prisma.budget.create({
        data: { tenantId: otherTenantId, patientId: otherPatientId },
      })

      const result = await generateShareToken(tenantId, otherBudget.id)

      expect(result).toEqual({ success: false, code: 'NOT_FOUND' })
    })

    it('returns NOT_FOUND for a non-existent budget', async () => {
      const result = await generateShareToken(tenantId, 'does-not-exist')
      expect(result).toEqual({ success: false, code: 'NOT_FOUND' })
    })

    it('returns NOT_FOUND for a soft-deleted (inactive) budget', async () => {
      const budget = await prisma.budget.create({
        data: { tenantId, patientId, isActive: false },
      })

      const result = await generateShareToken(tenantId, budget.id)

      expect(result).toEqual({ success: false, code: 'NOT_FOUND' })
    })
  })

  describe('getBudgetByPublicToken', () => {
    it('returns the public shape for a valid, active token without leaking tenantId', async () => {
      const budget = await prisma.budget.create({
        data: {
          tenantId,
          patientId,
          notes: 'Root canal + crown',
          items: {
            create: [
              { description: 'Root canal', quantity: 1, unitPrice: 300, totalPrice: 300, order: 0 },
            ],
          },
        },
      })
      const shareResult = await generateShareToken(tenantId, budget.id)
      expect(shareResult.success).toBe(true)
      if (!shareResult.success) return

      const result = await getBudgetByPublicToken(shareResult.data.token)

      expect(result.success).toBe(true)
      if (!result.success) return
      expect(result.data.id).toBe(budget.id)
      expect(result.data.notes).toBe('Root canal + crown')
      expect(result.data.patient).toEqual({ firstName: 'Share', lastName: 'Patient' })
      expect(result.data.items).toHaveLength(1)
      expect(result.data.tenant.name).toBe('Share Token Test Clinic')
      expect(result.data.tenant.currency).toBe('USD')

      // Must not leak tenantId, patientId, createdById, or the raw isActive/publicToken fields
      expect(result.data).not.toHaveProperty('tenantId')
      expect(result.data).not.toHaveProperty('patientId')
      expect(result.data).not.toHaveProperty('createdById')
      expect(result.data).not.toHaveProperty('publicToken')
      expect(result.data).not.toHaveProperty('isActive')
      expect(result.data.tenant).not.toHaveProperty('tenantId')
    })

    it('returns NOT_FOUND for an unknown token', async () => {
      const result = await getBudgetByPublicToken('unknown-token-value')
      expect(result).toEqual({ success: false, code: 'NOT_FOUND' })
    })

    it('returns NOT_FOUND for a token on an inactive (soft-deleted) budget, same as unknown', async () => {
      const budget = await prisma.budget.create({ data: { tenantId, patientId } })
      const shareResult = await generateShareToken(tenantId, budget.id)
      expect(shareResult.success).toBe(true)
      if (!shareResult.success) return

      await prisma.budget.update({ where: { id: budget.id }, data: { isActive: false } })

      const result = await getBudgetByPublicToken(shareResult.data.token)
      expect(result).toEqual({ success: false, code: 'NOT_FOUND' })
    })

    it('returns NOT_FOUND for an expired token, same shape as unknown', async () => {
      const budget = await prisma.budget.create({ data: { tenantId, patientId } })
      // Bypass the service to set an already-past expiry directly
      const token = 'expired-test-token-1234567890'
      await prisma.budget.update({
        where: { id: budget.id },
        data: { publicToken: token, publicTokenExpiresAt: new Date(Date.now() - 1000) },
      })

      const result = await getBudgetByPublicToken(token)
      expect(result).toEqual({ success: false, code: 'NOT_FOUND' })
    })

    it('returns success for a token expiring in the future', async () => {
      const budget = await prisma.budget.create({ data: { tenantId, patientId } })
      const shareResult = await generateShareToken(tenantId, budget.id, { expiresInDays: 1 })
      expect(shareResult.success).toBe(true)
      if (!shareResult.success) return

      const result = await getBudgetByPublicToken(shareResult.data.token)
      expect(result.success).toBe(true)
    })
  })

  describe('appointment links on the item payload (#703)', () => {
    it('list items carry their appointment links, public-share items carry none (G7)', async () => {
      const doctor = await prisma.doctor.create({
        data: { tenantId, firstName: 'Link', lastName: 'Doctor', email: `link-doc-${suffix}@test.com` },
      })
      const startTime = new Date('2026-03-10T13:00:00.000Z')
      const appointment = await prisma.appointment.create({
        data: {
          tenantId,
          patientId,
          doctorId: doctor.id,
          startTime,
          endTime: new Date(startTime.getTime() + 30 * 60 * 1000),
          duration: 30,
        },
      })
      try {
        const budget = await prisma.budget.create({
          data: {
            tenantId,
            patientId,
            status: 'APPROVED',
            items: {
              create: [
                {
                  description: 'Held line',
                  quantity: 1,
                  unitPrice: 300,
                  totalPrice: 300,
                  order: 0,
                  status: 'SCHEDULED',
                  appointments: { create: [{ appointmentId: appointment.id, role: 'SCHEDULED' }] },
                },
              ],
            },
          },
        })
        const shareResult = await generateShareToken(tenantId, budget.id)
        expect(shareResult.success).toBe(true)
        if (!shareResult.success) return

        const list = await listBudgetsByPatient(tenantId, patientId)
        const publicResult = await getBudgetByPublicToken(shareResult.data.token)

        const listItem = list.data.find((b) => b.id === budget.id)!.items[0]
        expect(listItem.appointments).toEqual([
          { role: 'SCHEDULED', appointment: { id: appointment.id, startTime, isActive: true } },
        ])

        expect(publicResult.success).toBe(true)
        if (!publicResult.success) return
        // On items[0], not the root: the root-level leak assertions above would
        // stay green on an items-level leak.
        expect(publicResult.data.items).toHaveLength(1)
        expect(publicResult.data.items[0].description).toBe('Held line')
        expect(publicResult.data.items[0]).not.toHaveProperty('appointments')
        expect(JSON.stringify(publicResult.data)).not.toContain(appointment.id)
      } finally {
        await prisma.budget.deleteMany({ where: { tenantId } })
        await prisma.appointment.deleteMany({ where: { tenantId } })
        await prisma.doctor.deleteMany({ where: { id: doctor.id } })
      }
    })
  })
})
