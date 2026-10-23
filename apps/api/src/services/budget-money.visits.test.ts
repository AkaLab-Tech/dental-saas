import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { prisma } from '@dental/database'
import * as paymentService from './payment.service.js'
import { getBudgetWithMoney } from './budget.service.js'
import { getBudgetMoneyDetail } from './budget-money.service.js'

/**
 * Task #613: the payments table of a budget (one row per paying visit).
 *
 * Fixtures are persisted rows run through the real services. Amounts, dates,
 * descriptions and notes are distinct per role so a swap or a duplicated first
 * row cannot hide. Each numbered guard of the issue is its own `it()`.
 */

const DAY = 24 * 60 * 60 * 1000
const BASE = new Date('2026-03-02T15:00:00.000Z').getTime()
const at = (days: number) => new Date(BASE + days * DAY)

describe('budget payments table rows (#613)', () => {
  let tenantId: string
  let doctorId: string
  const suffix = Date.now()
  let seq = 0

  beforeAll(async () => {
    let freePlan = await prisma.plan.findUnique({ where: { name: 'free' } })
    if (!freePlan) {
      freePlan = await prisma.plan.create({
        data: { name: 'free', displayName: 'Free', price: 0, maxAdmins: 1, maxDoctors: 3, maxPatients: 50 },
      })
    }
    const tenant = await prisma.tenant.create({
      data: { name: 'Budget Visits Svc', slug: `budget-visits-svc-${suffix}` },
    })
    tenantId = tenant.id
    await prisma.subscription.create({
      data: {
        tenantId,
        planId: freePlan.id,
        status: 'ACTIVE',
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * DAY),
      },
    })
    doctorId = (
      await prisma.doctor.create({
        data: { tenantId, firstName: 'Visits', lastName: 'Doctor', email: `visits-doc-${suffix}@test.com` },
      })
    ).id
  })

  afterAll(async () => {
    await prisma.patientPayment.deleteMany({ where: { tenantId } })
    await prisma.appointment.deleteMany({ where: { tenantId } })
    await prisma.budget.deleteMany({ where: { tenantId } })
    await prisma.patient.deleteMany({ where: { tenantId } })
    await prisma.doctor.deleteMany({ where: { tenantId } })
    await prisma.subscription.deleteMany({ where: { tenantId } })
    await prisma.tenant.delete({ where: { id: tenantId } })
  })

  async function appointment(patientId: string, days: number, cost: number | null = null) {
    return prisma.appointment.create({
      data: {
        tenantId,
        patientId,
        doctorId,
        startTime: at(days),
        endTime: new Date(at(days).getTime() + 30 * 60_000),
        duration: 30,
        cost,
      },
    })
  }

  async function line(budgetId: string, description: string, price: number, itemNotes: string | null) {
    return prisma.budgetItem.create({
      data: { budgetId, description, unitPrice: price, totalPrice: price, status: 'PENDING', notes: itemNotes },
    })
  }

  async function link(
    budgetItemId: string,
    appointmentId: string,
    role: 'EXECUTED' | 'SCHEDULED',
    notes: string | null
  ) {
    await prisma.budgetItemAppointment.create({ data: { budgetItemId, appointmentId, role, notes } })
  }

  /**
   * An APPROVED budget with two executed visits of different amounts on
   * different dates: day 0 -> "Cleaning" 100, day 10 -> "Crown" 250. Each line
   * carries its own `notes` and each link its own, all different.
   */
  async function seedTwoVisits(advance: number | null) {
    seq += 1
    const patient = await prisma.patient.create({ data: { tenantId, firstName: 'Visits', lastName: `P${seq}` } })
    const patientId = patient.id
    if (advance !== null) {
      await prisma.patientPayment.create({
        data: { tenantId, patientId, amount: advance, date: at(-30), kind: 'ADVANCE' },
      })
    }
    const budget = await prisma.budget.create({
      data: { tenantId, patientId, status: 'APPROVED', totalAmount: 100 + 250 },
    })
    const cleaning = await line(budget.id, 'Cleaning', 100, 'ITEM-NOTE-cleaning')
    const crown = await line(budget.id, 'Crown', 250, 'ITEM-NOTE-crown')
    const first = await appointment(patientId, 0)
    const second = await appointment(patientId, 10)
    await link(cleaning.id, first.id, 'EXECUTED', 'LINK-NOTE-cleaning')
    await link(crown.id, second.id, 'EXECUTED', 'LINK-NOTE-crown')
    return { patientId, budgetId: budget.id, cleaning, crown, first, second }
  }

  async function detail(patientId: string, budgetId: string) {
    return getBudgetMoneyDetail(tenantId, patientId, budgetId)
  }

  it('GUARD 1 - one row per paying visit with its own date and amount (100 on day 0, 250 on day 10)', async () => {
    const { patientId, budgetId, first, second } = await seedTwoVisits(150)
    const { visits } = await detail(patientId, budgetId)
    expect(visits.map((v) => [v.appointmentId, v.date, v.charged])).toEqual([
      [first.id, at(0).toISOString(), 100],
      [second.id, at(10).toISOString(), 250],
    ])
  })

  it('GUARD 2 - the row count is two for two paying visits', async () => {
    const { patientId, budgetId } = await seedTwoVisits(150)
    const { visits } = await detail(patientId, budgetId)
    expect(visits).toHaveLength(2)
  })

  it('GUARD 3 - the row carries the LINK notes and the line description, not BudgetItem.notes', async () => {
    const { patientId, budgetId, cleaning, crown } = await seedTwoVisits(150)
    const { visits } = await detail(patientId, budgetId)
    expect(visits[0].lines).toEqual([
      { budgetItemId: cleaning.id, description: 'Cleaning', notes: 'LINK-NOTE-cleaning' },
    ])
    expect(visits[1].lines).toEqual([
      { budgetItemId: crown.id, description: 'Crown', notes: 'LINK-NOTE-crown' },
    ])
  })

  it('GUARD 3b - a link without notes yields notes null even when the line itself has notes', async () => {
    const { patientId, budgetId } = await seedTwoVisits(null)
    await prisma.budgetItemAppointment.updateMany({
      where: { budgetItem: { budgetId }, role: 'EXECUTED' },
      data: { notes: null },
    })
    const { visits } = await detail(patientId, budgetId)
    expect(visits[0].lines[0].notes).toBeNull()
    expect(visits[1].lines[0].notes).toBeNull()
  })

  it('GUARD 4 - a SCHEDULED-only line on an APPROVED budget produces no row (count 0)', async () => {
    seq += 1
    const patient = await prisma.patient.create({ data: { tenantId, firstName: 'Sched', lastName: `P${seq}` } })
    const budget = await prisma.budget.create({
      data: { tenantId, patientId: patient.id, status: 'APPROVED', totalAmount: 400 },
    })
    const planned = await line(budget.id, 'Planned', 400, 'ITEM-NOTE-planned')
    const appt = await appointment(patient.id, 3)
    await link(planned.id, appt.id, 'SCHEDULED', 'LINK-NOTE-planned')

    const stored = await prisma.budget.findUniqueOrThrow({ where: { id: budget.id } })
    expect(stored.status).toBe('APPROVED')
    const { visits } = await detail(patient.id, budget.id)
    expect(visits).toHaveLength(0)
  })

  it('GUARD 4b - next to an executed visit, a SCHEDULED-only line on another appointment adds no row', async () => {
    const { patientId, budgetId, first, second } = await seedTwoVisits(null)
    const planned = await line(budgetId, 'Planned', 60, 'ITEM-NOTE-planned')
    const third = await appointment(patientId, 20)
    await link(planned.id, third.id, 'SCHEDULED', 'LINK-NOTE-planned')

    const { visits } = await detail(patientId, budgetId)
    expect(visits.map((v) => v.appointmentId)).toEqual([first.id, second.id])
    expect(visits.filter((v) => v.appointmentId === third.id)).toHaveLength(0)
  })

  it('GUARD 5 - a budget with no payments yields an empty list, not an absent one', async () => {
    seq += 1
    const patient = await prisma.patient.create({ data: { tenantId, firstName: 'Empty', lastName: `P${seq}` } })
    const budget = await prisma.budget.create({
      data: { tenantId, patientId: patient.id, status: 'APPROVED', totalAmount: 90 },
    })
    const result = await getBudgetWithMoney(tenantId, budget.id)
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.visits).toEqual([])
  })

  it('the rows charged column sums to money.billed (350)', async () => {
    const { budgetId } = await seedTwoVisits(150)
    const result = await getBudgetWithMoney(tenantId, budgetId)
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.visits.reduce((s, v) => s + v.charged, 0)).toBe(350)
    expect(result.data.money.billed).toBe(350)
  })

  it('the rows covered column sums to money.covered (150, split 100 + 50)', async () => {
    const { budgetId } = await seedTwoVisits(150)
    const result = await getBudgetWithMoney(tenantId, budgetId)
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.visits.map((v) => v.covered)).toEqual([100, 50])
    expect(result.data.visits.reduce((s, v) => s + v.covered, 0)).toBe(150)
    expect(result.data.money.covered).toBe(150)
  })

  it('a visit whose line was superseded by the appointment own cost produces no row', async () => {
    const { patientId, budgetId, first, second } = await seedTwoVisits(null)
    // The first visit now carries its own typed cost: it bills as the appointment, not the line.
    await prisma.appointment.update({ where: { id: first.id }, data: { cost: 777 } })

    const result = await getBudgetWithMoney(tenantId, budgetId)
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.visits.map((v) => v.appointmentId)).toEqual([second.id])
    expect(result.data.money.billed).toBe(250)
    expect((await detail(patientId, budgetId)).visits).toHaveLength(1)
  })

  it('a visit charged 250 with nothing covered still produces a row (charged > 0, covered 0)', async () => {
    const { patientId, budgetId, second } = await seedTwoVisits(100)
    // 100 advance covers the day-0 visit fully; the day-10 visit is charged 250, covered 0.
    const { visits } = await detail(patientId, budgetId)
    expect(visits).toHaveLength(2)
    expect(visits[1]).toMatchObject({ appointmentId: second.id, charged: 250, covered: 0 })
  })

  it('one computeFifoAllocation per request serves both the aggregate and the rows', async () => {
    const { budgetId } = await seedTwoVisits(150)
    const spy = vi.spyOn(paymentService, 'computeFifoAllocation')
    try {
      const result = await getBudgetWithMoney(tenantId, budgetId)
      expect(result.success).toBe(true)
      expect(spy).toHaveBeenCalledTimes(1)
    } finally {
      spy.mockRestore()
    }
  })
})
