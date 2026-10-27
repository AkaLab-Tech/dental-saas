import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { prisma } from '@dental/database'
import { getPatientAccountStatement, getPatientBalance } from './payment.service.js'
import { confirmExecutedBudgetItems, setAppointmentBudgetItems } from './budget-appointment.service.js'
import { getBudgetMoneyBuckets, buildBudgetMoney } from './budget-money.service.js'
import { getBudgetWithMoney, listBudgetsByPatient, deleteBudget } from './budget.service.js'

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

/**
 * Task #639: a refused delete must leave the patient's money exactly as it was.
 *
 * G1-G4 (routes/budgets.test.ts) assert the budget row survived. These two
 * assert the CONSEQUENCE the row's survival exists for, on fixtures where the
 * right and the wrong answer are different non-zero numbers — a no-payment,
 * no-charge fixture would report 0 either way and stay green against the
 * broken derivation.
 */
describe('a refused budget delete moves no money (#639)', () => {
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
      data: { name: 'Budget Delete Money', slug: `budget-delete-money-${suffix}` },
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
        data: {
          tenantId,
          firstName: 'Delete',
          lastName: 'Doctor',
          email: `delete-money-doc-${suffix}@test.com`,
        },
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
    return (await prisma.patient.create({ data: { tenantId, firstName: label, lastName: `D${seq}` } })).id
  }

  function appointment(patientId: string, cost: number | null, days: number) {
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

  it('G5 - a reserved advance of 5000 stays held: the account statement is identical before and after the refused delete', async () => {
    const patientId = await newPatient('Reserved')
    // An open budget holding a 5000 advance reserved to it, and NO executed
    // line, so check 1 has nothing to fire on and check 2 is isolated.
    const budget = await prisma.budget.create({
      data: { tenantId, patientId, status: 'APPROVED', totalAmount: 5000 },
    })
    await prisma.budgetItem.create({
      data: {
        budgetId: budget.id,
        description: 'planned 5000',
        unitPrice: 5000,
        totalPrice: 5000,
        status: 'PENDING',
      },
    })
    await prisma.patientPayment.create({
      data: { tenantId, patientId, amount: 5000, date: at(-30), kind: 'ADVANCE', budgetId: budget.id },
    })
    // A separate ordinary charge of 7000 >= 5000: the released advance would
    // have somewhere to go, so the two answers differ by the whole 5000.
    await appointment(patientId, 7000, -5)

    const before = await getPatientAccountStatement(tenantId, patientId)
    expect(before.success).toBe(true)
    if (!before.success) return
    // Stated as literals, so this is not a before === after tautology.
    expect(before.data.appointmentsDebt).toBe(7000)
    expect(before.data.advancesCredit).toBe(0)
    expect(before.data.advancesHeld).toBe(5000)
    expect(before.data.reservedAdvances).toEqual([
      { budgetId: budget.id, reserved: 5000, consumed: 0, remaining: 5000, open: true },
    ])

    const refused = await deleteBudget(tenantId, budget.id)
    expect(refused).toEqual({ success: false, code: 'HAS_RESERVED_ADVANCE' })
    expect((await prisma.budget.findUniqueOrThrow({ where: { id: budget.id } })).isActive).toBe(true)

    const after = await getPatientAccountStatement(tenantId, patientId)
    expect(after.success).toBe(true)
    if (!after.success) return
    expect(after.data.appointmentsDebt).toBe(7000)
    expect(after.data.advancesCredit).toBe(0)
    expect(after.data.advancesHeld).toBe(5000)
    expect(after.data.reservedAdvances).toEqual(before.data.reservedAdvances)
  })

  it('G6 - an executed charge of 6300 stays in the debt: getPatientBalance().totalDebt is identical before and after the refused delete', async () => {
    const patientId = await newPatient('Executed')
    const budget = await prisma.budget.create({
      data: { tenantId, patientId, status: 'APPROVED', totalAmount: 6300 },
    })
    const line = await prisma.budgetItem.create({
      data: {
        budgetId: budget.id,
        description: 'executed 6300',
        unitPrice: 6300,
        totalPrice: 6300,
        status: 'PENDING',
      },
    })
    const appt = await appointment(patientId, null, 0)
    // The real path: schedule the line onto the visit, then confirm it as
    // executed (assertItemsExecutable requires the SCHEDULED link first).
    const scheduled = await setAppointmentBudgetItems(tenantId, appt.id, [line.id], null)
    expect(scheduled.success).toBe(true)
    const confirmed = await confirmExecutedBudgetItems(tenantId, appt.id, [line.id], null)
    expect(confirmed.success).toBe(true)

    const before = await getPatientBalance(tenantId, patientId)
    expect(before.success).toBe(true)
    if (!before.success) return
    expect(before.data.totalDebt).toBe(6300)
    expect(before.data.outstanding).toBe(6300)

    const refused = await deleteBudget(tenantId, budget.id)
    expect(refused).toEqual({ success: false, code: 'HAS_BILLED_ITEMS' })
    expect((await prisma.budget.findUniqueOrThrow({ where: { id: budget.id } })).isActive).toBe(true)

    const after = await getPatientBalance(tenantId, patientId)
    expect(after.success).toBe(true)
    if (!after.success) return
    expect(after.data.totalDebt).toBe(6300)
    expect(after.data.outstanding).toBe(6300)
  })
})
