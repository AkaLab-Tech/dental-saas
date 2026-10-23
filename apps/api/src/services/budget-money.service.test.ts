import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { prisma } from '@dental/database'
import { getPatientAccountStatement } from './payment.service.js'
import { confirmExecutedBudgetItems, setAppointmentBudgetItems } from './budget-appointment.service.js'
import { getBudgetMoneyBuckets, buildBudgetMoney } from './budget-money.service.js'
import { getBudgetWithMoney, listBudgetsByPatient } from './budget.service.js'

/**
 * Task #611: a covered/remaining aggregate per budget.
 *
 * Fixtures are persisted rows run through the real services (the same ones the
 * routes call); nothing hands the allocator a pre-built item list. Amounts are
 * distinct per role so a swap cannot hide. One `it()` per guard.
 */

const DAY = 24 * 60 * 60 * 1000
const BASE = new Date('2026-03-02T15:00:00.000Z').getTime()
const at = (days: number) => new Date(BASE + days * DAY)

describe('budget covered/remaining aggregate (#611)', () => {
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
      data: { name: 'Budget Money Svc', slug: `budget-money-svc-${suffix}` },
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
        data: { tenantId, firstName: 'Money', lastName: 'Doctor', email: `money-doc-${suffix}@test.com` },
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

  async function newPatient(label: string) {
    seq += 1
    return (await prisma.patient.create({ data: { tenantId, firstName: label, lastName: `P${seq}` } })).id
  }

  /**
   * A patient with one APPROVED budget of two lines: `billedPrice` (linked to a
   * costless appointment) and `otherPrice` (left PENDING, never linked). The
   * budget total therefore differs from the billed figure by otherPrice.
   */
  async function seedBudget(
    billedPrice: number,
    otherPrice: number,
    mode: 'EXECUTED' | 'SCHEDULED',
    advance: number | null
  ) {
    const patientId = await newPatient(`Money${mode}`)
    if (advance !== null) {
      await prisma.patientPayment.create({
        data: { tenantId, patientId, amount: advance, date: at(-30), kind: 'ADVANCE' },
      })
    }
    const budget = await prisma.budget.create({
      data: { tenantId, patientId, status: 'APPROVED', totalAmount: billedPrice + otherPrice },
    })
    const line = await prisma.budgetItem.create({
      data: {
        budgetId: budget.id,
        description: `line ${billedPrice}`,
        unitPrice: billedPrice,
        totalPrice: billedPrice,
        status: 'PENDING',
      },
    })
    await prisma.budgetItem.create({
      data: {
        budgetId: budget.id,
        description: `line ${otherPrice}`,
        unitPrice: otherPrice,
        totalPrice: otherPrice,
        status: 'PENDING',
      },
    })
    const appt = await prisma.appointment.create({
      data: {
        tenantId,
        patientId,
        doctorId,
        startTime: at(0),
        endTime: new Date(at(0).getTime() + 30 * 60_000),
        duration: 30,
        cost: null,
      },
    })
    const scheduled = await setAppointmentBudgetItems(tenantId, appt.id, [line.id], null)
    expect(scheduled.success).toBe(true)
    if (mode === 'EXECUTED') {
      const confirmed = await confirmExecutedBudgetItems(tenantId, appt.id, [line.id], null)
      expect(confirmed.success).toBe(true)
    }
    return { patientId, budgetId: budget.id }
  }

  it('GUARD 1 - an executed, fully paid line reports it fully covered (6300 covered, 0 remaining, 9000 total)', async () => {
    const { patientId, budgetId } = await seedBudget(6300, 2700, 'EXECUTED', 20000)

    const result = await getBudgetWithMoney(tenantId, budgetId)
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.money).toEqual({
      total: 9000,
      billed: 6300,
      covered: 6300,
      remaining: 0,
      notBilled: 2700,
    })

    const listed = await listBudgetsByPatient(tenantId, patientId)
    expect(listed.data).toHaveLength(1)
    expect(listed.data[0].money).toEqual({
      total: 9000,
      billed: 6300,
      covered: 6300,
      remaining: 0,
      notBilled: 2700,
    })
  })

  it('GUARD 2 - a partial payment reports the partial figure: covered 4100, remaining 2200, billed 6300, total 9000', async () => {
    const { patientId, budgetId } = await seedBudget(6300, 2700, 'EXECUTED', 4100)

    const expected = { total: 9000, billed: 6300, covered: 4100, remaining: 2200, notBilled: 2700 }

    const result = await getBudgetWithMoney(tenantId, budgetId)
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.money).toEqual(expected)

    const listed = await listBudgetsByPatient(tenantId, patientId)
    expect(listed.data[0].money).toEqual(expected)

    const buckets = await getBudgetMoneyBuckets(tenantId, patientId)
    expect(buckets.get(budgetId)).toEqual({ billedCents: 630000, coveredCents: 410000 })
  })

  it('GUARD 2b - the budget line is bucketed at its own allocation when an earlier appointment cost sits first in the FIFO (covered 3100, not 1000)', async () => {
    const { patientId, budgetId } = await seedBudget(6300, 2700, 'EXECUTED', 4100)
    // An earlier typed-cost visit takes the head of the FIFO: 1000 of the 4100.
    await prisma.appointment.create({
      data: {
        tenantId,
        patientId,
        doctorId,
        startTime: at(-5),
        endTime: new Date(at(-5).getTime() + 30 * 60_000),
        duration: 30,
        cost: 1000,
      },
    })

    const result = await getBudgetWithMoney(tenantId, budgetId)
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.money).toEqual({
      total: 9000,
      billed: 6300,
      covered: 3100,
      remaining: 3200,
      notBilled: 2700,
    })
  })

  it('GUARD 3 -a line that is only SCHEDULED bills and covers nothing (a scheduled link is not a charge)', async () => {
    const { patientId, budgetId } = await seedBudget(6300, 2700, 'SCHEDULED', 20000)

    // The fixture's link really exists and the budget is APPROVED.
    const link = await prisma.budgetItemAppointment.findMany({
      where: { budgetItem: { budgetId } },
      select: { role: true },
    })
    expect(link).toEqual([{ role: 'SCHEDULED' }])
    const budget = await prisma.budget.findUniqueOrThrow({ where: { id: budgetId } })
    expect(budget.status).toBe('APPROVED')

    const result = await getBudgetWithMoney(tenantId, budgetId)
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.money.covered).toBe(0)
    expect(result.data.money.billed).toBe(0)
    expect(result.data.money.total).toBe(9000)
    expect(result.data.money.remaining).toBe(0)
    expect(result.data.money.notBilled).toBe(9000)

    const listed = await listBudgetsByPatient(tenantId, patientId)
    expect(listed.data[0].money.covered).toBe(0)
    expect(listed.data[0].money.billed).toBe(0)
  })

  it('GUARD 4 - no payments reports covered as a present zero (key present, value 0), remaining equals billed', async () => {
    const { patientId, budgetId } = await seedBudget(6300, 2700, 'EXECUTED', null)

    const result = await getBudgetWithMoney(tenantId, budgetId)
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data).toHaveProperty('money')
    expect(Object.keys(result.data.money).sort()).toEqual(
      ['billed', 'covered', 'notBilled', 'remaining', 'total']
    )
    expect(Object.prototype.hasOwnProperty.call(result.data.money, 'covered')).toBe(true)
    expect(result.data.money.covered).toBe(0)
    expect(result.data.money).toEqual({
      total: 9000,
      billed: 6300,
      covered: 0,
      remaining: 6300,
      notBilled: 2700,
    })

    const listed = await listBudgetsByPatient(tenantId, patientId)
    expect(listed.data[0]).toHaveProperty('money')
    expect(Object.prototype.hasOwnProperty.call(listed.data[0].money, 'covered')).toBe(true)
    expect(listed.data[0].money.covered).toBe(0)
  })

  it('GUARD 4b - a budget with no charge at all still carries a present all-zero money block, not an absent one', async () => {
    const patientId = await newPatient('NoCharge')
    const budget = await prisma.budget.create({
      data: { tenantId, patientId, status: 'APPROVED', totalAmount: 1900 },
    })
    const listed = await listBudgetsByPatient(tenantId, patientId)
    expect(listed.data[0].id).toBe(budget.id)
    expect(listed.data[0].money).toEqual({
      total: 1900,
      billed: 0,
      covered: 0,
      remaining: 0,
      notBilled: 1900,
    })
    expect(buildBudgetMoney(budget.totalAmount, undefined).covered).toBe(0)
  })

  it('GUARD 5 - the budget figure and the patient statement are each stated on their own for one fixture', async () => {
    // Advance 4100 against one executed 6300 line: 4100 is covered, 2200 is owed.
    const { patientId, budgetId } = await seedBudget(6300, 2700, 'EXECUTED', 4100)

    const result = await getBudgetWithMoney(tenantId, budgetId)
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.money.covered).toBe(4100)
    expect(result.data.money.remaining).toBe(2200)

    const statement = await getPatientAccountStatement(tenantId, patientId)
    expect(statement.success).toBe(true)
    if (!statement.success) return
    expect(statement.data.appointmentsDebt).toBe(2200)
  })
})
