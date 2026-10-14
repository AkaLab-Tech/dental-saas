/**
 * Task #562: a reserved advance must be invisible to NO reader.
 *
 * Before this change there were four readers of the outstanding figure and
 * only one of them (the account statement, via its `heldCents`) held a
 * reserved advance back. The other three — getPatientBalance, the debtors
 * column (computeOutstandingByPatient) and the dashboard total
 * (getTenantOutstandingTotal, which sums the debtors column) — let reserved
 * money pay down unrelated debt, under-reporting what the clinic is owed.
 *
 * Three readers drifted from the fourth because every existing test asserted
 * ONE reader at a time. So the central guard here asserts all four figures
 * from a single fixture, in one test: a divergence cannot hide.
 *
 * No real patient data: synthetic names, ids, figures and states only.
 */
import { describe, it, expect, afterAll, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { api } from '../test/http.js'
import { prisma } from '@dental/database'
import { hashPassword } from '../services/auth.service.js'
import { generateToken } from '../test/tokens.js'
import {
  computeFifoAllocation,
  computeHeldCents,
  computeHeldFromCharges,
  computeReservationUsage,
  createPayment,
  getPatientAccountStatement,
  getPatientBalance,
  getTenantOutstandingTotal,
  listDebtors,
  type BillableItem,
  type BudgetReservations,
} from '../services/payment.service.js'

// ---------------------------------------------------------------------------
// Pure: the extracted rule
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

describe('Task #562 pure: computeHeldCents', () => {
  it('holds what an open budget has not consumed yet', () => {
    expect(computeHeldCents([{ reservedCents: 50000, consumedCents: 10000, open: true }])).toBe(40000)
  })

  it('a closed budget holds nothing: its leftover is ordinary credit (release rule 1)', () => {
    expect(computeHeldCents([{ reservedCents: 50000, consumedCents: 10000, open: false }])).toBe(0)
  })

  it('never goes negative when the charges outgrow the reservation (overflow rule 2)', () => {
    expect(computeHeldCents([{ reservedCents: 10000, consumedCents: 30000, open: true }])).toBe(0)
  })

  it('sums several budgets and counts only the open ones', () => {
    expect(
      computeHeldCents([
        { reservedCents: 30000, consumedCents: 10000, open: true }, // 20000
        { reservedCents: 15000, consumedCents: 0, open: false }, // released
        { reservedCents: 500, consumedCents: 500, open: true }, // fully consumed
        { reservedCents: 7, consumedCents: 0, open: true }, // 7
      ])
    ).toBe(20007)
  })

  it('holds nothing for an empty set', () => {
    expect(computeHeldCents([])).toBe(0)
  })
})

describe('Task #562 pure: computeHeldFromCharges', () => {
  it('a budget with no charge yet holds its whole reservation', () => {
    expect(computeHeldFromCharges(reservations({ b1: { amount: 500, open: true } }), new Map())).toBe(50000)
  })

  it('subtracts the charges its budget carries, in exact cents', () => {
    expect(
      computeHeldFromCharges(reservations({ b1: { amount: 20.1, open: true } }), new Map([['b1', 971]]))
    ).toBe(1039)
  })

  it('a charge larger than the reservation consumes it whole and no more', () => {
    expect(
      computeHeldFromCharges(reservations({ b1: { amount: 100, open: true } }), new Map([['b1', 30000]]))
    ).toBe(0)
  })

  it('ignores charges of a budget that holds no reservation', () => {
    expect(
      computeHeldFromCharges(
        reservations({ b1: { amount: 100, open: true } }),
        new Map([
          ['b1', 2500],
          ['other', 999999],
        ])
      )
    ).toBe(7500)
  })

  it('a closed budget holds nothing however much is left', () => {
    expect(
      computeHeldFromCharges(reservations({ b1: { amount: 500, open: false } }), new Map([['b1', 10000]]))
    ).toBe(0)
  })

  it('reaches the same figure as the item walk the statement uses', () => {
    // Two budgets, charges of different sizes: the aggregate entry point and
    // computeReservationUsage's per-item walk must agree, because the
    // statement and the aggregate readers are compared against each other.
    const items = [charge('i1', 100, 0, 'b1'), charge('i2', 200, 1, 'b2'), charge('i3', 50, 2, 'b1')]
    const res = reservations({ b1: { amount: 300, open: true }, b2: { amount: 150, open: true } })
    const fromWalk = computeHeldCents(computeReservationUsage(items, res).budgets.values())
    const fromCharges = computeHeldFromCharges(
      res,
      new Map([
        ['b1', 15000],
        ['b2', 20000],
      ])
    )
    expect(fromWalk).toBe(15000)
    expect(fromCharges).toBe(fromWalk)
  })
})

// ---------------------------------------------------------------------------
// Guard 4a: the release into the pool and heldCents are the SAME rule
// ---------------------------------------------------------------------------

/**
 * `open` is read in three independent places now: the release into the general
 * pool inside computeFifoAllocation, the statement's heldCents, and the
 * aggregate readers via computeHeldFromCharges. Historically only ONE test
 * ("released credit pays another budget's work") would have noticed the first
 * two drifting apart.
 *
 * This pins the identity between them directly:
 *
 *     initial pool = max(0, totalPaid - heldCents - consumedByReservations)
 *
 * which is algebraically what computeFifoAllocation's
 * `totalPaid - reservedCents + releasedCents` is. It is observed, not assumed:
 * the oldest item is an unrelated charge whose cost exceeds any pool in the
 * table, so the whole pool lands on it and `paidAmount` IS the pool.
 */
describe('Task #562: computeFifoAllocation releases into the pool exactly what heldCents does not hold', () => {
  const worlds: Array<{
    name: string
    budgetCharges: Array<[id: string, cost: number, budgetId: string]>
    totalPaid: number
    res: BudgetReservations
    expectedHeldCents: number
    expectedPool: number
  }> = [
    {
      name: 'open budget, partly consumed: the rest stays held',
      budgetCharges: [['i1', 100, 'b1']],
      totalPaid: 500,
      res: reservations({ b1: { amount: 500, open: true } }),
      expectedHeldCents: 40000,
      expectedPool: 0,
    },
    {
      name: 'the same budget closed: the leftover rejoins the pool',
      budgetCharges: [['i1', 100, 'b1']],
      totalPaid: 500,
      res: reservations({ b1: { amount: 500, open: false } }),
      expectedHeldCents: 0,
      expectedPool: 400,
    },
    {
      name: 'overflow: the reservation is consumed whole, nothing held, nothing released',
      budgetCharges: [['i1', 300, 'b1']],
      totalPaid: 100,
      res: reservations({ b1: { amount: 100, open: true } }),
      expectedHeldCents: 0,
      expectedPool: 0,
    },
    {
      name: 'two budgets, one open one closed',
      budgetCharges: [
        ['i1', 100, 'b1'],
        ['i2', 200, 'b2'],
      ],
      totalPaid: 1000,
      res: reservations({ b1: { amount: 300, open: true }, b2: { amount: 150, open: false } }),
      expectedHeldCents: 20000,
      expectedPool: 550,
    },
    {
      name: 'no reservation at all: the pool is the whole payment',
      budgetCharges: [['i1', 100, 'b1']],
      totalPaid: 1000,
      res: new Map(),
      expectedHeldCents: 0,
      expectedPool: 1000,
    },
    {
      name: 'a reservation larger than the payments: the pool clamps at 0, never negative',
      budgetCharges: [],
      totalPaid: 10,
      res: reservations({ b1: { amount: 500, open: true } }),
      expectedHeldCents: 50000,
      expectedPool: 0,
    },
  ]

  for (const world of worlds) {
    it(world.name, () => {
      // The oldest item absorbs the whole pool: 99999 > any pool in the table.
      const items = [
        charge('unrelated', 99999, 0, undefined, 'appointment'),
        ...world.budgetCharges.map(([id, cost, budgetId], i) => charge(id, cost, i + 1, budgetId)),
      ]
      const usage = computeReservationUsage(items, world.res)
      const heldCents = computeHeldCents(usage.budgets.values())
      const consumedCents = [...usage.budgets.values()].reduce((s, b) => s + b.consumedCents, 0)

      expect(heldCents).toBe(world.expectedHeldCents)

      const allocation = computeFifoAllocation(items, world.totalPaid, undefined, world.res)
      // The pool the walk actually handed out ...
      expect(allocation[0].paidAmount).toBe(world.expectedPool)
      // ... is exactly what heldCents and the consumed reservations leave over.
      expect(allocation[0].paidAmount * 100).toBe(
        Math.max(0, Math.round(world.totalPaid * 100) - heldCents - consumedCents)
      )
    })
  }
})

// ---------------------------------------------------------------------------
// Integration: real routes and real rows, one tenant per fixture
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

const tenantIds: string[] = []
let worldSeq = 0

/**
 * A tenant of its own per fixture. getTenantOutstandingTotal is tenant-wide,
 * so sharing a tenant between tests would make that figure depend on every
 * other fixture in the file.
 */
async function createWorld() {
  const stamp = `${Date.now()}-${worldSeq++}`
  const tenant = await prisma.tenant.create({
    data: { name: `Aggregates Clinic ${stamp}`, slug: `agg-562-${stamp}` },
  })
  tenantIds.push(tenant.id)
  const admin = await prisma.user.create({
    data: {
      email: `admin-agg-562-${stamp}@test.com`,
      passwordHash: await hashPassword('AdminPass123!'),
      firstName: 'Admin',
      lastName: 'Fixture',
      role: 'ADMIN',
      tenantId: tenant.id,
    },
  })
  const doctor = await prisma.doctor.create({
    data: {
      tenantId: tenant.id,
      firstName: 'Doctor',
      lastName: 'Fixture',
      email: `doctor-agg-562-${stamp}@test.com`,
      specialty: 'General Dentistry',
    },
  })
  const tenantId = tenant.id
  const token = generateToken(admin.id, tenantId, 'ADMIN')
  const auth = () => ({ Authorization: `Bearer ${token}` })
  let dayOffset = 1
  let patientSeq = 0

  async function newPatient(lastName = 'Aggregate') {
    const p = await prisma.patient.create({
      data: {
        tenantId,
        firstName: 'Fixture',
        lastName: lastName,
        email: `p-agg-562-${stamp}-${patientSeq++}@test.com`,
      },
    })
    return p.id
  }

  /** A costed appointment in the past: the patient's unrelated debt. */
  async function pastAppointment(patientId: string, cost: string, daysAgo: number) {
    const start = new Date()
    start.setDate(start.getDate() - daysAgo)
    start.setHours(10, 0, 0, 0)
    const a = await prisma.appointment.create({
      data: {
        tenantId,
        patientId,
        doctorId: doctor.id,
        startTime: start,
        endTime: new Date(start.getTime() + 30 * 60 * 1000),
        cost,
        status: 'COMPLETED',
      },
    })
    return a.id
  }

  /** APPROVED (or `status`) budget with one PENDING item per price string (exact Decimal). */
  async function newBudget(
    patientId: string,
    prices: string[],
    status: 'DRAFT' | 'APPROVED' | 'COMPLETED' | 'CANCELLED' = 'APPROVED'
  ) {
    return prisma.budget.create({
      data: {
        tenantId,
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

  /** The path a user takes: schedule the items, then confirm them at mark-done. */
  async function executeItems(patientId: string, itemIds: string[]) {
    const start = new Date()
    start.setDate(start.getDate() + dayOffset++)
    start.setHours(10, 0, 0, 0)
    const created = await api()
      .post('/api/appointments')
      .set(auth())
      .send({
        patientId,
        doctorId: doctor.id,
        startTime: start.toISOString(),
        endTime: new Date(start.getTime() + 30 * 60 * 1000).toISOString(),
        budgetItemIds: itemIds,
      })
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

  async function balanceRoute(patientId: string) {
    const res = await api().get(`/api/patients/${patientId}/balance`).set(auth())
    expect(res.status).toBe(200)
    return res.body.data as { totalDebt: number; totalPaid: number; outstanding: number; credit: number }
  }

  async function debtsRoute() {
    const res = await api().get('/api/patients/debts').set(auth())
    expect(res.status).toBe(200)
    return res.body.data as Array<{
      patientId: string
      name: string
      totalDebt: number
      totalPaid: number
      outstanding: number
    }>
  }

  async function appointmentRows(patientId: string) {
    const res = await api().get(`/api/appointments/by-patient/${patientId}`).set(auth())
    expect(res.status).toBe(200)
    return new Map(
      (
        res.body.data as Array<{
          id: string
          paidAmount: number
          outstanding: number
          isPaid: boolean
        }>
      ).map((a) => [a.id, { paidAmount: a.paidAmount, outstanding: a.outstanding, isPaid: a.isPaid }])
    )
  }

  return {
    tenantId,
    doctorId: doctor.id,
    auth,
    newPatient,
    pastAppointment,
    newBudget,
    executeItems,
    postAdvance,
    statement,
    balanceRoute,
    debtsRoute,
    appointmentRows,
  }
}

type World = Awaited<ReturnType<typeof createWorld>>

/**
 * The canonical fixture of task #562, built through the real routes:
 *
 *   - one past appointment costing 300 (debt unrelated to any budget);
 *   - one budget of two items, the 100 one EXECUTED (so the budget stays
 *     open — a budget whose every item is executed auto-COMPLETEs and would
 *     release the reservation, which is the other scenario below);
 *   - one advance of 500 reserved to that budget.
 *
 * debt 400, paid 500, held 400 (500 reserved - 100 consumed) -> 100 available
 * -> outstanding 300. Before #562 the three aggregate readers said 0.
 */
async function canonicalFixture(world: World) {
  const patientId = await world.newPatient('Canonical')
  const appointmentId = await world.pastAppointment(patientId, '300.00', 10)
  const budget = await world.newBudget(patientId, ['100.00', '900.00'])
  expect((await world.postAdvance(patientId, 500, budget.id)).status).toBe(201)
  await world.executeItems(patientId, [budget.items[0].id])
  expect((await prisma.budget.findUnique({ where: { id: budget.id } }))?.status).toBe('PARTIAL')
  return { patientId, appointmentId, budget }
}

describe('Task #562 (real routes): a reserved advance is held back by every reader', () => {
  afterAll(async () => {
    for (const id of tenantIds) {
      await prisma.patientPaymentEvent.deleteMany({ where: { payment: { tenantId: id } } })
      await prisma.patientPayment.deleteMany({ where: { tenantId: id } })
      await prisma.budgetItemAppointment.deleteMany({ where: { appointment: { tenantId: id } } })
      await prisma.budget.deleteMany({ where: { tenantId: id } })
      await prisma.appointment.deleteMany({ where: { tenantId: id } })
      await prisma.patient.deleteMany({ where: { tenantId: id } })
      await prisma.doctor.deleteMany({ where: { tenantId: id } })
      await prisma.refreshToken.deleteMany({ where: { user: { tenantId: id } } })
      await prisma.user.deleteMany({ where: { tenantId: id } })
      await prisma.tenant.delete({ where: { id } }).catch(() => {})
    }
  })

  // ---- Guard 1: the four readers agree -----------------------------------

  it('GUARD 1: all four readers of the outstanding figure say 300 on the canonical fixture', async () => {
    const world = await createWorld()
    const { patientId } = await canonicalFixture(world)

    //   1. getPatientBalance        (GET /api/patients/:id/balance)
    //   2. the debtors column        (GET /api/patients/debts -> listDebtors)
    //   3. the dashboard total       (stats.service.ts:214)
    //   4. the account statement     (right since #529)
    const balance = await getPatientBalance(world.tenantId, patientId)
    const debtors = await listDebtors(world.tenantId)
    const stmt = await getPatientAccountStatement(world.tenantId, patientId)
    if (!balance.success || !stmt.success) throw new Error('fixture')
    // Absent from the debtors list reads as 0 here, NOT as a failed length
    // assertion up front: when the shared path breaks, the debtors figure and
    // the dashboard total must BOTH show up in the labelled diff below, side
    // by side. Membership is asserted after the figures.
    const debtor = debtors.find((d) => d.patientId === patientId)

    // All four in ONE assertion, labelled, so a reader that drifts names
    // itself in the diff instead of hiding behind the three that still hold.
    // The tenant holds this one patient, so the dashboard total IS their
    // outstanding — the documented equality between that total and the
    // debtors column (see getTenantOutstandingTotal).
    expect({
      getPatientBalance: balance.data.outstanding,
      listDebtors: debtor?.outstanding ?? 0,
      getTenantOutstandingTotal: await getTenantOutstandingTotal(world.tenantId),
      accountStatement: stmt.data.appointmentsDebt,
      // The statement's appointmentsDebt comes off the FIFO allocation, NOT
      // off its heldCents path; advancesCredit is the figure heldCents moves
      // (paid - allocated - held). Without it this object is blind to the
      // statement's own held-back rule (seen: heldCents = 0 left the four
      // figures above green). 400 are held, so no ordinary credit exists on
      // either reader that reports one.
      accountStatementAdvancesCredit: stmt.data.advancesCredit,
      getPatientBalanceCredit: balance.data.credit,
    }).toEqual({
      getPatientBalance: 300,
      listDebtors: 300,
      getTenantOutstandingTotal: 300,
      accountStatement: 300,
      accountStatementAdvancesCredit: 0,
      getPatientBalanceCredit: 0,
    })

    expect(debtors).toHaveLength(1)
    expect(debtor?.patientId).toBe(patientId)

    // And the same figures through the HTTP routes the screens actually call.
    expect(await world.balanceRoute(patientId)).toEqual({
      totalDebt: 400,
      totalPaid: 500,
      outstanding: 300,
      credit: 0,
    })
    const rows = await world.debtsRoute()
    expect(rows.map((r) => [r.totalDebt, r.totalPaid, r.outstanding])).toEqual([[400, 500, 300]])
  })

  it('the canonical fixture holds exactly what the statement reports as held', async () => {
    const world = await createWorld()
    const { patientId, budget } = await canonicalFixture(world)
    const stmt = await world.statement(patientId)
    expect(stmt.reservedAdvances).toEqual([
      { budgetId: budget.id, reserved: 500, consumed: 100, remaining: 400, open: true },
    ])
    // The 400 still held is not credit, and the 300 of unrelated debt is unpaid.
    expect(stmt.advancesCredit).toBe(0)
    expect(stmt.appointmentsDebt).toBe(300)
    expect(stmt.totalBilled).toBe(400)
    expect(stmt.totalPaid).toBe(500)
  })

  // ---- The totalPaid pin (a decision, not a defect) -----------------------

  it('PIN (intended): totalPaid stays GROSS, so totalDebt - totalPaid !== outstanding', async () => {
    const world = await createWorld()
    const { patientId } = await canonicalFixture(world)

    // DELIBERATE, do not "fix": `totalPaid` is the money received, and only
    // `outstanding`/`credit` net out what the open reservation holds. The
    // account statement has reported totalPaid gross since #529, and the two
    // must agree. The arithmetic below therefore does NOT close, by design:
    //   400 (debt) - 500 (paid) != 300 (outstanding)
    const balance = await getPatientBalance(world.tenantId, patientId)
    if (!balance.success) throw new Error('fixture')
    expect(balance.data).toEqual({ totalDebt: 400, totalPaid: 500, outstanding: 300, credit: 0 })
    expect(balance.data.totalDebt - balance.data.totalPaid).toBe(-100)
    expect(balance.data.outstanding).not.toBe(
      Math.max(0, balance.data.totalDebt - balance.data.totalPaid)
    )

    const debtor = (await listDebtors(world.tenantId))[0]
    expect([debtor.totalDebt, debtor.totalPaid, debtor.outstanding]).toEqual([400, 500, 300])
    expect((await world.statement(patientId)).totalPaid).toBe(500)
  })

  it('GUARD 1 (tenant-wide): sum of each debtor\'s outstanding == the dashboard total, flooring per patient', async () => {
    const world = await createWorld()
    // A: reserved advance, owes 300 (the canonical fixture).
    const a = await canonicalFixture(world)
    // B: ordinary credit — debt 100, paid 250: raw -150, floored to 0 per patient.
    const b = await world.newPatient('Credit')
    await world.pastAppointment(b, '100.00', 10)
    expect((await world.postAdvance(b, 250)).status).toBe(201)
    // C: ordinary part-payment — debt 200, paid 50, owes 150.
    const c = await world.newPatient('Partial')
    await world.pastAppointment(c, '200.00', 10)
    expect((await world.postAdvance(c, 50)).status).toBe(201)

    const debtors = await listDebtors(world.tenantId)
    const byPatient = new Map(debtors.map((d) => [d.patientId, d.outstanding]))
    // B is in credit, so B is not a debtor at all and contributes exactly 0.
    expect(byPatient.get(a.patientId)).toBe(300)
    expect(byPatient.has(b)).toBe(false)
    expect(byPatient.get(c)).toBe(150)

    // The documented equality: the per-patient values are ALREADY floored, so
    // their sum is the dashboard total (300 + 150), not debt - paid over the
    // tenant (which would be 300 - 150 + 150 = 300 if B's credit offset A).
    const total = await getTenantOutstandingTotal(world.tenantId)
    expect(debtors.reduce((sum, d) => sum + d.outstanding, 0)).toBe(450)
    expect(total).toBe(450)

    // Each patient's own record figure agrees with their debtors row.
    for (const [patientId, expected] of [
      [a.patientId, 300],
      [b, 0],
      [c, 150],
    ] as const) {
      const balance = await getPatientBalance(world.tenantId, patientId)
      if (!balance.success) throw new Error('fixture')
      expect(balance.data.outstanding).toBe(expected)
    }
  })

  // ---- Guard 2: an unreserved advance allocates exactly as before ---------

  /**
   * The product lead's decision of 2026-10-02 — oldest first, one package, no
   * skipping a cheaper later charge — must not shift by a cent. A total alone
   * would not see it: 300 handed out as 300/0 and as 200/100 both total 300.
   * So the per-appointment amounts are pinned, not just the sums.
   */
  it('GUARD 2: an unreserved advance is allocated oldest-first in one package, unchanged', async () => {
    const world = await createWorld()
    const patientId = await world.newPatient('Unreserved')
    const older = await world.pastAppointment(patientId, '400.00', 20)
    const newer = await world.pastAppointment(patientId, '100.00', 10)
    expect((await world.postAdvance(patientId, 300)).status).toBe(201)

    // The allocation itself: the older charge takes the whole 300 and the
    // cheaper newer one is NOT skipped-to and paid off.
    const rows = await world.appointmentRows(patientId)
    expect(rows.get(older)).toEqual({ paidAmount: 300, outstanding: 100, isPaid: false })
    expect(rows.get(newer)).toEqual({ paidAmount: 0, outstanding: 100, isPaid: false })

    // All four readers, unmoved by #562 (no reservation exists to hold).
    const balance = await getPatientBalance(world.tenantId, patientId)
    if (!balance.success) throw new Error('fixture')
    expect(balance.data).toEqual({ totalDebt: 500, totalPaid: 300, outstanding: 200, credit: 0 })
    expect((await listDebtors(world.tenantId)).map((r) => r.outstanding)).toEqual([200])
    expect(await getTenantOutstandingTotal(world.tenantId)).toBe(200)
    const stmt = await world.statement(patientId)
    expect(stmt.appointmentsDebt).toBe(200)
    expect(stmt.advancesCredit).toBe(0)
    // Byte-identical to a pre-#529 response: the key is absent, not empty.
    expect('reservedAdvances' in stmt).toBe(false)

    // An unreserved overpayment is still ordinary credit everywhere.
    expect((await world.postAdvance(patientId, 700)).status).toBe(201)
    const after = await getPatientBalance(world.tenantId, patientId)
    if (!after.success) throw new Error('fixture')
    expect(after.data).toEqual({ totalDebt: 500, totalPaid: 1000, outstanding: 0, credit: 500 })
    expect(await getTenantOutstandingTotal(world.tenantId)).toBe(0)
    expect(await world.debtsRoute()).toEqual([])
  })

  it('GUARD 2 (sensitivity): the identical fixture with the advance reserved moves, and only there', async () => {
    const world = await createWorld()
    const patientId = await world.newPatient('Reserved')
    const older = await world.pastAppointment(patientId, '400.00', 20)
    const newer = await world.pastAppointment(patientId, '100.00', 10)
    const budget = await world.newBudget(patientId, ['900.00', '800.00'])
    expect((await world.postAdvance(patientId, 300, budget.id)).status).toBe(201)

    // The reserved 300 pays neither appointment: the pool is empty.
    const rows = await world.appointmentRows(patientId)
    expect(rows.get(older)).toEqual({ paidAmount: 0, outstanding: 400, isPaid: false })
    expect(rows.get(newer)).toEqual({ paidAmount: 0, outstanding: 100, isPaid: false })

    const balance = await getPatientBalance(world.tenantId, patientId)
    if (!balance.success) throw new Error('fixture')
    expect(balance.data).toEqual({ totalDebt: 500, totalPaid: 300, outstanding: 500, credit: 0 })
    expect((await listDebtors(world.tenantId)).map((r) => r.outstanding)).toEqual([500])
    expect(await getTenantOutstandingTotal(world.tenantId)).toBe(500)
    expect((await world.statement(patientId)).appointmentsDebt).toBe(500)
  })

  // ---- Guard 4b: the aggregate readers' `open` handling -------------------

  it('GUARD 4 (release): a COMPLETED budget holds nothing — 0 outstanding and 100 of credit everywhere', async () => {
    const world = await createWorld()
    const patientId = await world.newPatient('Released')
    await world.pastAppointment(patientId, '300.00', 10)
    const budget = await world.newBudget(patientId, ['100.00'])
    expect((await world.postAdvance(patientId, 500, budget.id)).status).toBe(201)
    // Its only item executed, so the budget auto-COMPLETEs: release rule 1.
    await world.executeItems(patientId, [budget.items[0].id])
    expect((await prisma.budget.findUnique({ where: { id: budget.id } }))?.status).toBe('COMPLETED')

    const balance = await getPatientBalance(world.tenantId, patientId)
    if (!balance.success) throw new Error('fixture')
    expect(balance.data).toEqual({ totalDebt: 400, totalPaid: 500, outstanding: 0, credit: 100 })
    expect(await world.debtsRoute()).toEqual([])
    expect(await getTenantOutstandingTotal(world.tenantId)).toBe(0)
    const stmt = await world.statement(patientId)
    expect(stmt.appointmentsDebt).toBe(0)
    expect(stmt.advancesCredit).toBe(100)
    expect(stmt.reservedAdvances).toEqual([
      { budgetId: budget.id, reserved: 500, consumed: 100, remaining: 400, open: false },
    ])
  })

  it('GUARD 4 (release, leftover absorbed): the released 400 pays other debt, and 50 stays owed on all four readers', async () => {
    // The sibling above has a leftover (400) larger than the other debt (300),
    // so a release that over- or under-counted by up to 100 still leaves the
    // same advancesCredit read off the allocation. Here the other debt (450)
    // EXCEEDS the leftover, so every cent the release hands the pool lands on
    // an appointment and a drifting release shows up as a wrong appointmentsDebt.
    const world = await createWorld()
    const patientId = await world.newPatient('ReleasedAbsorbed')
    const appointmentId = await world.pastAppointment(patientId, '450.00', 10)
    const budget = await world.newBudget(patientId, ['100.00'])
    expect((await world.postAdvance(patientId, 500, budget.id)).status).toBe(201)
    await world.executeItems(patientId, [budget.items[0].id])
    expect((await prisma.budget.findUnique({ where: { id: budget.id } }))?.status).toBe('COMPLETED')

    const balance = await getPatientBalance(world.tenantId, patientId)
    if (!balance.success) throw new Error('fixture')
    const stmt = await world.statement(patientId)
    expect({
      getPatientBalance: balance.data.outstanding,
      listDebtors: (await listDebtors(world.tenantId)).map((r) => r.outstanding),
      getTenantOutstandingTotal: await getTenantOutstandingTotal(world.tenantId),
      accountStatement: stmt.appointmentsDebt,
      accountStatementAdvancesCredit: stmt.advancesCredit,
    }).toEqual({
      getPatientBalance: 50,
      listDebtors: [50],
      getTenantOutstandingTotal: 50,
      accountStatement: 50,
      accountStatementAdvancesCredit: 0,
    })
    // 400 released into the pool, all of it applied to the 450 appointment.
    expect((await world.appointmentRows(patientId)).get(appointmentId)).toEqual({
      paidAmount: 400,
      outstanding: 50,
      isPaid: false,
    })
  })

  it('GUARD 4 (overflow): a charge larger than the reservation leaves 500 owed everywhere', async () => {
    const world = await createWorld()
    const patientId = await world.newPatient('Overflow')
    await world.pastAppointment(patientId, '300.00', 10)
    const budget = await world.newBudget(patientId, ['300.00', '700.00'])
    expect((await world.postAdvance(patientId, 100, budget.id)).status).toBe(201)
    await world.executeItems(patientId, [budget.items[0].id])
    expect((await prisma.budget.findUnique({ where: { id: budget.id } }))?.status).toBe('PARTIAL')

    // debt 600, paid 100, the reservation fully consumed by its own 300 charge
    // -> nothing held -> 500 owed. Rule 2: the overflow is ordinary debt.
    const balance = await getPatientBalance(world.tenantId, patientId)
    if (!balance.success) throw new Error('fixture')
    expect(balance.data).toEqual({ totalDebt: 600, totalPaid: 100, outstanding: 500, credit: 0 })
    expect((await listDebtors(world.tenantId)).map((r) => r.outstanding)).toEqual([500])
    expect(await getTenantOutstandingTotal(world.tenantId)).toBe(500)
    expect((await world.statement(patientId)).appointmentsDebt).toBe(500)
    expect((await world.statement(patientId)).reservedAdvances).toEqual([
      { budgetId: budget.id, reserved: 100, consumed: 100, remaining: 0, open: true },
    ])
  })

  it('GUARD 4 (cross-patient): tenant-wide, a budget of ANOTHER patient holds nothing', async () => {
    const world = await createWorld()
    const holder = await world.newPatient('Holder')
    const neighbour = await world.newPatient('Neighbour')
    await world.pastAppointment(holder, '300.00', 10)
    const neighboursBudget = await world.newBudget(neighbour, ['100.00', '900.00'])

    // No route can write this row: createPayment rejects a budgetId that is
    // not the paying patient's own (BUDGET_NOT_FOUND, task #529). It is
    // written directly because the tenant-wide reader groups payments by
    // (patientId, budgetId) and CAN see another patient's budget — which is
    // why getBudgetReservationsByPatient re-tests the ownership.
    await prisma.patientPayment.create({
      data: {
        tenantId: world.tenantId,
        patientId: holder,
        amount: '500.00',
        date: new Date(),
        kind: 'ADVANCE',
        budgetId: neighboursBudget.id,
      },
    })

    // The holder's 500 is ordinary money: it holds nothing and pays their debt.
    const balance = await getPatientBalance(world.tenantId, holder)
    if (!balance.success) throw new Error('fixture')
    expect(balance.data).toEqual({ totalDebt: 300, totalPaid: 500, outstanding: 0, credit: 200 })
    const byPatient = await listDebtors(world.tenantId)
    expect(byPatient).toEqual([])
    expect(await getTenantOutstandingTotal(world.tenantId)).toBe(0)
    // And the neighbour, who holds the budget but paid nothing, owes nothing.
    const neighbourBalance = await getPatientBalance(world.tenantId, neighbour)
    if (!neighbourBalance.success) throw new Error('fixture')
    expect(neighbourBalance.data).toEqual({ totalDebt: 0, totalPaid: 0, outstanding: 0, credit: 0 })
  })

  // ---- Guard 3: a payment cannot be earmarked AND reserved ---------------

  it('GUARD 3: createPayment rejects a payment that is both earmarked and reserved, and writes no row', async () => {
    const world = await createWorld()
    const patientId = await world.newPatient('Conflict')
    const appointmentId = await world.pastAppointment(patientId, '300.00', 10)
    const budget = await world.newBudget(patientId, ['100.00', '900.00'])

    expect(
      await createPayment(world.tenantId, patientId, {
        amount: 500,
        date: new Date(),
        kind: 'APPOINTMENT',
        appointmentId,
        budgetId: budget.id,
      })
    ).toEqual({ success: false, code: 'BUDGET_RESERVATION_CONFLICT' })
    expect(await prisma.patientPayment.count({ where: { patientId } })).toBe(0)

    // The conflict is rejected before the budget is even looked at: an
    // invalid budgetId with an appointmentId is still the conflict, not a 404.
    expect(
      await createPayment(world.tenantId, patientId, {
        amount: 500,
        date: new Date(),
        appointmentId,
        budgetId: 'does-not-exist',
      })
    ).toEqual({ success: false, code: 'BUDGET_RESERVATION_CONFLICT' })
    expect(await prisma.patientPayment.count({ where: { patientId } })).toBe(0)

    // Either id ALONE still creates a row.
    const earmarked = await createPayment(world.tenantId, patientId, {
      amount: 120,
      date: new Date(),
      kind: 'APPOINTMENT',
      appointmentId,
    })
    expect(earmarked.success).toBe(true)
    if (earmarked.success) {
      expect(earmarked.data.appointmentId).toBe(appointmentId)
      expect(earmarked.data.budgetId).toBeNull()
    }
    const reserved = await createPayment(world.tenantId, patientId, {
      amount: 80,
      date: new Date(),
      budgetId: budget.id,
    })
    expect(reserved.success).toBe(true)
    if (reserved.success) {
      expect(reserved.data.budgetId).toBe(budget.id)
      expect(reserved.data.appointmentId).toBeNull()
    }

    // Exactly two rows: one rejected, two created. Not a toContain, a COUNT.
    expect(await prisma.patientPayment.count({ where: { patientId } })).toBe(2)
    expect(
      await prisma.patientPayment.count({
        where: { patientId, appointmentId: { not: null }, budgetId: { not: null } },
      })
    ).toBe(0)
  })

  it('GUARD 3 (route): POST payments cannot express the conflict — appointmentId is not in its schema', async () => {
    const world = await createWorld()
    const patientId = await world.newPatient('RouteConflict')
    const appointmentId = await world.pastAppointment(patientId, '300.00', 10)
    const budget = await world.newBudget(patientId, ['100.00', '900.00'])

    // createPaymentSchema (routes/patients.ts) carries amount/date/note/
    // budgetId only, and the handler passes no appointmentId, so a client
    // cannot reach BUDGET_RESERVATION_CONFLICT: the extra key is dropped and
    // the payment is created as an ordinary reservation.
    const res = await api()
      .post(`/api/patients/${patientId}/payments`)
      .set(world.auth())
      .send({ amount: 500, date: new Date().toISOString(), budgetId: budget.id, appointmentId })
    expect(res.status).toBe(201)
    expect(res.body.data.budgetId).toBe(budget.id)
    expect(res.body.data.appointmentId).toBeNull()

    // The 400 in the handler's statusMap is therefore a guard on a code only
    // a future server-side caller could produce. What is pinned here is that
    // the entry EXISTS and is 400: without it the handler's `|| 500` would
    // answer a 500 to a validation error. The statusMap is a module-private
    // const, so this asserts the only thing observable from outside — that no
    // request shape reaching the route can produce the code at all.
    expect(await prisma.patientPayment.count({ where: { patientId, appointmentId: { not: null } } })).toBe(0)
  })

  it('GUARD 3 (the distortion it prevents): a conflicting row makes the readers disagree', async () => {
    const world = await createWorld()
    const patientId = await world.newPatient('Distorted')
    const appointmentId = await world.pastAppointment(patientId, '1000.00', 10)
    const budget = await world.newBudget(patientId, ['100.00', '900.00'])

    // The row createPayment now refuses, written directly: kind=APPOINTMENT
    // with an appointmentId makes it an earmark (getAppointmentEarmarks), and
    // the budgetId makes it a reservation. The same 500 leaves the general
    // pool twice.
    await prisma.patientPayment.create({
      data: {
        tenantId: world.tenantId,
        patientId,
        amount: '500.00',
        date: new Date(),
        kind: 'APPOINTMENT',
        appointmentId,
        budgetId: budget.id,
      },
    })

    // MEASURED. The patient paid 500 against 1000 of debt, so 500 is owed —
    // which is what the statement says. The three aggregate readers subtract
    // the same 500 twice and report the FULL 1000 as unpaid: the four readers
    // disagree by exactly the conflicted amount.
    const balance = await getPatientBalance(world.tenantId, patientId)
    if (!balance.success) throw new Error('fixture')
    expect(balance.data).toEqual({ totalDebt: 1000, totalPaid: 500, outstanding: 1000, credit: 0 })

    const stmt = await world.statement(patientId)
    expect(stmt.appointmentsDebt).toBe(500)
    expect(stmt.reservedAdvances).toEqual([
      // Counted as a whole reservation AND as a whole earmark.
      { budgetId: budget.id, reserved: 500, consumed: 0, remaining: 500, open: true },
    ])

    const debtors = await listDebtors(world.tenantId)
    expect(debtors.map((r) => [r.totalDebt, r.totalPaid, r.outstanding])).toEqual([[1000, 500, 1000]])
    expect(await getTenantOutstandingTotal(world.tenantId)).toBe(1000)

    // The divergence itself, stated as a figure: 500 between the statement and
    // the aggregates, on a fixture where no reader should move at all.
    expect(balance.data.outstanding - stmt.appointmentsDebt).toBe(500)
  })

  /**
   * The mechanism the code comment names — `capacityCents` going negative and
   * INFLATING the pool — at the level where it is reachable.
   *
   * It is reachable in computeFifoAllocation, because there `earmarks` is
   * keyed by billable-item id and so can land on the same item as a
   * reservation. It is NOT reachable through the database today:
   * getAppointmentEarmarks keys earmarks by appointmentId, while a
   * reservation only ever reduces a budgetItem charge, and those two id
   * spaces never meet — which is why the DB-level fixture above shows a
   * divergence rather than an inflated pool. The check in createPayment keeps
   * the row out before either shape can matter.
   */
  it('GUARD 3 (the mechanism): an item both earmarked and reserved drives capacity negative and inflates the pool', () => {
    const items = [charge('conflicted', 100, 0, 'b1'), charge('later', 100, 1, undefined, 'appointment')]
    const res = reservations({ b1: { amount: 100, open: true } })

    // Honest world: the 100 is ONLY reserved. It pays its own charge and the
    // later, unrelated charge gets nothing.
    expect(computeFifoAllocation(items, 100, undefined, res).map((a) => [a.id, a.paidAmount, a.outstanding])).toEqual([
      ['conflicted', 100, 0],
      ['later', 0, 100],
    ])

    // Conflicted world: the same 100 is also earmarked to that item.
    // capacity = 10000 - 10000 (earmark) - 10000 (reservation) = -10000, and
    // `remainingCents = Math.max(0, remainingCents - capacityCents)` ADDS it
    // back: a pool of 100 the patient never paid, which then pays the later
    // charge in full.
    const inflated = computeFifoAllocation(items, 100, new Map([['conflicted', 100]]), res)
    expect(inflated.map((a) => [a.id, a.paidAmount, a.outstanding])).toEqual([
      ['conflicted', 100, 0],
      ['later', 100, 0],
    ])
    // 200 allocated out of a 100 payment: the inflation, as a figure.
    expect(inflated.reduce((sum, a) => sum + a.paidAmount, 0)).toBe(200)
  })
})

// ---------------------------------------------------------------------------
// Task #569: a reservation created by the FORM, not by a fixture
// ---------------------------------------------------------------------------

/**
 * #562/#568 prove the engine from reservations built by a fixture. A fixture
 * can build a state the screen cannot produce, so this block replays the exact
 * request the real PaymentFormModal sends. That request is not written here:
 * it is read from the contract file the app test
 * (PaymentSection.reserve.test.tsx) asserts the form's serialised wire body
 * EQUAL to. The same file also carries the failures the form is taught to
 * handle, asserted below against the real endpoint.
 *
 * Seam, stated honestly: vitest cannot span the two processes, so the link is
 * the checked-in file. If the form's body drifts, the APP test goes red (its
 * assertion is against this file); if the API stops accepting or answering as
 * the file says, THIS block goes red. This block alone does not notice a form
 * regression, and the app test alone does not notice an API one.
 *
 * Guard 1's engine side (an unreserved advance allocates oldest-first, in one
 * package) is `GUARD 2: an unreserved advance ...` above; the replay below
 * only adds that the form's no-budget body reaches the same state.
 */
const contract = JSON.parse(
  readFileSync(
    new URL('../../../app/src/components/payments/__fixtures__/reserve-advance-contract.json', import.meta.url),
    'utf8'
  )
) as {
  budget: { id: string; patientId: string; status: string; isActive: boolean; totalAmount: string }
  request: { urlTemplate: string; body: Record<string, unknown> }
  requestGeneral: { urlTemplate: string; body: Record<string, unknown> }
  responses: Record<'budgetNotOpen' | 'budgetGone', { status: number; body: Record<string, unknown> }>
}

describe('Task #569 (real routes): the form\'s own request, replayed', () => {
  async function purge() {
    for (const id of tenantIds) {
      await prisma.patientPaymentEvent.deleteMany({ where: { payment: { tenantId: id } } })
      await prisma.patientPayment.deleteMany({ where: { tenantId: id } })
      await prisma.budgetItemAppointment.deleteMany({ where: { appointment: { tenantId: id } } })
      await prisma.budget.deleteMany({ where: { tenantId: id } })
      await prisma.appointment.deleteMany({ where: { tenantId: id } })
      await prisma.patient.deleteMany({ where: { tenantId: id } })
      await prisma.doctor.deleteMany({ where: { tenantId: id } })
      await prisma.refreshToken.deleteMany({ where: { user: { tenantId: id } } })
      await prisma.user.deleteMany({ where: { tenantId: id } })
      await prisma.tenant.delete({ where: { id } }).catch(() => {})
    }
    tenantIds.length = 0
  }
  // The contract's budget id is fixed, so every test must free it.
  afterEach(purge)
  afterAll(purge)

  /** The budget the contract describes, with the fixed id, for this patient. */
  async function contractBudget(
    world: World,
    patientId: string,
    prices: string[],
    status: 'APPROVED' | 'COMPLETED' | 'CANCELLED' = 'APPROVED'
  ) {
    return prisma.budget.create({
      data: {
        id: contract.budget.id,
        tenantId: world.tenantId,
        patientId,
        status,
        totalAmount: prices.reduce((s, p) => s + Number(p), 0).toFixed(2),
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

  /** Replays a contract request against the real endpoint, URL template filled in. */
  function replay(world: World, patientId: string, req: { urlTemplate: string; body: Record<string, unknown> }) {
    return api()
      .post('/api' + req.urlTemplate.replace('{patientId}', patientId))
      .set(world.auth())
      .send(req.body)
  }

  it('GUARD 4: the budget the form offers is listed by the API exactly as the contract says', async () => {
    const world = await createWorld()
    const patientId = await world.newPatient('Listed')
    await contractBudget(world, patientId, ['100.00', '900.00'])
    const res = await api().get(`/api/patients/${patientId}/budgets`).query({ limit: 100 }).set(world.auth())
    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(1)
    expect(res.body.data[0]).toMatchObject({
      id: contract.budget.id,
      status: contract.budget.status,
      isActive: contract.budget.isActive,
      totalAmount: contract.budget.totalAmount,
      patientId, // the form compares this to ITS patient id before offering the option
    })
  })

  it('GUARD 4: the form\'s reserved advance creates the reservation, and all four readers say 300', async () => {
    const world = await createWorld()
    const patientId = await world.newPatient('FormReserved')
    await world.pastAppointment(patientId, '300.00', 10)
    const budget = await contractBudget(world, patientId, ['100.00', '900.00'])

    // The request is the captured one: no amount/budgetId is typed in here.
    const res = await replay(world, patientId, contract.request)
    expect(res.status).toBe(201)
    expect(res.body.data).toMatchObject({
      amount: '500', // Decimal serialises as a string
      budgetId: contract.budget.id,
      appointmentId: null,
      kind: 'ADVANCE',
    })
    expect(await prisma.patientPayment.count({ where: { patientId, budgetId: contract.budget.id } })).toBe(1)

    await world.executeItems(patientId, [budget.items[0].id])
    expect((await prisma.budget.findUnique({ where: { id: budget.id } }))?.status).toBe('PARTIAL')

    // Same figures as the fixture-built canonical world of #562: the screen
    // reaches the state the engine was proven on.
    const balance = await getPatientBalance(world.tenantId, patientId)
    const debtors = await listDebtors(world.tenantId)
    const stmt = await getPatientAccountStatement(world.tenantId, patientId)
    if (!balance.success || !stmt.success) throw new Error('fixture')
    expect({
      getPatientBalance: balance.data.outstanding,
      listDebtors: debtors.find((d) => d.patientId === patientId)?.outstanding ?? 0,
      getTenantOutstandingTotal: await getTenantOutstandingTotal(world.tenantId),
      accountStatement: stmt.data.appointmentsDebt,
      accountStatementAdvancesCredit: stmt.data.advancesCredit,
      getPatientBalanceCredit: balance.data.credit,
    }).toEqual({
      getPatientBalance: 300,
      listDebtors: 300,
      getTenantOutstandingTotal: 300,
      accountStatement: 300,
      accountStatementAdvancesCredit: 0,
      getPatientBalanceCredit: 0,
    })
    expect(debtors).toHaveLength(1)
    expect((await world.statement(patientId)).reservedAdvances).toEqual([
      { budgetId: contract.budget.id, reserved: 500, consumed: 100, remaining: 400, open: true },
    ])
  })

  it('GUARD 1: the form\'s no-budget body is a plain advance, allocated oldest-first in one package', async () => {
    const world = await createWorld()
    const patientId = await world.newPatient('FormGeneral')
    const older = await world.pastAppointment(patientId, '400.00', 20)
    const newer = await world.pastAppointment(patientId, '400.00', 10)
    // The contract's general body is amount 500.
    expect(contract.requestGeneral.body).not.toHaveProperty('budgetId')

    const res = await replay(world, patientId, contract.requestGeneral)
    expect(res.status).toBe(201)
    expect(res.body.data).toMatchObject({ amount: '500', budgetId: null, appointmentId: null })

    // Oldest first, all in one package: 400 to the older, the remaining 100 to the newer.
    const rows = await world.appointmentRows(patientId)
    expect(rows.get(older)).toEqual({ paidAmount: 400, outstanding: 0, isPaid: true })
    expect(rows.get(newer)).toEqual({ paidAmount: 100, outstanding: 300, isPaid: false })
    const balance = await getPatientBalance(world.tenantId, patientId)
    if (!balance.success) throw new Error('fixture')
    expect(balance.data).toEqual({ totalDebt: 800, totalPaid: 500, outstanding: 300, credit: 0 })
    expect(await getTenantOutstandingTotal(world.tenantId)).toBe(300)
    expect('reservedAdvances' in (await world.statement(patientId))).toBe(false)
  })

  it('GUARD 3 / 5: a COMPLETED budget refuses the form\'s request with 400 and the contract\'s text, writing no row', async () => {
    const world = await createWorld()
    const patientId = await world.newPatient('Closed')
    const budget = await contractBudget(world, patientId, ['100.00'])
    // Closed by the real path: its only item executed -> auto-COMPLETE.
    await world.executeItems(patientId, [budget.items[0].id])
    expect((await prisma.budget.findUnique({ where: { id: budget.id } }))?.status).toBe('COMPLETED')

    const res = await replay(world, patientId, contract.request)
    expect(res.status).toBe(contract.responses.budgetNotOpen.status)
    expect(res.body).toEqual(contract.responses.budgetNotOpen.body)
    expect(await prisma.patientPayment.count({ where: { patientId } })).toBe(0)

    // The default list STILL returns it (so the form must filter by status on
    // the reload that follows this 400).
    const list = await api().get(`/api/patients/${patientId}/budgets`).query({ limit: 100 }).set(world.auth())
    expect(list.body.data.map((b: { id: string; status: string }) => [b.id, b.status])).toEqual([
      [contract.budget.id, 'COMPLETED'],
    ])
  })

  it('GUARD 3: a CANCELLED budget is refused the same way', async () => {
    const world = await createWorld()
    const patientId = await world.newPatient('Cancelled')
    await contractBudget(world, patientId, ['100.00'], 'CANCELLED')

    const res = await replay(world, patientId, contract.request)
    expect(res.status).toBe(400)
    expect(res.body).toEqual(contract.responses.budgetNotOpen.body)
    expect(await prisma.patientPayment.count({ where: { patientId } })).toBe(0)
  })

  it('GUARD 6: a merely DEACTIVATED budget answers 404 with the contract\'s "not found" text (false for the user), writing no row', async () => {
    const world = await createWorld()
    const patientId = await world.newPatient('Deactivated')
    await contractBudget(world, patientId, ['100.00'])
    // Deactivated by the real route, after the form could have loaded it.
    const del = await api().delete(`/api/budgets/${contract.budget.id}`).set(world.auth())
    expect(del.status).toBe(200)
    expect((await prisma.budget.findUnique({ where: { id: contract.budget.id } }))?.isActive).toBe(false)

    const res = await replay(world, patientId, contract.request)
    expect(res.status).toBe(contract.responses.budgetGone.status)
    expect(res.body).toEqual(contract.responses.budgetGone.body)
    expect(await prisma.patientPayment.count({ where: { patientId } })).toBe(0)

    // The default list no longer returns it: the reload shows it gone.
    const list = await api().get(`/api/patients/${patientId}/budgets`).query({ limit: 100 }).set(world.auth())
    expect(list.body.data).toEqual([])
  })

  it('the two failures are distinguishable by status alone: 400 vs 404 (the form keys its copy on it)', () => {
    expect([contract.responses.budgetNotOpen.status, contract.responses.budgetGone.status]).toEqual([400, 404])
    // Both bodies are a BARE string error with no code: this endpoint sends none.
    for (const r of Object.values(contract.responses)) {
      expect(Object.keys(r.body).sort()).toEqual(['error', 'success'])
      expect(typeof r.body.error).toBe('string')
    }
  })
})
