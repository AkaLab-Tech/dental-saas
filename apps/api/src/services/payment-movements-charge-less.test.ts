import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { prisma } from '@dental/database'
import {
  getPatientAccountStatement,
  getPatientBalance,
  isChargeLessAppointment,
  listPaymentMovements,
  type BillableItem,
  type PaymentMovement,
} from './payment.service.js'

/**
 * Task #714: a RECEIVED row of the payment-movements ledger carries
 * `chargeLess: true` when an ACTIVE `kind = APPOINTMENT` payment sits on an
 * appointment that has no charge of its own (no typed cost > 0 and no priced
 * EXECUTED budget-item link attributable to it). The flag is derived and
 * read-only: no money figure moves (G8).
 *
 * Guards (numbered once, here):
 *  G1 fires on the reported shape        G7 discriminates, not vacuous
 *  G2 silent with a typed cost           G8 no money figure moves
 *  G3 silent with a priced EXECUTED link G9 query count bounded
 *  G4 silent for a deliberate ADVANCE    (G10-G12 live in the app package)
 *  G5 silent for a reversed payment
 *  G6 cost of exactly 0 behaves like null
 *
 * Every figure is a literal, with DISTINCT amounts per case so a swap shows.
 */

const DAY = 24 * 60 * 60 * 1000
const BASE = new Date('2026-05-04T15:00:00.000Z').getTime()
const at = (days: number) => new Date(BASE + days * DAY)

describe('payment-movements chargeLess flag (#714)', () => {
  let tenantId: string
  let doctorId: string
  const suffix = Date.now()
  let seq = 0

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
      data: { name: 'Movements Charge Less', slug: `movements-charge-less-${suffix}` },
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
          firstName: 'Movements',
          lastName: 'Doctor',
          email: `movements-chargeless-doc-${suffix}@test.com`,
        },
      })
    ).id
  })

  afterAll(async () => {
    await prisma.patientPaymentEvent.deleteMany({ where: { tenantId } })
    await prisma.patientPayment.deleteMany({ where: { tenantId } })
    await prisma.appointment.deleteMany({ where: { tenantId } })
    await prisma.budget.deleteMany({ where: { tenantId } })
    await prisma.patient.deleteMany({ where: { tenantId } })
    await prisma.doctor.deleteMany({ where: { tenantId } })
    await prisma.subscription.deleteMany({ where: { tenantId } })
    await prisma.tenant.delete({ where: { id: tenantId } })
  })

  async function newPatient(label: string): Promise<string> {
    seq += 1
    return (
      await prisma.patient.create({ data: { tenantId, firstName: label, lastName: `P${seq}` } })
    ).id
  }

  async function seedAppointment(
    patientId: string,
    cost: number | null,
    days: number,
    extra: { isActive?: boolean; status?: 'SCHEDULED' | 'CANCELLED' } = {}
  ): Promise<string> {
    const startTime = at(days)
    return (
      await prisma.appointment.create({
        data: {
          tenantId,
          patientId,
          doctorId,
          startTime,
          endTime: new Date(startTime.getTime() + 30 * 60_000),
          duration: 30,
          cost,
          ...extra,
        },
      })
    ).id
  }

  async function seedPayment(
    patientId: string,
    amount: number,
    days: number,
    opts: {
      kind?: 'APPOINTMENT' | 'ADVANCE'
      appointmentId?: string | null
      isActive?: boolean
    } = {}
  ): Promise<string> {
    return (
      await prisma.patientPayment.create({
        data: {
          tenantId,
          patientId,
          amount,
          date: at(days),
          kind: opts.kind ?? 'APPOINTMENT',
          appointmentId: opts.appointmentId ?? null,
          isActive: opts.isActive ?? true,
        },
      })
    ).id
  }

  /** A budget with ONE item of the given price, linked EXECUTED to the appointment. */
  async function linkExecutedItem(
    patientId: string,
    appointmentId: string,
    price: number
  ): Promise<void> {
    const budget = await prisma.budget.create({
      data: { tenantId, patientId, status: 'APPROVED', totalAmount: price },
    })
    const item = await prisma.budgetItem.create({
      data: {
        budgetId: budget.id,
        description: `executed ${price}`,
        quantity: 1,
        unitPrice: price,
        totalPrice: price,
        status: 'EXECUTED',
      },
    })
    await prisma.budgetItemAppointment.create({
      data: { budgetItemId: item.id, appointmentId, role: 'EXECUTED' },
    })
  }

  async function received(patientId: string): Promise<PaymentMovement[]> {
    return (await listPaymentMovements(tenantId, patientId)).filter((m) => m.type === 'RECEIVED')
  }

  async function rowOf(patientId: string, paymentId: string): Promise<PaymentMovement> {
    const row = (await received(patientId)).find((m) => m.paymentId === paymentId)
    if (!row) throw new Error(`fixture: no RECEIVED row for payment ${paymentId}`)
    return row
  }

  // ------------------------------------------------------------------
  // G1
  // ------------------------------------------------------------------
  describe('G1: the reported shape is flagged', () => {
    it('an active APPOINTMENT payment of 1,830 on a visit with cost null and no EXECUTED link carries chargeLess === true', async () => {
      const patientId = await newPatient('G1')
      const appointmentId = await seedAppointment(patientId, null, 0)
      const paymentId = await seedPayment(patientId, 1830, 0, { appointmentId })

      const row = await rowOf(patientId, paymentId)
      expect(Number(row.amount)).toBe(1830)
      expect(row.appointmentId).toBe(appointmentId)
      expect(row.chargeLess).toBe(true)
    })
  })

  // ------------------------------------------------------------------
  // G2
  // ------------------------------------------------------------------
  describe('G2: a typed cost silences the flag', () => {
    it('the same payment shape on a visit with cost 2,350 carries chargeLess === false', async () => {
      const patientId = await newPatient('G2')
      const appointmentId = await seedAppointment(patientId, 2350, 0)
      const paymentId = await seedPayment(patientId, 1840, 0, { appointmentId })

      expect((await rowOf(patientId, paymentId)).chargeLess).toBe(false)
    })
  })

  // ------------------------------------------------------------------
  // G3
  // ------------------------------------------------------------------
  describe('G3: a priced EXECUTED budget-item link silences the flag (post-#544 flow)', () => {
    it('no typed cost, one 3,150 item linked EXECUTED on the live visit -> chargeLess === false', async () => {
      const patientId = await newPatient('G3')
      const appointmentId = await seedAppointment(patientId, null, 0)
      await linkExecutedItem(patientId, appointmentId, 3150)
      const paymentId = await seedPayment(patientId, 1850, 0, { appointmentId })

      expect((await rowOf(patientId, paymentId)).chargeLess).toBe(false)
    })
  })

  // ------------------------------------------------------------------
  // G4
  // ------------------------------------------------------------------
  describe('G4: a deliberate ADVANCE is never flagged', () => {
    it('kind ADVANCE with appointmentId null (the #529 advance) -> chargeLess === false', async () => {
      const patientId = await newPatient('G4a')
      const paymentId = await seedPayment(patientId, 1860, 0, { kind: 'ADVANCE', appointmentId: null })

      const row = await rowOf(patientId, paymentId)
      expect(row.appointmentId).toBeNull()
      expect(row.chargeLess).toBe(false)
    })

    it('kind ADVANCE with a non-null appointmentId on a charge-less visit (the #391 cancel conversion) -> chargeLess === false', async () => {
      const patientId = await newPatient('G4b')
      const appointmentId = await seedAppointment(patientId, null, 0)
      const paymentId = await seedPayment(patientId, 1870, 0, { kind: 'ADVANCE', appointmentId })

      const row = await rowOf(patientId, paymentId)
      expect(row.appointmentId).toBe(appointmentId)
      expect(row.chargeLess).toBe(false)
    })
  })

  // ------------------------------------------------------------------
  // G5
  // ------------------------------------------------------------------
  describe('G5: a reversed payment is not flagged, and still appears in the ledger', () => {
    it('isActive false on a charge-less visit: the RECEIVED row is present with chargeLess === false', async () => {
      const patientId = await newPatient('G5')
      const appointmentId = await seedAppointment(patientId, null, 0)
      const paymentId = await seedPayment(patientId, 1880, 0, { appointmentId, isActive: false })

      const rows = await received(patientId)
      expect(rows).toHaveLength(1)
      expect(rows[0].paymentId).toBe(paymentId)
      expect(Number(rows[0].amount)).toBe(1880)
      expect(rows[0].chargeLess).toBe(false)
    })
  })

  // ------------------------------------------------------------------
  // G6
  // ------------------------------------------------------------------
  describe('G6: a cost of exactly 0 behaves like null', () => {
    it('visit cost 0 -> chargeLess === true (the cost > 0 test carries the rule, not the query)', async () => {
      const patientId = await newPatient('G6')
      const appointmentId = await seedAppointment(patientId, 0, 0)
      const paymentId = await seedPayment(patientId, 1890, 0, { appointmentId })

      expect((await rowOf(patientId, paymentId)).chargeLess).toBe(true)
    })

    it('the predicate directly: an item with cost 0 attributed to the visit is not a charge', () => {
      const zero: BillableItem = {
        id: 'visit-1',
        type: 'appointment',
        cost: 0,
        date: at(0),
        isPaid: false,
      }
      expect(isChargeLessAppointment([zero], 'visit-1')).toBe(true)
      expect(isChargeLessAppointment([{ ...zero, cost: 1 }], 'visit-1')).toBe(false)
    })

    it('the predicate directly: a budgetItem of cost 0 attributed to the visit is not a charge either', () => {
      const zeroLink: BillableItem = {
        id: 'item-1',
        type: 'budgetItem',
        cost: 0,
        date: at(0),
        isPaid: false,
        appointmentId: 'visit-1',
      }
      expect(isChargeLessAppointment([zeroLink], 'visit-1')).toBe(true)
      expect(isChargeLessAppointment([{ ...zeroLink, cost: 1 }], 'visit-1')).toBe(false)
    })
  })

  // ------------------------------------------------------------------
  // Chosen, not inherited: soft-deleted and non-RECEIVED rows
  // ------------------------------------------------------------------
  describe('chosen behaviours', () => {
    it('an active APPOINTMENT payment still on a SOFT-DELETED visit is flagged (pool money with no charge)', async () => {
      const patientId = await newPatient('SoftDeleted')
      // The visit carries a cost, but it is inactive and so absent from the billable items.
      const appointmentId = await seedAppointment(patientId, 4210, 0, { isActive: false })
      const paymentId = await seedPayment(patientId, 1910, 0, { appointmentId })

      expect((await rowOf(patientId, paymentId)).chargeLess).toBe(true)
    })

    it('non-RECEIVED rows (event and legacy reversal) carry chargeLess === false, beside a flagged RECEIVED row', async () => {
      const patientId = await newPatient('NonReceived')
      const appointmentId = await seedAppointment(patientId, null, 0)
      // Active payment on a charge-less visit with a CONVERTED_TO_ADVANCE event on it.
      const eventPaymentId = await seedPayment(patientId, 1920, 0, { appointmentId })
      await prisma.patientPaymentEvent.create({
        data: { tenantId, paymentId: eventPaymentId, type: 'CONVERTED_TO_ADVANCE', occurredAt: at(0) },
      })
      // Inactive payment, no REVERSED event -> a legacy REVERSED row.
      const legacyPaymentId = await seedPayment(patientId, 1930, 0, { appointmentId, isActive: false })

      const all = await listPaymentMovements(tenantId, patientId)
      const nonReceived = all.filter((m) => m.type !== 'RECEIVED')
      expect(nonReceived.map((m) => `${m.type}:${m.paymentId}`).sort()).toEqual(
        [`CONVERTED_TO_ADVANCE:${eventPaymentId}`, `REVERSED:${legacyPaymentId}`].sort()
      )
      for (const m of nonReceived) expect(m.chargeLess).toBe(false)
      const flagged = all.filter((m) => m.chargeLess === true)
      expect(flagged.map((m) => `${m.type}:${m.paymentId}`)).toEqual([`RECEIVED:${eventPaymentId}`])
    })
  })

  // ------------------------------------------------------------------
  // G7 + G8: one fixture, both payments, the money does not move
  // ------------------------------------------------------------------
  describe('G7/G8: one patient, one charge-less and one charged payment', () => {
    let patientId: string
    let visitA: string
    let visitB: string
    let paymentA: string
    let paymentB: string

    beforeAll(async () => {
      patientId = await newPatient('G7')
      visitA = await seedAppointment(patientId, null, 0)
      visitB = await seedAppointment(patientId, 8500, 1)
      paymentA = await seedPayment(patientId, 1800, 0, { appointmentId: visitA })
      paymentB = await seedPayment(patientId, 4000, 1, { appointmentId: visitB })
    })

    it('G7: exactly one of the two RECEIVED rows is flagged, and it is the one on the charge-less visit', async () => {
      const rows = await received(patientId)
      expect(rows).toHaveLength(2)

      const a = rows.find((r) => r.paymentId === paymentA)
      const b = rows.find((r) => r.paymentId === paymentB)
      expect(Number(a?.amount)).toBe(1800)
      expect(Number(b?.amount)).toBe(4000)
      expect(a?.chargeLess).toBe(true)
      expect(b?.chargeLess).toBe(false)
      expect(rows.filter((r) => r.chargeLess === true)).toHaveLength(1)
      // Fails if the flag were set unconditionally.
      expect(rows.filter((r) => r.chargeLess === false)).toHaveLength(1)
    })

    it('G8: the statement reads 8,500 billed / 5,800 paid and applied to visit B / 2,700 outstanding, no credit', async () => {
      const result = await getPatientAccountStatement(tenantId, patientId)
      if (!result.success) throw new Error(`statement failed: ${result.code}`)
      expect(result.data).toMatchObject({
        totalBilled: 8500,
        totalPaid: 5800,
        appointmentsDebt: 2700,
        advancesCredit: 0,
        advancesTotal: 0,
      })
    })

    it('G8: the balance reads 8,500 debt / 5,800 paid / 2,700 outstanding / 0 credit', async () => {
      const result = await getPatientBalance(tenantId, patientId)
      if (!result.success) throw new Error(`balance failed: ${result.code}`)
      expect(result.data).toEqual({
        totalDebt: 8500,
        totalPaid: 5800,
        outstanding: 2700,
        credit: 0,
      })
    })
  })

  // ------------------------------------------------------------------
  // G9: the query count does not grow with the number of payments
  // ------------------------------------------------------------------
  describe('G9: query count is bounded', () => {
    // Prisma's model delegates sit behind a Proxy that does not survive
    // vi.spyOn (the spied findMany resolves to a non-array), so the spy goes one
    // layer down: every statement Prisma issues is one `query` on the pg pool
    // the driver adapter owns. The pool is the real seam all queries cross.
    async function countQueries(patientId: string): Promise<number> {
      await prisma.tenant.count() // make sure the lazy client and its pool exist
      const pool = (globalThis as unknown as { prismaPool: { query: (...a: unknown[]) => unknown } })
        .prismaPool
      const spy = vi.spyOn(pool, 'query')
      try {
        await listPaymentMovements(tenantId, patientId)
        return spy.mock.calls.length
      } finally {
        spy.mockRestore()
      }
    }

    it('a patient with 1 charge-less payment costs the same number of queries as a patient with 5, and the count is non-zero', async () => {
      const one = await newPatient('G9one')
      const oneVisit = await seedAppointment(one, null, 0)
      await seedPayment(one, 1940, 0, { appointmentId: oneVisit })

      const five = await newPatient('G9five')
      for (let i = 0; i < 5; i++) {
        const visit = await seedAppointment(five, null, i)
        await seedPayment(five, 1950 + i, i, { appointmentId: visit })
      }
      expect(await received(five)).toHaveLength(5)

      const countOne = await countQueries(one)
      const countFive = await countQueries(five)
      expect(countOne).toBeGreaterThan(0)
      expect(countFive).toBe(countOne)
    })
  })
})
