/**
 * Task #529: an advance reserved to a budget is consumed only by that budget's
 * work.
 *
 * The allocation engine is what every money screen reads, so a regression here
 * is silent: wrong figures that look like figures. The file therefore pins, in
 * one place:
 *
 *   1. the acceptance figure (22500 reserved, 5500 executed -> 17000 left),
 *      produced by the REAL routes end to end;
 *   2. a differential (two-worlds) guard: the same fixture with and without a
 *      reservation, the unreserved world byte-identical to the pre-#529 answer;
 *   3. the payment-row COUNT (a figure cannot tell a reservation from a
 *      duplicate payment);
 *   4. the two product-lead rules (overflow is ordinary debt, excess on a
 *      completed budget is ordinary credit);
 *   5. validation (other patient / other tenant / closed budget);
 *   6. the pure functions, including the clamp;
 *   7. a float-sensitive fixture asserting exact cents.
 *
 * No real patient data: ids, figures and states only.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { api } from '../test/http.js'
import { prisma } from '@dental/database'
import { hashPassword } from '../services/auth.service.js'
import { generateToken } from '../test/tokens.js'
import {
  computeFifoAllocation,
  computeReservationUsage,
  createPayment,
  type BillableItem,
  type BudgetReservations,
} from '../services/payment.service.js'

// ---------------------------------------------------------------------------
// Pure functions (no DB)
// ---------------------------------------------------------------------------

function charge(
  id: string,
  cost: number,
  dayOffset: number,
  budgetId?: string,
  type: BillableItem['type'] = 'budgetItem'
): BillableItem {
  return { id, type, cost, date: new Date(2026, 0, 1 + dayOffset), isPaid: false, budgetId }
}

function reservations(entries: Record<string, { amount: number; open: boolean }>): BudgetReservations {
  return new Map(Object.entries(entries))
}

/** The pre-#529 walk, copied verbatim in spirit: earmarks first, then one pool. */
function preChangeAllocation(
  items: BillableItem[],
  totalPaid: number,
  earmarks?: ReadonlyMap<string, number>
) {
  const toCents = (d: number) => Math.round(d * 100)
  const costCents = items.map((i) => toCents(i.cost))
  const earmarkedCents = items.map((i, idx) =>
    costCents[idx] > 0 ? Math.min(toCents(earmarks?.get(i.id) ?? 0), costCents[idx]) : 0
  )
  const totalEarmarked = earmarkedCents.reduce((s, c) => s + c, 0)
  let remaining = Math.max(0, toCents(totalPaid) - totalEarmarked)
  return items.map((i, idx) => {
    const capacity = costCents[idx] - earmarkedCents[idx]
    const fromPool = Math.min(remaining, capacity)
    remaining = Math.max(0, remaining - capacity)
    const paid = earmarkedCents[idx] + fromPool
    return {
      id: i.id,
      type: i.type,
      cost: i.cost,
      paidAmount: paid / 100,
      outstanding: (costCents[idx] - paid) / 100,
      isPaid: paid >= costCents[idx],
    }
  })
}

describe('Task #529 pure: computeReservationUsage', () => {
  it('a charge of a budget with no reservation consumes nothing and a reservation no charge matches stays whole', () => {
    const usage = computeReservationUsage(
      [charge('i1', 100, 0, 'other'), charge('a1', 50, 1, undefined, 'appointment')],
      reservations({ b1: { amount: 300, open: true } })
    )
    expect(usage.itemCents).toEqual([0, 0])
    expect(usage.budgets.get('b1')).toEqual({ reservedCents: 30000, consumedCents: 0, open: true })
  })

  it('spends the reservation oldest-first and clamps the last charge at what is left (clamp)', () => {
    const usage = computeReservationUsage(
      [charge('i1', 200, 0, 'b1'), charge('i2', 200, 1, 'b1'), charge('i3', 200, 2, 'b1')],
      reservations({ b1: { amount: 450, open: true } })
    )
    expect(usage.itemCents).toEqual([20000, 20000, 5000])
    expect(usage.budgets.get('b1')?.consumedCents).toBe(45000)
  })

  it('keeps two budgets independent', () => {
    const usage = computeReservationUsage(
      [charge('i1', 100, 0, 'b1'), charge('i2', 100, 1, 'b2'), charge('i3', 100, 2, 'b1')],
      reservations({ b1: { amount: 150, open: true }, b2: { amount: 40, open: false } })
    )
    expect(usage.itemCents).toEqual([10000, 4000, 5000])
    expect(usage.budgets.get('b1')).toEqual({ reservedCents: 15000, consumedCents: 15000, open: true })
    expect(usage.budgets.get('b2')).toEqual({ reservedCents: 4000, consumedCents: 4000, open: false })
  })

  it('a zero-cost charge consumes nothing', () => {
    const usage = computeReservationUsage([charge('i1', 0, 0, 'b1')], reservations({ b1: { amount: 10, open: true } }))
    expect(usage.itemCents).toEqual([0])
  })
})

describe('Task #529 pure: computeFifoAllocation with reservations', () => {
  it('a reserved advance covers only its budget: the older unrelated charge stays unpaid', () => {
    // paid 500 = 300 reserved to b1 + 200 general. FIFO would hand the older
    // "old" charge the first 500; with the reservation it only gets the 200.
    const items = [charge('old', 400, 0, 'other'), charge('mine', 300, 1, 'b1')]
    const result = computeFifoAllocation(items, 500, undefined, reservations({ b1: { amount: 300, open: true } }))
    expect(result.map((r) => [r.id, r.paidAmount, r.outstanding, r.isPaid])).toEqual([
      ['old', 200, 200, false],
      ['mine', 300, 0, true],
    ])
  })

  it('rule 2 (overflow): a 30000 charge against a 22500 reservation leaves 7500 of ordinary debt', () => {
    const result = computeFifoAllocation(
      [charge('big', 30000, 0, 'b1')],
      22500,
      undefined,
      reservations({ b1: { amount: 22500, open: true } })
    )
    expect(result).toEqual([
      { id: 'big', type: 'budgetItem', cost: 30000, paidAmount: 22500, outstanding: 7500, isPaid: false },
    ])
  })

  it('rule 2 (overflow): the remainder is payable from the general pool', () => {
    const result = computeFifoAllocation(
      [charge('big', 30000, 0, 'b1')],
      22500 + 5000,
      undefined,
      reservations({ b1: { amount: 22500, open: true } })
    )
    expect(result[0]).toMatchObject({ paidAmount: 27500, outstanding: 2500, isPaid: false })
  })

  it('an open budget keeps its leftover out of the general pool', () => {
    const items = [charge('a', 100, 0, 'b1'), charge('elsewhere', 100, 1, 'other')]
    const result = computeFifoAllocation(items, 300, undefined, reservations({ b1: { amount: 300, open: true } }))
    expect(result.map((r) => [r.id, r.paidAmount])).toEqual([
      ['a', 100],
      ['elsewhere', 0],
    ])
  })

  it('rule 1 (excess): once the budget is closed the leftover rejoins the pool and pays other charges', () => {
    const items = [charge('a', 100, 0, 'b1'), charge('elsewhere', 150, 1, 'other')]
    const result = computeFifoAllocation(items, 300, undefined, reservations({ b1: { amount: 300, open: false } }))
    expect(result.map((r) => [r.id, r.paidAmount, r.outstanding])).toEqual([
      ['a', 100, 0],
      ['elsewhere', 150, 0],
    ])
  })

  it('the reservation composes with earmarks: both are absorbed before the pool', () => {
    const items = [charge('x', 100, 0, 'other', 'appointment'), charge('mine', 100, 1, 'b1')]
    const result = computeFifoAllocation(
      items,
      150 + 100,
      new Map([['x', 50]]),
      reservations({ b1: { amount: 100, open: true } })
    )
    // earmark 50 on x, reservation 100 on mine, pool = 250 - 50 - 100 = 100 -> x's remaining 50.
    expect(result.map((r) => [r.id, r.paidAmount, r.outstanding])).toEqual([
      ['x', 100, 0],
      ['mine', 100, 0],
    ])
  })

  it('does not go negative when the reservation outgrows the totalPaid snapshot', () => {
    const result = computeFifoAllocation(
      [charge('other', 100, 0, 'other')],
      10,
      undefined,
      reservations({ b1: { amount: 500, open: true } })
    )
    expect(result[0]).toMatchObject({ paidAmount: 0, outstanding: 100 })
  })

  it('differential: with no, empty or unrelated reservations the answer equals the pre-#529 walk', () => {
    const costs = [0.1, 0.2, 0.7, 33.33, 100, 1.15, 8.2, 250.05, 0.29]
    const items = costs.map((c, i) => charge(`i${i}`, c, i, i % 2 ? 'b-x' : undefined, i % 3 ? 'budgetItem' : 'appointment'))
    const earmarks = new Map([['i3', 10.1]])
    for (const paid of [0, 0.1, 0.3, 1, 33.43, 100.1, 143.7, 394.02, 394.03, 10000]) {
      const expected = preChangeAllocation(items, paid, earmarks)
      expect(computeFifoAllocation(items, paid, earmarks)).toEqual(expected)
      expect(computeFifoAllocation(items, paid, earmarks, new Map())).toEqual(expected)
      expect(
        computeFifoAllocation(items, paid, earmarks, reservations({ 'no-such-budget': { amount: 0, open: true } }))
      ).toEqual(expected)
    }
  })

  it('float-sensitive: 0.07 + 0.29 + 1.15 + 8.20 charged against a 20.10 reservation yields exact cents', () => {
    const result = computeFifoAllocation(
      [charge('i1', 0.07, 0, 'b1'), charge('i2', 0.29, 1, 'b1'), charge('i3', 1.15, 2, 'b1'), charge('i4', 8.2, 3, 'b1')],
      20.1,
      undefined,
      reservations({ b1: { amount: 20.1, open: true } })
    )
    expect(result.map((r) => [r.paidAmount, r.outstanding, r.isPaid])).toEqual([
      [0.07, 0, true],
      [0.29, 0, true],
      [1.15, 0, true],
      [8.2, 0, true],
    ])
    const usage = computeReservationUsage(
      [charge('i1', 0.07, 0, 'b1'), charge('i2', 0.29, 1, 'b1'), charge('i3', 1.15, 2, 'b1'), charge('i4', 8.2, 3, 'b1')],
      reservations({ b1: { amount: 20.1, open: true } })
    )
    expect(usage.budgets.get('b1')).toEqual({ reservedCents: 2010, consumedCents: 971, open: true })
    expect(usage.itemCents).toEqual([7, 29, 115, 820])
  })
})

// ---------------------------------------------------------------------------
// Integration: real routes, real rows
// ---------------------------------------------------------------------------

interface Statement {
  appointmentsDebt: number
  advancesCredit: number
  remainingBudgetProjection: number
  totalBilled: number
  totalPaid: number
  advancesTotal: number
  reservedAdvances?: Array<{
    budgetId: string
    reserved: number
    consumed: number
    remaining: number
    open: boolean
  }>
}

describe('Task #529: advances reserved to a budget (real routes)', () => {
  let tenantId: string
  let otherTenantId: string
  let token: string
  let doctorId: string
  let dayOffset = 1
  const stamp = Date.now()

  beforeAll(async () => {
    const tenant = await prisma.tenant.create({ data: { name: 'Reserved Advances Clinic', slug: `reserved-adv-${stamp}` } })
    tenantId = tenant.id
    const other = await prisma.tenant.create({ data: { name: 'Reserved Advances Other', slug: `reserved-adv-other-${stamp}` } })
    otherTenantId = other.id
    const admin = await prisma.user.create({
      data: {
        email: `admin-reserved-adv-${stamp}@test.com`,
        passwordHash: await hashPassword('AdminPass123!'),
        firstName: 'Admin',
        lastName: 'User',
        role: 'ADMIN',
        tenantId,
      },
    })
    token = generateToken(admin.id, tenantId, 'ADMIN')
    const doctor = await prisma.doctor.create({
      data: {
        tenantId,
        firstName: 'Doctor',
        lastName: 'Fixture',
        email: `doctor-reserved-adv-${stamp}@test.com`,
        specialty: 'General Dentistry',
      },
    })
    doctorId = doctor.id
  })

  afterAll(async () => {
    for (const id of [tenantId, otherTenantId]) {
      await prisma.patientPayment.deleteMany({ where: { tenantId: id } })
      await prisma.budget.deleteMany({ where: { tenantId: id } })
      await prisma.appointment.deleteMany({ where: { tenantId: id } })
      await prisma.patient.deleteMany({ where: { tenantId: id } })
    }
    await prisma.doctor.deleteMany({ where: { tenantId } })
    await prisma.refreshToken.deleteMany({ where: { user: { tenantId } } })
    await prisma.user.deleteMany({ where: { tenantId } })
    await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {})
    await prisma.tenant.delete({ where: { id: otherTenantId } }).catch(() => {})
  })

  const auth = () => ({ Authorization: `Bearer ${token}` })

  async function newPatient(tenant = tenantId): Promise<string> {
    const p = await prisma.patient.create({
      data: { tenantId: tenant, firstName: 'Fixture', lastName: 'Reserved', email: `p-${Math.random()}@test.com` },
    })
    return p.id
  }

  /** APPROVED budget (or `status`) with one PENDING item per price. Prices are strings: exact Decimal(10,2). */
  async function newBudget(
    patientId: string,
    prices: string[],
    status: 'DRAFT' | 'APPROVED' | 'COMPLETED' | 'CANCELLED' = 'APPROVED',
    tenant = tenantId
  ) {
    return prisma.budget.create({
      data: {
        tenantId: tenant,
        patientId,
        status,
        items: {
          create: prices.map((p, i) => ({
            description: `Item ${i + 1}`,
            quantity: 1,
            unitPrice: p,
            totalPrice: p,
            order: i,
          })),
        },
      },
      include: { items: { orderBy: { order: 'asc' } } },
    })
  }

  /** The path a user takes: schedule the items on an appointment, then confirm them at mark-done. */
  async function executeItems(patientId: string, itemIds: string[]): Promise<string> {
    const start = new Date()
    start.setDate(start.getDate() + dayOffset++)
    start.setHours(10, 0, 0, 0)
    const end = new Date(start.getTime() + 30 * 60 * 1000)
    const created = await api()
      .post('/api/appointments')
      .set(auth())
      .send({ patientId, doctorId, startTime: start.toISOString(), endTime: end.toISOString(), budgetItemIds: itemIds })
    expect(created.status).toBe(201)
    const done = await api()
      .put(`/api/appointments/${created.body.data.id}/mark-done`)
      .set(auth())
      .send({ executedBudgetItemIds: itemIds })
    expect(done.status).toBe(200)
    return created.body.data.id as string
  }

  async function postAdvance(patientId: string, amount: number, budgetId?: string) {
    return api()
      .post(`/api/patients/${patientId}/payments`)
      .set(auth())
      .send({ amount, date: new Date().toISOString(), ...(budgetId ? { budgetId } : {}) })
  }

  async function statement(patientId: string): Promise<Statement> {
    const res = await api().get(`/api/patients/${patientId}/statement`).set(auth())
    expect(res.status).toBe(200)
    return res.body.data as Statement
  }

  const paymentRows = (patientId: string) => prisma.patientPayment.count({ where: { patientId } })

  // ---- Guards 1 + 3: acceptance figure and payment-row count ---------------

  describe('acceptance: 22500 reserved, an item of 5500 executed', () => {
    it('leaves the reservation at 17000, the other advance untouched, and no new payment row', async () => {
      const patientId = await newPatient()
      const budget = await newBudget(patientId, ['5500.00', '9000.00'])

      const reserved = await postAdvance(patientId, 22500, budget.id)
      expect(reserved.status).toBe(201)
      expect(reserved.body.data.budgetId).toBe(budget.id)
      expect(reserved.body.data.kind).toBe('ADVANCE')
      const general = await postAdvance(patientId, 8000)
      expect(general.status).toBe(201)
      expect(general.body.data.budgetId).toBeNull()

      expect(await paymentRows(patientId)).toBe(2)
      const before = await statement(patientId)
      expect(before.reservedAdvances).toEqual([
        { budgetId: budget.id, reserved: 22500, consumed: 0, remaining: 22500, open: true },
      ])
      // Held money is not ordinary credit; only the general advance is.
      expect(before.advancesCredit).toBe(8000)

      const appointmentId = await executeItems(patientId, [budget.items[0].id])

      // The charge is paid out of the reservation and creates no payment.
      expect(await paymentRows(patientId)).toBe(2)
      expect(await prisma.patientPayment.count({ where: { patientId, isActive: true } })).toBe(2)
      expect(await prisma.patientPayment.count({ where: { patientId, budgetId: budget.id } })).toBe(1)
      expect(await prisma.patientPayment.count({ where: { patientId, kind: 'APPOINTMENT' } })).toBe(0)

      const after = await statement(patientId)
      expect(after).toEqual({
        appointmentsDebt: 0,
        advancesCredit: 8000,
        remainingBudgetProjection: after.remainingBudgetProjection,
        totalBilled: 5500,
        totalPaid: 30500,
        advancesTotal: 30500,
        reservedAdvances: [{ budgetId: budget.id, reserved: 22500, consumed: 5500, remaining: 17000, open: true }],
      })

      // The per-appointment screen agrees with the statement.
      const list = await api().get(`/api/appointments/by-patient/${patientId}`).set(auth())
      expect(list.status).toBe(200)
      const row = (list.body.data as Array<{ id: string; budgetItems?: Record<string, number> }>).find(
        (a) => a.id === appointmentId
      )
      expect(row?.budgetItems).toEqual({ count: 1, cost: 5500, paidAmount: 5500, outstanding: 0 })

      // The cached per-item flag follows the same allocation.
      const item = await prisma.budgetItem.findUnique({ where: { id: budget.items[0].id } })
      expect(item?.isPaid).toBe(true)
    })

    it('a reservation does not pay for work of a different budget, even when it is older', async () => {
      const patientId = await newPatient()
      const reservedBudget = await newBudget(patientId, ['1000.00'])
      const otherBudget = await newBudget(patientId, ['4000.00'])
      await postAdvance(patientId, 3000, reservedBudget.id)

      await executeItems(patientId, [otherBudget.items[0].id])

      const s = await statement(patientId)
      expect(s.appointmentsDebt).toBe(4000)
      expect(s.advancesCredit).toBe(0)
      expect(s.reservedAdvances).toEqual([
        { budgetId: reservedBudget.id, reserved: 3000, consumed: 0, remaining: 3000, open: true },
      ])
    })
  })

  describe('the cached isPaid flag (recalculatePaidStatus) honours the reservation', () => {
    it('an older unrelated charge stays unpaid while the reserved budget\'s newer charge is paid', async () => {
      const patientId = await newPatient()
      const unrelated = await newBudget(patientId, ['4000.00'])
      const reservedBudget = await newBudget(patientId, ['5500.00'])
      await postAdvance(patientId, 5500, reservedBudget.id)

      await executeItems(patientId, [unrelated.items[0].id]) // older
      await executeItems(patientId, [reservedBudget.items[0].id]) // newer

      const older = await prisma.budgetItem.findUnique({ where: { id: unrelated.items[0].id } })
      const newer = await prisma.budgetItem.findUnique({ where: { id: reservedBudget.items[0].id } })
      expect([older?.isPaid, newer?.isPaid]).toEqual([false, true])
      expect((await statement(patientId)).appointmentsDebt).toBe(4000)
    })
  })

  // ---- Guard 2: differential, two worlds -----------------------------------

  describe('differential: the same fixture with and without a reservation', () => {
    it('the unreserved world allocates exactly as before; the reserved world differs only by the reservation', async () => {
      // World U: nothing is reserved.
      const u = await newPatient()
      const ub = await newBudget(u, ['5500.00', '9000.00'])
      expect((await postAdvance(u, 22500)).status).toBe(201)
      expect((await postAdvance(u, 8000)).status).toBe(201)
      await executeItems(u, [ub.items[0].id])

      // World R: the identical fixture, the 22500 reserved to the budget.
      const r = await newPatient()
      const rb = await newBudget(r, ['5500.00', '9000.00'])
      expect((await postAdvance(r, 22500, rb.id)).status).toBe(201)
      expect((await postAdvance(r, 8000)).status).toBe(201)
      await executeItems(r, [rb.items[0].id])

      // Pre-#529 answer, worked out by hand: billed 5500, paid 30500, all of it
      // pooled -> 25000 of credit, nothing owed. The key reservedAdvances must
      // be ABSENT, not an empty array: the response is byte-identical.
      const unreserved = await statement(u)
      expect(unreserved).toEqual({
        appointmentsDebt: 0,
        advancesCredit: 25000,
        remainingBudgetProjection: unreserved.remainingBudgetProjection,
        totalBilled: 5500,
        totalPaid: 30500,
        advancesTotal: 30500,
      })
      expect('reservedAdvances' in unreserved).toBe(false)

      const reserved = await statement(r)
      // Same totals in both worlds ...
      expect({ ...reserved, reservedAdvances: undefined, advancesCredit: undefined }).toEqual({
        ...unreserved,
        reservedAdvances: undefined,
        advancesCredit: undefined,
      })
      // ... and the 17000 still held for the budget is the ONLY difference.
      expect(reserved.advancesCredit).toBe(unreserved.advancesCredit - 17000)
      expect(reserved.reservedAdvances?.[0].remaining).toBe(17000)
    })

    it('walk-sensitive: a second charge that needs the pool pins the unreserved arithmetic in both worlds', async () => {
      const perAppointment = async (patientId: string, ids: string[]) => {
        const res = await api().get(`/api/appointments/by-patient/${patientId}`).set(auth())
        const byId = new Map(
          (res.body.data as Array<{ id: string; budgetItems?: Record<string, number> }>).map((a) => [a.id, a.budgetItems])
        )
        return ids.map((id) => byId.get(id))
      }

      // World U: 22500 + 8000 pooled, charges 5500 (older) then 40000.
      const u = await newPatient()
      const ub1 = await newBudget(u, ['5500.00'])
      const ub2 = await newBudget(u, ['40000.00'])
      await postAdvance(u, 22500)
      await postAdvance(u, 8000)
      const ua1 = await executeItems(u, [ub1.items[0].id])
      const ua2 = await executeItems(u, [ub2.items[0].id])
      // Hand-worked pre-#529: pool 30500 -> 5500 to the older, 25000 to the newer, 15000 owed.
      expect((await statement(u)).appointmentsDebt).toBe(15000)
      expect(await perAppointment(u, [ua1, ua2])).toEqual([
        { count: 1, cost: 5500, paidAmount: 5500, outstanding: 0 },
        { count: 1, cost: 40000, paidAmount: 25000, outstanding: 15000 },
      ])

      // World R: the 22500 reserved to the first budget (which stays open
      // because it holds a second pending item).
      const r = await newPatient()
      const rb1 = await newBudget(r, ['5500.00', '100.00'])
      const rb2 = await newBudget(r, ['40000.00'])
      await postAdvance(r, 22500, rb1.id)
      await postAdvance(r, 8000)
      const ra1 = await executeItems(r, [rb1.items[0].id])
      const ra2 = await executeItems(r, [rb2.items[0].id])
      // 17000 stays held for the first budget; the 40000 charge only sees the 8000 pool.
      expect((await statement(r)).appointmentsDebt).toBe(32000)
      expect(await perAppointment(r, [ra1, ra2])).toEqual([
        { count: 1, cost: 5500, paidAmount: 5500, outstanding: 0 },
        { count: 1, cost: 40000, paidAmount: 8000, outstanding: 32000 },
      ])
    })

    it('an unreserved patient is unmoved by a neighbour in the same tenant who has a reservation', async () => {
      const neighbour = await newPatient()
      const nb = await newBudget(neighbour, ['100.00'])
      await postAdvance(neighbour, 5000, nb.id)

      const p = await newPatient()
      const pb = await newBudget(p, ['300.00'])
      await postAdvance(p, 120)
      await executeItems(p, [pb.items[0].id])

      const s = await statement(p)
      expect(s).toEqual({
        appointmentsDebt: 180,
        advancesCredit: 0,
        remainingBudgetProjection: s.remainingBudgetProjection,
        totalBilled: 300,
        totalPaid: 120,
        advancesTotal: 120,
      })
    })
  })

  // ---- Guard 4: rule 2 (overflow) ------------------------------------------

  describe('rule 2: a charge larger than the reservation', () => {
    it('is covered up to the reservation and the remaining 7500 is ordinary debt', async () => {
      const patientId = await newPatient()
      const budget = await newBudget(patientId, ['30000.00'])
      await postAdvance(patientId, 22500, budget.id)
      const rowsBefore = await paymentRows(patientId)

      const appointmentId = await executeItems(patientId, [budget.items[0].id])

      const s = await statement(patientId)
      expect(s.appointmentsDebt).toBe(7500)
      expect(s.advancesCredit).toBe(0)
      expect(s.reservedAdvances).toEqual([
        // The only item was executed, so the budget completed (open: false).
        { budgetId: budget.id, reserved: 22500, consumed: 22500, remaining: 0, open: false },
      ])
      expect(await paymentRows(patientId)).toBe(rowsBefore)

      const list = await api().get(`/api/appointments/by-patient/${patientId}`).set(auth())
      const row = (list.body.data as Array<{ id: string; budgetItems?: Record<string, number> }>).find(
        (a) => a.id === appointmentId
      )
      expect(row?.budgetItems).toEqual({ count: 1, cost: 30000, paidAmount: 22500, outstanding: 7500 })
      const item = await prisma.budgetItem.findUnique({ where: { id: budget.items[0].id } })
      expect(item?.isPaid).toBe(false)
    })

    it('a general advance then pays the remainder like any other debt', async () => {
      const patientId = await newPatient()
      const budget = await newBudget(patientId, ['30000.00'])
      await postAdvance(patientId, 22500, budget.id)
      await postAdvance(patientId, 2000)
      await executeItems(patientId, [budget.items[0].id])

      const s = await statement(patientId)
      expect(s.appointmentsDebt).toBe(5500)
      expect(s.advancesCredit).toBe(0)
    })
  })

  // ---- Guard 5: rule 1 (excess) --------------------------------------------

  describe('rule 1: what is left on a reservation', () => {
    it('on a COMPLETED budget the 3000 left is ordinary credit', async () => {
      const patientId = await newPatient()
      const budget = await newBudget(patientId, ['19500.00'])
      await postAdvance(patientId, 22500, budget.id)

      await executeItems(patientId, [budget.items[0].id])
      expect((await prisma.budget.findUnique({ where: { id: budget.id } }))?.status).toBe('COMPLETED')

      const s = await statement(patientId)
      expect(s.advancesCredit).toBe(3000)
      expect(s.appointmentsDebt).toBe(0)
      expect(s.reservedAdvances).toEqual([
        { budgetId: budget.id, reserved: 22500, consumed: 19500, remaining: 3000, open: false },
      ])
    })

    it('the same 3000 left on an OPEN budget is held: in remaining, not in advancesCredit', async () => {
      const patientId = await newPatient()
      const budget = await newBudget(patientId, ['19500.00', '4000.00'])
      await postAdvance(patientId, 22500, budget.id)

      await executeItems(patientId, [budget.items[0].id])
      expect((await prisma.budget.findUnique({ where: { id: budget.id } }))?.status).toBe('PARTIAL')

      const s = await statement(patientId)
      expect(s.advancesCredit).toBe(0)
      expect(s.reservedAdvances).toEqual([
        { budgetId: budget.id, reserved: 22500, consumed: 19500, remaining: 3000, open: true },
      ])
    })

    it('released credit pays another budget\'s work', async () => {
      const patientId = await newPatient()
      const done = await newBudget(patientId, ['19500.00'])
      const other = await newBudget(patientId, ['2000.00'])
      await postAdvance(patientId, 22500, done.id)
      await executeItems(patientId, [done.items[0].id, other.items[0].id])

      const s = await statement(patientId)
      expect(s.appointmentsDebt).toBe(0)
      expect(s.advancesCredit).toBe(1000)
    })

    it('a budget cancelled after the advance was taken releases it too', async () => {
      const patientId = await newPatient()
      const budget = await newBudget(patientId, ['100.00'])
      await postAdvance(patientId, 700, budget.id)
      await prisma.budget.update({ where: { id: budget.id }, data: { status: 'CANCELLED' } })

      const s = await statement(patientId)
      expect(s.advancesCredit).toBe(700)
      expect(s.reservedAdvances).toEqual([
        { budgetId: budget.id, reserved: 700, consumed: 0, remaining: 700, open: false },
      ])
    })

    it('a reversed reserved advance stops being held: the row stays, the reservation goes', async () => {
      const patientId = await newPatient()
      const budget = await newBudget(patientId, ['100.00', '100.00'])
      const created = await postAdvance(patientId, 700, budget.id)
      expect(created.status).toBe(201)

      const reversed = await api()
        .delete(`/api/patients/${patientId}/payments/${created.body.data.id}`)
        .set(auth())
        .send({ reason: 'entered by mistake' })
      expect(reversed.status).toBe(200)

      const s = await statement(patientId)
      expect(s.totalPaid).toBe(0)
      expect(s.advancesCredit).toBe(0)
      expect('reservedAdvances' in s).toBe(false)
      expect(await paymentRows(patientId)).toBe(1)
      expect(await prisma.patientPayment.count({ where: { patientId, isActive: true } })).toBe(0)
    })

    it('deleting the budget unreserves the advance (SetNull) and the statement returns to the plain shape', async () => {
      const patientId = await newPatient()
      const budget = await newBudget(patientId, ['100.00'])
      await postAdvance(patientId, 700, budget.id)
      await prisma.budget.delete({ where: { id: budget.id } })

      const row = await prisma.patientPayment.findFirst({ where: { patientId } })
      expect(row?.budgetId).toBeNull()
      const s = await statement(patientId)
      expect(s.advancesCredit).toBe(700)
      expect('reservedAdvances' in s).toBe(false)
      expect(await paymentRows(patientId)).toBe(1)
    })
  })

  // ---- Float sensitivity ----------------------------------------------------

  describe('float sensitivity: amounts binary floating point cannot hold', () => {
    it('reports exact cents for 20.10 reserved against 0.07 + 0.29 + 1.15 + 8.20 executed', async () => {
      const patientId = await newPatient()
      const budget = await newBudget(patientId, ['0.07', '0.29', '1.15', '8.20', '5.00'])
      expect((await postAdvance(patientId, 20.1, budget.id)).status).toBe(201)
      expect((await postAdvance(patientId, 0.1)).status).toBe(201)
      expect((await postAdvance(patientId, 0.2)).status).toBe(201)

      await executeItems(patientId, budget.items.slice(0, 4).map((i) => i.id))

      const stored = await prisma.patientPayment.findMany({ where: { patientId }, orderBy: { amount: 'desc' } })
      expect(stored.map((p) => p.amount.toString())).toEqual(['20.1', '0.2', '0.1'])

      const s = await statement(patientId)
      expect(s.reservedAdvances).toEqual([
        { budgetId: budget.id, reserved: 20.1, consumed: 9.71, remaining: 10.39, open: true },
      ])
      expect(s.totalBilled).toBe(9.71)
      expect(s.totalPaid).toBe(20.4)
      expect(s.advancesCredit).toBe(0.3)
      expect(s.appointmentsDebt).toBe(0)
      expect(await paymentRows(patientId)).toBe(3)
    })
  })

  describe('float sensitivity (subtraction): 15.00 - 9.71 is 5.289999999999999 in binary floating point', () => {
    it('reports remaining 5.29 exactly', async () => {
      const patientId = await newPatient()
      const budget = await newBudget(patientId, ['0.07', '0.29', '1.15', '8.20', '5.00'])
      expect((await postAdvance(patientId, 15, budget.id)).status).toBe(201)
      await executeItems(patientId, budget.items.slice(0, 4).map((i) => i.id))

      expect(15 - 9.71).not.toBe(5.29) // the fixture really is float-sensitive
      const s = await statement(patientId)
      expect(s.reservedAdvances).toEqual([
        { budgetId: budget.id, reserved: 15, consumed: 9.71, remaining: 5.29, open: true },
      ])
      expect(s.advancesCredit).toBe(0)
    })
  })

  // ---- Guard 6: validation --------------------------------------------------

  describe('validation of the budgetId', () => {
    it('route: another patient\'s budget -> 404 and no row is written', async () => {
      const patientId = await newPatient()
      const otherPatient = await newPatient()
      const foreign = await newBudget(otherPatient, ['100.00'])

      const res = await postAdvance(patientId, 100, foreign.id)
      expect(res.status).toBe(404)
      expect(res.body.success).toBe(false)
      expect(await paymentRows(patientId)).toBe(0)
    })

    it('route: another tenant\'s budget -> 404 and no row is written', async () => {
      const patientId = await newPatient()
      const foreignPatient = await newPatient(otherTenantId)
      const foreign = await newBudget(foreignPatient, ['100.00'], 'APPROVED', otherTenantId)

      const res = await postAdvance(patientId, 100, foreign.id)
      expect(res.status).toBe(404)
      expect(await paymentRows(patientId)).toBe(0)
    })

    it('route: a nonexistent budget -> 404', async () => {
      const patientId = await newPatient()
      const res = await postAdvance(patientId, 100, 'does-not-exist')
      expect(res.status).toBe(404)
      expect(await paymentRows(patientId)).toBe(0)
    })

    it('route: an inactive budget -> 404', async () => {
      const patientId = await newPatient()
      const budget = await newBudget(patientId, ['100.00'])
      await prisma.budget.update({ where: { id: budget.id }, data: { isActive: false } })
      const res = await postAdvance(patientId, 100, budget.id)
      expect(res.status).toBe(404)
    })

    it('route: a COMPLETED budget -> 400 and a CANCELLED budget -> 400', async () => {
      const patientId = await newPatient()
      const completed = await newBudget(patientId, ['100.00'], 'COMPLETED')
      const cancelled = await newBudget(patientId, ['100.00'], 'CANCELLED')

      const a = await postAdvance(patientId, 100, completed.id)
      const b = await postAdvance(patientId, 100, cancelled.id)
      expect(a.status).toBe(400)
      expect(b.status).toBe(400)
      expect(await paymentRows(patientId)).toBe(0)
    })

    it('route: DRAFT, APPROVED and PARTIAL budgets accept a reservation', async () => {
      const patientId = await newPatient()
      for (const status of ['DRAFT', 'APPROVED', 'PARTIAL'] as const) {
        const budget = await prisma.budget.create({ data: { tenantId, patientId, status } })
        const res = await postAdvance(patientId, 10, budget.id)
        expect(res.status, status).toBe(201)
        expect(res.body.data.budgetId).toBe(budget.id)
      }
      expect(await paymentRows(patientId)).toBe(3)
    })

    it('route: an empty budgetId string is rejected by the schema (400), not stored as null', async () => {
      const patientId = await newPatient()
      const res = await api()
        .post(`/api/patients/${patientId}/payments`)
        .set(auth())
        .send({ amount: 10, date: new Date().toISOString(), budgetId: '' })
      expect(res.status).toBe(400)
      expect(await paymentRows(patientId)).toBe(0)
    })

    it('service: createPayment returns the matching codes', async () => {
      const patientId = await newPatient()
      const otherPatient = await newPatient()
      const foreignPatient = await newPatient(otherTenantId)
      const own = await newBudget(patientId, ['100.00'])
      const ofOtherPatient = await newBudget(otherPatient, ['100.00'])
      const ofOtherTenant = await newBudget(foreignPatient, ['100.00'], 'APPROVED', otherTenantId)
      const completed = await newBudget(patientId, ['100.00'], 'COMPLETED')
      const input = { amount: 50, date: new Date() }

      expect(await createPayment(tenantId, patientId, { ...input, budgetId: ofOtherPatient.id })).toEqual({
        success: false,
        code: 'BUDGET_NOT_FOUND',
      })
      expect(await createPayment(tenantId, patientId, { ...input, budgetId: ofOtherTenant.id })).toEqual({
        success: false,
        code: 'BUDGET_NOT_FOUND',
      })
      expect(await createPayment(tenantId, patientId, { ...input, budgetId: completed.id })).toEqual({
        success: false,
        code: 'BUDGET_NOT_OPEN',
      })
      expect(await paymentRows(patientId)).toBe(0)

      const ok = await createPayment(tenantId, patientId, { ...input, budgetId: own.id })
      expect(ok.success).toBe(true)
      if (ok.success) expect(ok.data.budgetId).toBe(own.id)
      expect(await paymentRows(patientId)).toBe(1)
    })

    it('a payment without budgetId stores null and keeps the pre-#529 behaviour', async () => {
      const patientId = await newPatient()
      const res = await postAdvance(patientId, 10)
      expect(res.status).toBe(201)
      expect(res.body.data.budgetId).toBeNull()
    })
  })
})
