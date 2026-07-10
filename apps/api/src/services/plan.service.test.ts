import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { prisma } from '@dental/database'
import { PlanService } from './plan.service.js'

describe('PlanService', () => {
  beforeAll(async () => {
    // Ensure plans exist
    await prisma.plan.upsert({
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
    await prisma.plan.upsert({
      where: { name: 'enterprise' },
      update: {},
      create: {
        name: 'enterprise',
        displayName: 'Enterprise',
        price: 11.99,
        maxAdmins: 5,
        maxDoctors: 10,
        maxPatients: 60,
        features: ['All features'],
      },
    })
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  describe('getAllPlans', () => {
    it('should return all active plans', async () => {
      const plans = await PlanService.getAllPlans()

      expect(plans.length).toBeGreaterThanOrEqual(3)
      expect(plans.every((p) => p.isActive)).toBe(true)
    })

    it('should order plans by price ascending', async () => {
      const plans = await PlanService.getAllPlans()

      for (let i = 1; i < plans.length; i++) {
        expect(Number(plans[i].price)).toBeGreaterThanOrEqual(
          Number(plans[i - 1].price)
        )
      }
    })
  })

  describe('getPlanByName', () => {
    it('should return plan by name', async () => {
      const plan = await PlanService.getPlanByName('basic')

      expect(plan).not.toBeNull()
      expect(plan?.name).toBe('basic')
      expect(plan?.displayName).toBe('Basic')
    })

    it('should return null for non-existent plan', async () => {
      const plan = await PlanService.getPlanByName('non-existent')

      expect(plan).toBeNull()
    })
  })

  describe('getPlanById', () => {
    it('should return plan by id', async () => {
      const plans = await PlanService.getAllPlans()
      const firstPlan = plans[0]

      const plan = await PlanService.getPlanById(firstPlan.id)

      expect(plan).not.toBeNull()
      expect(plan?.id).toBe(firstPlan.id)
    })

    it('should return null for non-existent id', async () => {
      const plan = await PlanService.getPlanById('non-existent-id')

      expect(plan).toBeNull()
    })
  })

  describe('getFreePlan', () => {
    it('should return the free plan', async () => {
      const plan = await PlanService.getFreePlan()

      expect(plan).not.toBeNull()
      expect(plan.name).toBe('free')
      expect(Number(plan.price)).toBe(0)
    })
  })
})
