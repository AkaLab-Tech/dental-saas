import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { prisma } from '@dental/database'
import { PlanLimitsService } from './plan-limits.service.js'

describe('PlanLimitsService', () => {
  let tenantId: string

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

    // Create test tenant
    const tenant = await prisma.tenant.create({
      data: {
        name: 'Plan Limits Test Clinic',
        slug: `plan-limits-test-${Date.now()}`,
      },
    })
    tenantId = tenant.id

    // Create subscription for tenant
    await prisma.subscription.create({
      data: {
        tenantId: tenant.id,
        planId: plan.id,
        status: 'ACTIVE',
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    })
  })

  afterAll(async () => {
    // Clean up
    await prisma.doctor.deleteMany({ where: { tenantId } })
    await prisma.patient.deleteMany({ where: { tenantId } })
    await prisma.user.deleteMany({ where: { tenantId } })
    await prisma.subscription.deleteMany({ where: { tenantId } })
    await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {})
    await prisma.$disconnect()
  })

  describe('getTenantSubscription', () => {
    it('should return tenant subscription with plan', async () => {
      const subscription = await PlanLimitsService.getTenantSubscription(tenantId)

      expect(subscription).not.toBeNull()
      expect(subscription?.plan.name).toBe('free')
      expect(subscription?.status).toBe('ACTIVE')
    })

    it('should return null for tenant without subscription', async () => {
      const subscription = await PlanLimitsService.getTenantSubscription('non-existent')

      expect(subscription).toBeNull()
    })
  })

  describe('getTenantUsage', () => {
    it('should return current usage counts', async () => {
      const usage = await PlanLimitsService.getTenantUsage(tenantId)

      expect(usage).toEqual({
        doctors: 0,
        patients: 0,
        admins: 0,
      })
    })

    it('should count doctors correctly', async () => {
      await prisma.doctor.create({
        data: {
          tenantId,
          firstName: 'Test',
          lastName: 'Doctor',
        },
      })

      const usage = await PlanLimitsService.getTenantUsage(tenantId)

      expect(usage.doctors).toBe(1)
    })

    it('should not count inactive doctors', async () => {
      await prisma.doctor.create({
        data: {
          tenantId,
          firstName: 'Inactive',
          lastName: 'Doctor',
          isActive: false,
        },
      })

      const usage = await PlanLimitsService.getTenantUsage(tenantId)

      expect(usage.doctors).toBe(1) // Only the active one from previous test
    })
  })

  describe('canAddDoctor', () => {
    it('should return true when under limit', async () => {
      const result = await PlanLimitsService.canAddDoctor(tenantId)

      expect(result.allowed).toBe(true)
      expect(result.current).toBe(1)
      expect(result.limit).toBe(3)
    })

    it('should return false when at limit', async () => {
      // Add 2 more doctors to reach limit of 3
      await prisma.doctor.createMany({
        data: [
          { tenantId, firstName: 'Doc', lastName: 'Two' },
          { tenantId, firstName: 'Doc', lastName: 'Three' },
        ],
      })

      const result = await PlanLimitsService.canAddDoctor(tenantId)

      expect(result.allowed).toBe(false)
      expect(result.current).toBe(3)
      expect(result.limit).toBe(3)
    })
  })

  describe('canAddPatient', () => {
    it('should return true when under limit', async () => {
      const result = await PlanLimitsService.canAddPatient(tenantId)

      expect(result.allowed).toBe(true)
      expect(result.current).toBe(0)
      expect(result.limit).toBe(50)
    })
  })

  describe('getPlanLimitStatus', () => {
    it('should return complete limit status', async () => {
      const status = await PlanLimitsService.getPlanLimitStatus(tenantId)

      expect(status).not.toBeNull()
      expect(status!.plan.name).toBe('free')
      expect(status!.doctors.current).toBe(3)
      expect(status!.doctors.limit).toBe(3)
      expect(status!.doctors.remaining).toBe(0)
      expect(status!.patients.limit).toBe(50)
    })
  })
})
