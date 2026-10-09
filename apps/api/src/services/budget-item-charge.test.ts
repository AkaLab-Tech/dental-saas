import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { prisma } from '@dental/database'
import {
  computeFifoAllocation,
  computeOutstandingByPatient,
  getPatientBalance,
  getTotalPaid,
  listBillableItems,
  recalculatePaidStatus,
} from './payment.service.js'
import { getAppointmentsByPatient } from './appointment.service.js'
import { confirmExecutedBudgetItems } from './budget-appointment.service.js'

/**
 * Task #544: an executed budget item must create a charge.
 *
 * Everything here runs from persisted rows in the test database through the
 * real services (getBillableItems -> computeFifoAllocation, getPatientBalance,
 * getAppointmentsByPatient). Nothing hands the allocator a pre-built item
 * list. Amounts are distinct per role on purpose (a fixture whose values
 * coincide hides a swap).
 */

const DAY = 24 * 60 * 60 * 1000
const BASE = new Date('2026-03-02T15:00:00.000Z').getTime()
const at = (days: number) => new Date(BASE + days * DAY)

describe('executed budget item creates a charge (#544)', () => {
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
      data: { name: 'Budget Charge Svc', slug: `budget-charge-svc-${suffix}` },
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
        data: { tenantId, firstName: 'Charge', lastName: 'Doctor', email: `charge-doc-${suffix}@test.com` },
      })
    ).id
  })

  afterAll(async () => {
    await prisma.patientPayment.deleteMany({ where: { tenantId } })
    await prisma.labwork.deleteMany({ where: { tenantId } })
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

  async function seedAppointment(
    patientId: string,
    startTime: Date,
    cost: number | null,
    overrides: Record<string, unknown> = {}
  ) {
    return prisma.appointment.create({
      data: {
        tenantId,
        patientId,
        doctorId,
        startTime,
        endTime: new Date(startTime.getTime() + 30 * 60_000),
        duration: 30,
        cost,
        ...overrides,
      },
    })
  }

  async function seedAdvance(patientId: string, amount: number) {
    return prisma.patientPayment.create({
      data: { tenantId, patientId, amount, date: at(-30), kind: 'ADVANCE' },
    })
  }

  async function seedBudgetItem(
    patientId: string,
    price: number,
    status: 'PENDING' | 'SCHEDULED' | 'EXECUTED',
    overrides: { itemId?: string; budgetIsActive?: boolean } = {}
  ) {
    const budget = await prisma.budget.create({
      data: { tenantId, patientId, isActive: overrides.budgetIsActive ?? true },
    })
    return prisma.budgetItem.create({
      data: {
        ...(overrides.itemId ? { id: overrides.itemId } : {}),
        budgetId: budget.id,
        description: `item ${price}`,
        unitPrice: price,
        totalPrice: price,
        status,
      },
    })
  }

  const link = (budgetItemId: string, appointmentId: string, role: 'SCHEDULED' | 'EXECUTED') =>
    prisma.budgetItemAppointment.create({ data: { budgetItemId, appointmentId, role } })

  const paymentCount = (patientId: string) => prisma.patientPayment.count({ where: { tenantId, patientId } })

  // --------------------------------------------------------------------
  // THE ACCEPTANCE CASE
  // --------------------------------------------------------------------
  describe('acceptance: advance 22500, item 5500 executed, no payment on the appointment', () => {
    // Shared setup: the real execution path from persisted rows. Each `it`
    // below asserts ONE concern so a regression in one shows up alone.
    async function executeAcceptanceCase(advance: number) {
      const patientId = await newPatient('Acceptance')
      await seedAdvance(patientId, advance)
      // The appointment carries NO typed cost: the only charge is the item.
      const appt = await seedAppointment(patientId, at(0), null)
      const item = await seedBudgetItem(patientId, 5500, 'SCHEDULED')
      await link(item.id, appt.id, 'SCHEDULED')
      expect(await paymentCount(patientId)).toBe(1)

      // Before execution: nothing is charged, the whole advance is credit.
      expect(await getPatientBalance(tenantId, patientId)).toEqual({
        success: true,
        data: { totalDebt: 0, totalPaid: advance, outstanding: 0, credit: advance },
      })

      const confirmed = await confirmExecutedBudgetItems(tenantId, appt.id, [item.id], null)
      expect(confirmed.success).toBe(true)
      return { patientId, appt, item }
    }

    it('GUARD 1 - credit: 22500 advance minus a 5500 executed item leaves credit 17000 and outstanding 0', async () => {
      const { patientId } = await executeAcceptanceCase(22500)
      // It is credit 22500 / totalDebt 0 when no charge is created.
      expect(await getPatientBalance(tenantId, patientId)).toEqual({
        success: true,
        data: { totalDebt: 5500, totalPaid: 22500, outstanding: 0, credit: 17000 },
      })
    })

    it('GUARD 2 - no phantom payment: the PatientPayment rows are counted and still only the original advance', async () => {
      const { patientId } = await executeAcceptanceCase(22500)
      expect(await paymentCount(patientId)).toBe(1)
      const payments = await prisma.patientPayment.findMany({ where: { tenantId, patientId } })
      expect(payments).toHaveLength(1)
      expect(payments[0].kind).toBe('ADVANCE')
      expect(payments[0].amount.toNumber()).toBe(22500)
      expect(payments[0].appointmentId).toBeNull()
    })

    it('the real allocator, fed by the persisted rows, covers the item in full and caches isPaid', async () => {
      const { patientId, appt, item } = await executeAcceptanceCase(22500)
      const billable = await listBillableItems(tenantId, patientId)
      expect(billable).toHaveLength(1)
      expect(billable[0]).toMatchObject({
        id: item.id,
        type: 'budgetItem',
        cost: 5500,
        appointmentId: appt.id,
      })
      expect(computeFifoAllocation(billable, await getTotalPaid(tenantId, patientId))).toEqual([
        expect.objectContaining({
          id: item.id,
          type: 'budgetItem',
          cost: 5500,
          paidAmount: 5500,
          outstanding: 0,
          isPaid: true,
        }),
      ])
      // The persisted cache follows the allocation (separate from status).
      const persisted = await prisma.budgetItem.findUniqueOrThrow({ where: { id: item.id } })
      expect(persisted.status).toBe('EXECUTED')
      expect(persisted.isPaid).toBe(true)
    })

    it('GUARD 3 - display: the appointment shows 5500 as covered (BUDGET_ITEMS_DISPLAY_AGGREGATE)', async () => {
      const { patientId, appt } = await executeAcceptanceCase(22500)
      const [shown] = await getAppointmentsByPatient(tenantId, patientId)
      expect(shown.id).toBe(appt.id)
      expect(shown.budgetItems).toEqual({ count: 1, cost: 5500, paidAmount: 5500, outstanding: 0 })
      // The aggregate sits apart from the appointment's own (null) typed cost.
      expect(shown.paidAmount).toBe(0)
      expect(shown.outstanding).toBe(0)
    })

    it('an advance smaller than the item leaves a debt, still with no new payment row', async () => {
      const { patientId, item } = await executeAcceptanceCase(2100)
      expect(await getPatientBalance(tenantId, patientId)).toEqual({
        success: true,
        data: { totalDebt: 5500, totalPaid: 2100, outstanding: 3400, credit: 0 },
      })
      expect(await paymentCount(patientId)).toBe(1)
      expect((await prisma.budgetItem.findUniqueOrThrow({ where: { id: item.id } })).isPaid).toBe(false)
    })

    it('an advance smaller than the item shows the partial cover on the appointment', async () => {
      const { patientId } = await executeAcceptanceCase(2100)
      const [shown] = await getAppointmentsByPatient(tenantId, patientId)
      expect(shown.budgetItems).toEqual({ count: 1, cost: 5500, paidAmount: 2100, outstanding: 3400 })
    })

    it('recalculatePaidStatus reports and repairs a stale budget item isPaid cache', async () => {
      const patientId = await newPatient('Stale')
      const appt = await seedAppointment(patientId, at(0), null)
      const item = await seedBudgetItem(patientId, 5500, 'EXECUTED')
      await link(item.id, appt.id, 'EXECUTED')
      await prisma.budgetItem.update({ where: { id: item.id }, data: { isPaid: true } })

      const dry = await recalculatePaidStatus(tenantId, patientId, { dryRun: true })
      expect(dry.budgetItemChanges).toBe(1)
      expect((await prisma.budgetItem.findUniqueOrThrow({ where: { id: item.id } })).isPaid).toBe(true)

      const result = await recalculatePaidStatus(tenantId, patientId)
      expect(result).toMatchObject({ appointmentChanges: 0, labworkChanges: 0, budgetItemChanges: 1 })
      expect((await prisma.budgetItem.findUniqueOrThrow({ where: { id: item.id } })).isPaid).toBe(false)
    })
  })

  // --------------------------------------------------------------------
  // REGRESSION: no budget items -> allocate exactly as before
  // --------------------------------------------------------------------
  describe('regression: ordinary appointment costs, NO budget items, allocate exactly as before', () => {
    it('FIFO over two appointments and a labwork with concrete figures, and no budgetItems key anywhere', async () => {
      const patientId = await newPatient('Regression')
      const first = await seedAppointment(patientId, at(0), 3200)
      const second = await seedAppointment(patientId, at(1), 4700)
      await prisma.labwork.create({
        data: { tenantId, patientId, lab: 'Lab Central', date: at(2), price: 850 },
      })
      await seedAdvance(patientId, 5000)

      expect(await getPatientBalance(tenantId, patientId)).toEqual({
        success: true,
        data: { totalDebt: 8750, totalPaid: 5000, outstanding: 3750, credit: 0 },
      })

      const billable = await listBillableItems(tenantId, patientId)
      expect(billable.map((b) => [b.type, b.cost])).toEqual([
        ['appointment', 3200],
        ['appointment', 4700],
        ['labwork', 850],
      ])
      expect(billable.some((b) => b.type === 'budgetItem')).toBe(false)

      const listed = await getAppointmentsByPatient(tenantId, patientId)
      const byId = new Map(listed.map((a) => [a.id, a]))
      expect(byId.get(first.id)).toMatchObject({ paidAmount: 3200, outstanding: 0, isPaid: true })
      expect(byId.get(second.id)).toMatchObject({ paidAmount: 1800, outstanding: 2900, isPaid: false })
      for (const a of listed) expect(a).not.toHaveProperty('budgetItems')

      const result = await recalculatePaidStatus(tenantId, patientId)
      expect(result.budgetItemChanges).toBe(0)
      expect((await prisma.appointment.findUniqueOrThrow({ where: { id: first.id } })).isPaid).toBe(true)
      expect((await prisma.appointment.findUniqueOrThrow({ where: { id: second.id } })).isPaid).toBe(false)

      const tenantWide = await computeOutstandingByPatient(tenantId)
      expect(tenantWide.get(patientId)).toMatchObject({ totalDebt: 8750, totalPaid: 5000, outstanding: 3750 })
    })

    it('an overpaid patient with only an appointment cost keeps its credit', async () => {
      const patientId = await newPatient('RegressionCredit')
      await seedAppointment(patientId, at(0), 1900)
      await seedAdvance(patientId, 6400)
      expect(await getPatientBalance(tenantId, patientId)).toEqual({
        success: true,
        data: { totalDebt: 1900, totalPaid: 6400, outstanding: 0, credit: 4500 },
      })
    })
  })

  // --------------------------------------------------------------------
  // BUDGET_ITEM_DATELESS
  // --------------------------------------------------------------------
  describe('BUDGET_ITEM_DATELESS: an executed item with no link to an active appointment is not billed', () => {
    it('is not billed with no link at all, with an inactive appointment, or in an inactive budget', async () => {
      const patientId = await newPatient('Dateless')
      await seedAdvance(patientId, 9000)

      // status EXECUTED, no link at all
      await seedBudgetItem(patientId, 1300, 'EXECUTED')
      // EXECUTED link, but the appointment was cancelled (inactive)
      const cancelled = await seedAppointment(patientId, at(0), null, { isActive: false })
      const onCancelled = await seedBudgetItem(patientId, 2700, 'EXECUTED')
      await link(onCancelled.id, cancelled.id, 'EXECUTED')
      // EXECUTED link on an active appointment, but the budget is inactive
      const active = await seedAppointment(patientId, at(1), null)
      const inDeadBudget = await seedBudgetItem(patientId, 4900, 'EXECUTED', { budgetIsActive: false })
      await link(inDeadBudget.id, active.id, 'EXECUTED')

      expect(await listBillableItems(tenantId, patientId)).toEqual([])
      expect(await getPatientBalance(tenantId, patientId)).toEqual({
        success: true,
        data: { totalDebt: 0, totalPaid: 9000, outstanding: 0, credit: 9000 },
      })
      expect(computeFifoAllocation(await listBillableItems(tenantId, patientId), 9000)).toEqual([])
      const [shown] = await getAppointmentsByPatient(tenantId, patientId)
      expect(shown).not.toHaveProperty('budgetItems')
      // No charge -> the patient has no debt entry at all in the tenant-wide map.
      expect((await computeOutstandingByPatient(tenantId)).get(patientId)).toBeUndefined()
    })
  })

  // --------------------------------------------------------------------
  // BUDGET_ITEM_ONCE_PER_ITEM
  // --------------------------------------------------------------------
  describe('BUDGET_ITEM_ONCE_PER_ITEM: one charge per item, from the earliest EXECUTED link', () => {
    async function seedMultiLink() {
      const patientId = await newPatient('MultiLink')
      // The LATER appointment gets the LOWER id, so an implementation that
      // picks by id (or by insertion/first row) instead of by date fails.
      const earlier = await seedAppointment(patientId, at(3), null, { id: `zz-earlier-${suffix}-${seq}` })
      const later = await seedAppointment(patientId, at(9), null, { id: `aa-later-${suffix}-${seq}` })
      const item = await seedBudgetItem(patientId, 6300, 'EXECUTED')
      await link(item.id, later.id, 'EXECUTED')
      await link(item.id, earlier.id, 'EXECUTED')
      await seedAdvance(patientId, 7700)
      return { patientId, earlier, later, item }
    }

    it('bills an item with two EXECUTED links once, dated and attributed to the earlier link (date beats id)', async () => {
      const { patientId, earlier, item } = await seedMultiLink()

      const billable = await listBillableItems(tenantId, patientId)
      expect(billable).toHaveLength(1)
      expect(billable[0]).toMatchObject({
        id: item.id,
        type: 'budgetItem',
        cost: 6300,
        appointmentId: earlier.id,
      })
      expect(billable[0].date.getTime()).toBe(at(3).getTime())

      expect(await getPatientBalance(tenantId, patientId)).toEqual({
        success: true,
        data: { totalDebt: 6300, totalPaid: 7700, outstanding: 0, credit: 1400 },
      })
      expect((await computeOutstandingByPatient(tenantId)).get(patientId)).toMatchObject({
        totalDebt: 6300,
        totalPaid: 7700,
        outstanding: 0,
      })
    })

    it('displays the multi-link item once, on the earlier appointment only', async () => {
      const { patientId, earlier, later } = await seedMultiLink()
      const listed = await getAppointmentsByPatient(tenantId, patientId)
      const byId = new Map(listed.map((a) => [a.id, a]))
      expect(byId.get(earlier.id)?.budgetItems).toEqual({
        count: 1,
        cost: 6300,
        paidAmount: 6300,
        outstanding: 0,
      })
      expect(byId.get(later.id)).not.toHaveProperty('budgetItems')
    })

    it('breaks a same-date tie on the lower appointment id', async () => {
      const patientId = await newPatient('Tie')
      const lower = await seedAppointment(patientId, at(4), null, { id: `tie-a-${suffix}` })
      const higher = await seedAppointment(patientId, at(4), null, { id: `tie-b-${suffix}` })
      const item = await seedBudgetItem(patientId, 3900, 'EXECUTED')
      // Insert the higher id first so insertion order cannot explain the pick.
      await link(item.id, higher.id, 'EXECUTED')
      await link(item.id, lower.id, 'EXECUTED')

      const billable = await listBillableItems(tenantId, patientId)
      expect(billable).toHaveLength(1)
      expect(billable[0].appointmentId).toBe(lower.id)
    })
  })

  // --------------------------------------------------------------------
  // BUDGET_ITEM_BILLABLE_AUTHORITY: status and link role DISAGREE
  // --------------------------------------------------------------------
  describe('BUDGET_ITEM_BILLABLE_AUTHORITY: the EXECUTED link role decides, not status', () => {
    async function seedDisagreement() {
      const patientId = await newPatient('Authority')
      const appt = await seedAppointment(patientId, at(0), null)
      // status says EXECUTED, link says SCHEDULED -> NOT billed
      const statusOnly = await seedBudgetItem(patientId, 1100, 'EXECUTED')
      await link(statusOnly.id, appt.id, 'SCHEDULED')
      // status says SCHEDULED, link says EXECUTED -> billed
      const roleOnly = await seedBudgetItem(patientId, 2300, 'SCHEDULED')
      await link(roleOnly.id, appt.id, 'EXECUTED')
      await seedAdvance(patientId, 10000)
      return { patientId, roleOnly }
    }

    it('bills the item whose link is EXECUTED (status SCHEDULED) and not the one with status EXECUTED but a SCHEDULED link', async () => {
      const { patientId, roleOnly } = await seedDisagreement()

      const billable = await listBillableItems(tenantId, patientId)
      expect(billable.map((b) => [b.id, b.cost])).toEqual([[roleOnly.id, 2300]])

      expect(await getPatientBalance(tenantId, patientId)).toEqual({
        success: true,
        data: { totalDebt: 2300, totalPaid: 10000, outstanding: 0, credit: 7700 },
      })
      expect((await computeOutstandingByPatient(tenantId)).get(patientId)).toMatchObject({
        totalDebt: 2300,
        totalPaid: 10000,
        outstanding: 0,
      })
    })

    it('displays only the role-EXECUTED item on the appointment', async () => {
      const { patientId } = await seedDisagreement()
      const [shown] = await getAppointmentsByPatient(tenantId, patientId)
      expect(shown.budgetItems).toEqual({ count: 1, cost: 2300, paidAmount: 2300, outstanding: 0 })
    })
  })

  // --------------------------------------------------------------------
  // typed cost PLUS an executed item
  // --------------------------------------------------------------------
  describe('typed cost plus an executed item on the same appointment', () => {
    async function seedCostPlusItem() {
      const patientId = await newPatient('CostPlusItem')
      const appt = await seedAppointment(patientId, at(0), 4100)
      const item = await seedBudgetItem(patientId, 5500, 'EXECUTED')
      await link(item.id, appt.id, 'EXECUTED')
      await seedAdvance(patientId, 7000)
      return { patientId, appt, item }
    }

    it('bills both the typed cost and the item, with no precedence rule', async () => {
      const { patientId, item } = await seedCostPlusItem()

      // Both are charged: 4100 + 5500 = 9600 (neither is dropped, nor merged
      // into one).
      expect(await getPatientBalance(tenantId, patientId)).toEqual({
        success: true,
        data: { totalDebt: 9600, totalPaid: 7000, outstanding: 2600, credit: 0 },
      })
      const billable = await listBillableItems(tenantId, patientId)
      expect(billable.map((b) => [b.type, b.cost])).toEqual([
        ['appointment', 4100],
        ['budgetItem', 5500],
      ])
      // The ledger keeps one charge per thing, with the budget identity.
      expect(billable[1].id).toBe(item.id)

      // Equal dates keep the appointment first (stable FIFO): the appointment's
      // own figures are 4100 paid of 4100 typed cost, not 9600.
      const [shown] = await getAppointmentsByPatient(tenantId, patientId)
      expect(shown).toMatchObject({ paidAmount: 4100, outstanding: 0, isPaid: true })
      expect(shown.cost?.toString()).toBe('4100')
    })

    it('shows both on the appointment, on separate figures (typed cost 4100, item 5500 with 2900 covered)', async () => {
      const { patientId } = await seedCostPlusItem()
      const [shown] = await getAppointmentsByPatient(tenantId, patientId)
      expect(shown.cost?.toString()).toBe('4100')
      expect(shown.budgetItems).toEqual({ count: 1, cost: 5500, paidAmount: 2900, outstanding: 2600 })
    })
  })
})
