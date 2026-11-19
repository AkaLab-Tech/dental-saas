/**
 * Task #691: carry the EXECUTED links stranded on a deleted appointment onto its
 * re-created replacement (prevention, half 2 of #685).
 *
 * THE STATE THIS FILE PINS. `DELETE /api/appointments/:id` soft-deletes the
 * visit and then runs `setAppointmentBudgetItems(id, [])`, which only ever
 * touches `role: 'SCHEDULED'` rows. Every `role: 'EXECUTED'` row therefore stays
 * pointed at the now-inactive appointment with `budgetItem.status` still
 * EXECUTED, and the item stops billing (the money readers only follow links on
 * live visits). When the clinic re-creates the visit (same patient, doctor and
 * exact startTime) the charge never comes back. POST /appointments now moves
 * those rows onto the new visit, but only when the new visit holds no links of
 * its own.
 *
 * GUARD NUMBERING IS PER FILE, NOT GLOBAL. This file owns G14-G21 and continues
 * the EXECUTED-link series of
 * apps/api/src/services/payment-executed-link-projection.test.ts, which holds
 * G1-G8 and G10-G13 plus suffixed variants (G7-A..G7-H, G10-A..G10-D,
 * G13-A..G13-C, G2-R, G2-R-COST) and has NO G9. A G9 exists in
 * stats.service.zone.test.ts and in budgets.store.test.ts as unrelated series.
 * G22 (what the clinic assistant reads) lives in
 * apps/app/src/components/appointments/AppointmentFormModal.test.tsx. No
 * existing label is reused or renumbered.
 *
 *   G14    what the real DELETE leaves behind (the premise, pinned not assumed)
 *   G15-A  the carry, cost null (the 4-pair production population)
 *   G15-B  the carry onto a replacement with a typed cost (#590)
 *   G16    discrimination: a replacement with its own link does not carry
 *   G17    vacuity control: a predecessor with no link carries nothing
 *   G18a-e identity: startTime / doctor / patient / liveness / link role
 *   G19    the 201 body describes the carried link (no-payment + advance)
 *   G20    no derivation is armed (DRAFT and APPROVED budget)
 *   G21    ambiguity: the most recently created predecessor wins, only it moves
 *
 * HOW EACH STATE IS REACHED. Association is setAppointmentBudgetItems (PUT
 * budgetItemIds), confirmation is the real mark-done route and deletion is the
 * real DELETE route, so the route's own SCHEDULED release runs. Direct prisma
 * writes are scaffolding (tenant, patient, doctor, budget) and the
 * appointment-level perturbations of G18d / G18e / G20 (which never touch a
 * link's role or an item's status), each flagged where used.
 *
 * Prices are DISTINCT per item inside a patient, each money figure is read from
 * all three readers (listBillableItems, getPatientBalance,
 * computeOutstandingByPatient) against its own literal, and every case takes
 * its own slot (a fresh day) so the create route's checkTimeConflict never
 * collides with another case or with the sibling file. Figures and synthetic
 * ids only; no real patient data.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { api } from '../test/http.js'
import { prisma } from '@dental/database'
import { hashPassword } from '../services/auth.service.js'
import { generateToken } from '../test/tokens.js'
import { createBudget } from '../services/budget.service.js'
import {
  computeOutstandingByPatient,
  getPatientAccountStatement,
  getPatientBalance,
  listBillableItems,
} from '../services/payment.service.js'

interface ItemsAggregate {
  count: number
  cost: number
  paidAmount: number
  outstanding: number
}

interface Money {
  lines: Array<{ type: string; cost: number }>
  totalDebt: number
  totalPaid: number
  outstanding: number
  credit: number
}

describe('Task #691: EXECUTED links are carried across a delete-then-re-create', () => {
  let tenantId: string
  let adminToken: string
  let doctorId: string
  let otherDoctorId: string
  let dayOffset = 1
  let patientSeq = 0
  const suffix = Date.now()

  beforeAll(async () => {
    const tenant = await prisma.tenant.create({
      data: { name: 'Test Clinic Link Carry', slug: `test-clinic-link-carry-${suffix}` },
    })
    tenantId = tenant.id
    const admin = await prisma.user.create({
      data: {
        email: `admin-link-carry-${suffix}@test.com`,
        passwordHash: await hashPassword('AdminPass123!'),
        firstName: 'Admin',
        lastName: 'User',
        role: 'ADMIN',
        tenantId,
      },
    })
    adminToken = generateToken(admin.id, tenantId, 'ADMIN')
    const mkDoctor = async (label: string) =>
      (
        await prisma.doctor.create({
          data: {
            tenantId,
            firstName: `Dr. ${label}`,
            lastName: 'Carry',
            email: `doctor-${label}-link-carry-${suffix}@test.com`,
            specialty: 'General Dentistry',
          },
        })
      ).id
    doctorId = await mkDoctor('One')
    otherDoctorId = await mkDoctor('Two')
  })

  afterAll(async () => {
    await prisma.patientPayment.deleteMany({ where: { tenantId } })
    await prisma.appointment.deleteMany({ where: { tenantId } })
    await prisma.budget.deleteMany({ where: { tenantId } })
    await prisma.patient.deleteMany({ where: { tenantId } })
    await prisma.doctor.deleteMany({ where: { tenantId } })
    await prisma.refreshToken.deleteMany({ where: { user: { tenantId } } })
    await prisma.user.deleteMany({ where: { tenantId } })
    await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {})
  })

  // --------------------------------------------------------------------------
  // HTTP + scaffolding helpers
  // --------------------------------------------------------------------------

  function authed<T extends { set(k: string, v: string): T }>(r: T): T {
    return r.set('Authorization', `Bearer ${adminToken}`)
  }

  const post = (path: string, body: Record<string, unknown>) =>
    authed(api().post(path)).send(body)
  const put = (path: string, body: Record<string, unknown>) => authed(api().put(path)).send(body)
  const del = (path: string) => authed(api().delete(path))

  async function newPatient(): Promise<string> {
    patientSeq += 1
    return (
      await prisma.patient.create({
        data: { tenantId, firstName: 'Fixture', lastName: `Carry${suffix}-${patientSeq}` },
      })
    ).id
  }

  /** A fresh day at 10:00 local; each case consumes its own so no slot collides. */
  function slot() {
    const start = new Date()
    start.setDate(start.getDate() + dayOffset++)
    start.setHours(10, 0, 0, 0)
    return { start, end: new Date(start.getTime() + 30 * 60 * 1000) }
  }

  /** An APPROVED budget (createBudget's default) with the given item prices, in order. */
  async function seedBudget(patientId: string, prices: number[]) {
    const created = await createBudget(tenantId, patientId, {
      items: prices.map((p) => ({ description: `item ${p}`, quantity: 1, unitPrice: p })),
    })
    if (!created.success) throw new Error(`fixture: createBudget failed: ${created.code}`)
    const items = await prisma.budgetItem.findMany({
      where: { budgetId: created.data.id },
      orderBy: { order: 'asc' },
      select: { id: true, totalPrice: true },
    })
    expect(items.map((i) => i.totalPrice.toNumber())).toEqual(prices)
    return { budgetId: created.data.id, itemIds: items.map((i) => i.id) }
  }

  async function createVisit(opts: {
    patientId: string
    start: Date
    end: Date
    doctor?: string
    body?: Record<string, unknown>
  }) {
    return post('/api/appointments', {
      patientId: opts.patientId,
      doctorId: opts.doctor ?? doctorId,
      startTime: opts.start.toISOString(),
      endTime: opts.end.toISOString(),
      ...opts.body,
    })
  }

  async function createVisitOk(opts: Parameters<typeof createVisit>[0]): Promise<string> {
    const res = await createVisit(opts)
    expect(res.status).toBe(201)
    return res.body.data.id as string
  }

  /** A costed visit on its own day: the patient's standing charge, so no figure is ever 0 by default. */
  async function seedBystander(patientId: string, cost: number): Promise<string> {
    const { start, end } = slot()
    return createVisitOk({ patientId, start, end, body: { cost } })
  }

  /**
   * Builds the stranded state through the real path: create a costless visit,
   * associate `executed` items (SCHEDULED), optionally also `scheduledToo`
   * items, confirm `executed` through the real mark-done route, then delete the
   * visit through the real DELETE route.
   */
  async function deleteThroughRoute(
    appointmentId: string,
    executed: string[],
    scheduledToo: string[] = []
  ) {
    expect(
      (await put(`/api/appointments/${appointmentId}`, { budgetItemIds: [...executed, ...scheduledToo] })).status
    ).toBe(200)
    const done = await put(`/api/appointments/${appointmentId}/mark-done`, {
      executedBudgetItemIds: executed,
    })
    expect(done.status).toBe(200)
    const deleted = await del(`/api/appointments/${appointmentId}`)
    expect(deleted.status).toBe(200)
  }

  async function strand(opts: {
    aPrice: number
    uPrice: number
    bystander?: number
    scheduledToo?: boolean
    doctor?: string
  }) {
    const patientId = await newPatient()
    const { budgetId, itemIds } = await seedBudget(patientId, [opts.aPrice, opts.uPrice])
    const [itemA, itemU] = itemIds
    if (opts.bystander !== undefined) await seedBystander(patientId, opts.bystander)
    const { start, end } = slot()
    const doctor = opts.doctor ?? doctorId
    const predecessorId = await createVisitOk({ patientId, start, end, doctor })
    await deleteThroughRoute(predecessorId, [itemA], opts.scheduledToo ? [itemU] : [])
    return { patientId, budgetId, itemA, itemU, predecessorId, start, end, doctor }
  }

  // --------------------------------------------------------------------------
  // Readers
  // --------------------------------------------------------------------------

  /** All three money readers for one patient, as plain comparable literals. */
  async function readMoney(patientId: string): Promise<{
    billable: Money['lines']
    balance: { totalDebt: number; totalPaid: number; outstanding: number; credit: number }
    outstanding: { totalDebt: number; totalPaid: number; outstanding: number }
  }> {
    const billable = (await listBillableItems(tenantId, patientId))
      .map((b) => ({ type: b.type as string, cost: b.cost }))
      .sort((x, y) => x.cost - y.cost)
    const bal = await getPatientBalance(tenantId, patientId)
    if (!bal.success) throw new Error(`getPatientBalance failed: ${bal.code}`)
    const byPatient = await computeOutstandingByPatient(tenantId)
    return {
      billable,
      balance: bal.data,
      outstanding: byPatient.get(patientId) ?? { totalDebt: 0, totalPaid: 0, outstanding: 0 },
    }
  }

  /** Each reader against its OWN literal (the G10 idiom). */
  async function expectMoney(patientId: string, expected: Money) {
    const got = await readMoney(patientId)
    expect(got.billable).toEqual([...expected.lines].sort((x, y) => x.cost - y.cost))
    expect(got.balance).toEqual({
      totalDebt: expected.totalDebt,
      totalPaid: expected.totalPaid,
      outstanding: expected.outstanding,
      credit: expected.credit,
    })
    expect(got.outstanding).toEqual({
      totalDebt: expected.totalDebt,
      totalPaid: expected.totalPaid,
      outstanding: expected.outstanding,
    })
  }

  async function statement(patientId: string) {
    const r = await getPatientAccountStatement(tenantId, patientId)
    if (!r.success) throw new Error(`getPatientAccountStatement failed: ${r.code}`)
    return r.data
  }

  const sortLinks = <T extends { budgetItemId: string; role: string }>(rows: T[]) =>
    [...rows].sort((x, y) => `${x.budgetItemId}:${x.role}`.localeCompare(`${y.budgetItemId}:${y.role}`))

  const linksOf = async (appointmentId: string) =>
    sortLinks(
      await prisma.budgetItemAppointment.findMany({
        where: { appointmentId },
        select: { budgetItemId: true, role: true },
      })
    )

  const executedLinkOf = (itemId: string) =>
    prisma.budgetItemAppointment.findMany({
      where: { budgetItemId: itemId, role: 'EXECUTED' },
      select: { appointmentId: true },
    })

  const itemStatus = async (itemId: string) =>
    (await prisma.budgetItem.findUniqueOrThrow({ where: { id: itemId } })).status

  // ==========================================================================
  // G14 - what the delete actually leaves behind
  // ==========================================================================
  describe('G14: the real DELETE strands the EXECUTED link and releases the SCHEDULED one', () => {
    it('EXECUTED row stays on the inactive visit, SCHEDULED row is gone, item still EXECUTED, outstanding drops by exactly 5300', async () => {
      const patientId = await newPatient()
      const { itemIds } = await seedBudget(patientId, [5300, 2100])
      const [itemA, itemU] = itemIds
      await seedBystander(patientId, 1700)
      const { start, end } = slot()
      const appointmentId = await createVisitOk({ patientId, start, end })

      // Association + confirmation reached through the real routes: A executed,
      // U left SCHEDULED beside it.
      expect((await put(`/api/appointments/${appointmentId}`, { budgetItemIds: [itemA, itemU] })).status).toBe(200)
      expect(
        (await put(`/api/appointments/${appointmentId}/mark-done`, { executedBudgetItemIds: [itemA] })).status
      ).toBe(200)

      // PRE-STATE: A bills 5300 beside the 1700 visit; U holds a SCHEDULED link.
      expect(await linksOf(appointmentId)).toEqual(
        expect.arrayContaining([
          { budgetItemId: itemA, role: 'EXECUTED' },
          { budgetItemId: itemU, role: 'SCHEDULED' },
        ])
      )
      await expectMoney(patientId, {
        lines: [
          { type: 'appointment', cost: 1700 },
          { type: 'budgetItem', cost: 5300 },
        ],
        totalDebt: 7000,
        totalPaid: 0,
        outstanding: 7000,
        credit: 0,
      })

      expect((await del(`/api/appointments/${appointmentId}`)).status).toBe(200)

      expect((await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } })).isActive).toBe(false)
      // The EXECUTED row still points at the inactive visit; the SCHEDULED row is gone.
      expect(await linksOf(appointmentId)).toEqual([{ budgetItemId: itemA, role: 'EXECUTED' }])
      expect(await itemStatus(itemA)).toBe('EXECUTED')
      expect(await itemStatus(itemU)).toBe('PENDING')
      // A stopped billing: 7000 - 5300 = 1700.
      await expectMoney(patientId, {
        lines: [{ type: 'appointment', cost: 1700 }],
        totalDebt: 1700,
        totalPaid: 0,
        outstanding: 1700,
        credit: 0,
      })
    })
  })

  // ==========================================================================
  // G15 - the carry
  // ==========================================================================
  describe('G15-A: re-creating the visit with cost null carries the EXECUTED link (the 4-pair population)', () => {
    it('the row moves to the new active visit, the item bills 5400 again and outstanding returns to the pre-delete 7100', async () => {
      const s = await strand({ aPrice: 5400, uPrice: 2200, bystander: 1700 })
      const before = {
        lines: [{ type: 'appointment', cost: 1700 }],
        totalDebt: 1700,
        totalPaid: 0,
        outstanding: 1700,
        credit: 0,
      }
      await expectMoney(s.patientId, before)

      const res = await createVisit({ patientId: s.patientId, start: s.start, end: s.end })
      expect(res.status).toBe(201)
      const newId = res.body.data.id as string
      expect(newId).not.toBe(s.predecessorId)

      expect(await executedLinkOf(s.itemA)).toEqual([{ appointmentId: newId }])
      expect(
        await prisma.budgetItemAppointment.count({ where: { appointmentId: s.predecessorId, role: 'EXECUTED' } })
      ).toBe(0)
      expect(await itemStatus(s.itemA)).toBe('EXECUTED')
      expect(await itemStatus(s.itemU)).toBe('PENDING')

      const after: Money = {
        lines: [
          { type: 'appointment', cost: 1700 },
          { type: 'budgetItem', cost: 5400 },
        ],
        totalDebt: 7100,
        totalPaid: 0,
        outstanding: 7100,
        credit: 0,
      }
      await expectMoney(s.patientId, after)
      // Strictly higher than the pre-create figure: the guard cannot pass on a figure that never moved.
      expect(after.outstanding).toBeGreaterThan(before.outstanding)
      expect((await statement(s.patientId)).totalBilled).toBe(7100)
      expect((await statement(s.patientId)).remainingBudgetProjection).toBe(2200)
    })
  })

  describe('G15-B: re-creating the visit with a typed cost (#590) carries the link but bills ONCE, by the visit', () => {
    it('the row moves, the visit 900 bills, the item does not: debt 1700 + 900 = 2600, never plus 5500', async () => {
      const s = await strand({ aPrice: 5500, uPrice: 2300, bystander: 1700 })
      await expectMoney(s.patientId, {
        lines: [{ type: 'appointment', cost: 1700 }],
        totalDebt: 1700,
        totalPaid: 0,
        outstanding: 1700,
        credit: 0,
      })

      const res = await createVisit({
        patientId: s.patientId,
        start: s.start,
        end: s.end,
        body: { cost: 900 },
      })
      expect(res.status).toBe(201)
      const newId = res.body.data.id as string

      expect(await executedLinkOf(s.itemA)).toEqual([{ appointmentId: newId }])
      expect(await itemStatus(s.itemA)).toBe('EXECUTED')

      await expectMoney(s.patientId, {
        lines: [
          { type: 'appointment', cost: 900 },
          { type: 'appointment', cost: 1700 },
        ],
        totalDebt: 2600,
        totalPaid: 0,
        outstanding: 2600,
        credit: 0,
      })
      // The item is excluded from billing AND from the projection (its status is
      // EXECUTED, so it is no longer "remaining"); only the unlinked 2300 is projected.
      const st = await statement(s.patientId)
      expect(st.totalBilled).toBe(2600)
      expect(st.remainingBudgetProjection).toBe(2300)
    })
  })

  // ==========================================================================
  // G16 - discrimination: the 2-pair population
  // ==========================================================================
  describe('G16: a replacement that holds a link of its own does NOT carry', () => {
    it('A stays on the predecessor and does not bill; B (4100, SCHEDULED) does not bill either; figures are the post-delete ones', async () => {
      const s = await strand({ aPrice: 5600, uPrice: 2400, bystander: 1700 })
      const b = await seedBudget(s.patientId, [4100])
      const itemB = b.itemIds[0]

      const res = await createVisit({
        patientId: s.patientId,
        start: s.start,
        end: s.end,
        body: { budgetItemIds: [itemB] },
      })
      expect(res.status).toBe(201)
      const newId = res.body.data.id as string

      expect(await executedLinkOf(s.itemA)).toEqual([{ appointmentId: s.predecessorId }])
      expect(await linksOf(newId)).toEqual([{ budgetItemId: itemB, role: 'SCHEDULED' }])
      expect(await itemStatus(itemB)).toBe('SCHEDULED')
      expect(await itemStatus(s.itemA)).toBe('EXECUTED')
      await expectMoney(s.patientId, {
        lines: [{ type: 'appointment', cost: 1700 }],
        totalDebt: 1700,
        totalPaid: 0,
        outstanding: 1700,
        credit: 0,
      })
    })
  })

  // ==========================================================================
  // G17 - vacuity control
  // ==========================================================================
  describe('G17: a predecessor deleted holding NO link carries nothing', () => {
    it('no row is invented and every figure is identical before and after the create', async () => {
      const patientId = await newPatient()
      const { itemIds } = await seedBudget(patientId, [5700, 2500])
      await seedBystander(patientId, 1700)
      const { start, end } = slot()
      const predecessorId = await createVisitOk({ patientId, start, end })
      expect((await del(`/api/appointments/${predecessorId}`)).status).toBe(200)
      expect(await prisma.budgetItemAppointment.count({ where: { budgetItemId: { in: itemIds } } })).toBe(0)

      const expected: Money = {
        lines: [{ type: 'appointment', cost: 1700 }],
        totalDebt: 1700,
        totalPaid: 0,
        outstanding: 1700,
        credit: 0,
      }
      await expectMoney(patientId, expected)
      const snapshotBefore = await readMoney(patientId)

      const newId = await createVisitOk({ patientId, start, end })

      expect(await linksOf(newId)).toEqual([])
      expect(await prisma.budgetItemAppointment.count({ where: { budgetItemId: { in: itemIds } } })).toBe(0)
      expect(await readMoney(patientId)).toEqual(snapshotBefore)
      await expectMoney(patientId, expected)
    })
  })

  // ==========================================================================
  // G18 - identity, one clause perturbed per case
  // ==========================================================================
  describe('G18: the carry matches the predecessor on identity, one clause perturbed per case', () => {
    async function expectNoCarry(
      s: { patientId: string; itemA: string; predecessorId: string },
      newId: string,
      money: Money
    ) {
      expect(await executedLinkOf(s.itemA)).toEqual([{ appointmentId: s.predecessorId }])
      expect(await linksOf(newId)).toEqual([])
      expect(await itemStatus(s.itemA)).toBe('EXECUTED')
      await expectMoney(s.patientId, money)
    }

    const postDelete = (bystander: number): Money => ({
      lines: [{ type: 'appointment', cost: bystander }],
      totalDebt: bystander,
      totalPaid: 0,
      outstanding: bystander,
      credit: 0,
    })

    it('G18a: a different startTime (one hour later) does not carry', async () => {
      const s = await strand({ aPrice: 5800, uPrice: 2600, bystander: 1700 })
      const start = new Date(s.start.getTime() + 60 * 60 * 1000)
      const end = new Date(s.end.getTime() + 60 * 60 * 1000)
      const newId = await createVisitOk({ patientId: s.patientId, start, end })
      await expectNoCarry(s, newId, postDelete(1700))
    })

    it('G18b: a different doctor does not carry', async () => {
      const s = await strand({ aPrice: 5900, uPrice: 2700, bystander: 1700 })
      const newId = await createVisitOk({
        patientId: s.patientId,
        start: s.start,
        end: s.end,
        doctor: otherDoctorId,
      })
      await expectNoCarry(s, newId, postDelete(1700))
    })

    it('G18c: a different patient does not carry; the stranded patient is untouched', async () => {
      const s = await strand({ aPrice: 6000, uPrice: 2800, bystander: 1700 })
      const otherPatient = await newPatient()
      const newId = await createVisitOk({ patientId: otherPatient, start: s.start, end: s.end })
      await expectNoCarry(s, newId, postDelete(1700))
      await expectMoney(otherPatient, {
        lines: [],
        totalDebt: 0,
        totalPaid: 0,
        outstanding: 0,
        credit: 0,
      })
    })

    /**
     * Liveness. A COMPLETED visit and a new visit on the same doctor/slot would
     * collide on checkTimeConflict, which ignores CANCELLED, so the predecessor
     * is CANCELLED with a direct write (an appointment-level perturbation: no
     * link role and no item status is touched). It stays isActive: true, which
     * is the only clause this case varies.
     */
    it('G18d: a predecessor that is still active is not robbed of its link', async () => {
      const patientId = await newPatient()
      const { itemIds } = await seedBudget(patientId, [6100, 2900])
      await seedBystander(patientId, 1700)
      const { start, end } = slot()
      const predecessorId = await createVisitOk({ patientId, start, end })
      expect((await put(`/api/appointments/${predecessorId}`, { budgetItemIds: [itemIds[0]] })).status).toBe(200)
      expect(
        (await put(`/api/appointments/${predecessorId}/mark-done`, { executedBudgetItemIds: [itemIds[0]] })).status
      ).toBe(200)
      await prisma.appointment.update({ where: { id: predecessorId }, data: { status: 'CANCELLED' } })
      expect((await prisma.appointment.findUniqueOrThrow({ where: { id: predecessorId } })).isActive).toBe(true)

      const newId = await createVisitOk({ patientId, start, end })

      expect(await executedLinkOf(itemIds[0])).toEqual([{ appointmentId: predecessorId }])
      expect(await linksOf(newId)).toEqual([])
    })

    /**
     * Link role. Unreachable through the DELETE route (it releases every
     * SCHEDULED row), so the predecessor is soft-deleted with a direct write
     * that leaves its SCHEDULED row behind.
     */
    it('G18e: a predecessor holding only a SCHEDULED link carries nothing', async () => {
      const patientId = await newPatient()
      const { itemIds } = await seedBudget(patientId, [6200, 3000])
      await seedBystander(patientId, 1700)
      const { start, end } = slot()
      const predecessorId = await createVisitOk({ patientId, start, end })
      expect((await put(`/api/appointments/${predecessorId}`, { budgetItemIds: [itemIds[0]] })).status).toBe(200)
      await prisma.appointment.update({ where: { id: predecessorId }, data: { isActive: false } })

      const newId = await createVisitOk({ patientId, start, end })

      expect(await linksOf(predecessorId)).toEqual([{ budgetItemId: itemIds[0], role: 'SCHEDULED' }])
      expect(await linksOf(newId)).toEqual([])
      expect(await itemStatus(itemIds[0])).toBe('SCHEDULED')
    })

    it('G18e-2: of an EXECUTED and a SCHEDULED link on the predecessor only the EXECUTED one moves', async () => {
      const patientId = await newPatient()
      const { itemIds } = await seedBudget(patientId, [6300, 3100])
      await seedBystander(patientId, 1700)
      const { start, end } = slot()
      const predecessorId = await createVisitOk({ patientId, start, end })
      expect(
        (await put(`/api/appointments/${predecessorId}`, { budgetItemIds: [itemIds[0], itemIds[1]] })).status
      ).toBe(200)
      expect(
        (await put(`/api/appointments/${predecessorId}/mark-done`, { executedBudgetItemIds: [itemIds[0]] })).status
      ).toBe(200)
      await prisma.appointment.update({ where: { id: predecessorId }, data: { isActive: false } })
      // mark-done leaves A's SCHEDULED row beside its new EXECUTED row.
      const preState = sortLinks([
        { budgetItemId: itemIds[0], role: 'EXECUTED' },
        { budgetItemId: itemIds[0], role: 'SCHEDULED' },
        { budgetItemId: itemIds[1], role: 'SCHEDULED' },
      ])
      expect(await linksOf(predecessorId)).toEqual(preState)

      const newId = await createVisitOk({ patientId, start, end })

      // Exactly the EXECUTED row moved; both SCHEDULED rows stayed.
      expect(await linksOf(newId)).toEqual([{ budgetItemId: itemIds[0], role: 'EXECUTED' }])
      expect(await linksOf(predecessorId)).toEqual(
        sortLinks([
          { budgetItemId: itemIds[0], role: 'SCHEDULED' },
          { budgetItemId: itemIds[1], role: 'SCHEDULED' },
        ])
      )
    })
  })

  // ==========================================================================
  // G19 - the 201 body carries the carry
  // ==========================================================================
  describe('G19: the 201 body describes the carried link (the #642 defect, for the create)', () => {
    it('nothing paid (vacuity half): 1 item / 6400 / 0 covered / 6400 outstanding', async () => {
      const s = await strand({ aPrice: 6400, uPrice: 3200 })
      const res = await createVisit({ patientId: s.patientId, start: s.start, end: s.end })
      expect(res.status).toBe(201)
      expect(res.body.data.budgetItems).toEqual({
        count: 1,
        cost: 6400,
        paidAmount: 0,
        outstanding: 6400,
      } satisfies ItemsAggregate)
    })

    it('a 6500 advance paid before the create (discriminating half): the body reports the item COVERED, 1 item / 6500 / 6500 / 0', async () => {
      const s = await strand({ aPrice: 6500, uPrice: 3300 })
      expect(
        (
          await post(`/api/patients/${s.patientId}/payments`, {
            amount: 6500,
            date: new Date().toISOString(),
          })
        ).status
      ).toBe(201)

      const res = await createVisit({ patientId: s.patientId, start: s.start, end: s.end })
      expect(res.status).toBe(201)
      expect(res.body.data.budgetItems).toEqual({
        count: 1,
        cost: 6500,
        paidAmount: 6500,
        outstanding: 0,
      } satisfies ItemsAggregate)
    })
  })

  // ==========================================================================
  // G20 - no derivation is armed
  // ==========================================================================
  describe('G20: the carry writes no item status and no budget status or total', () => {
    async function budgetSnapshot(budgetId: string) {
      const budget = await prisma.budget.findUniqueOrThrow({
        where: { id: budgetId },
        select: { status: true, totalAmount: true },
      })
      const items = await prisma.budgetItem.findMany({
        where: { budgetId },
        orderBy: { order: 'asc' },
        select: { id: true, status: true, totalPrice: true },
      })
      return {
        status: budget.status,
        totalAmount: budget.totalAmount.toNumber(),
        items: items.map((i) => ({ id: i.id, status: i.status, totalPrice: i.totalPrice.toNumber() })),
      }
    }

    for (const status of ['DRAFT', 'APPROVED'] as const) {
      it(`${status} budget: status, totalAmount and every item status are identical before and after`, async () => {
        const s = await strand({ aPrice: 6600, uPrice: 3400 })
        // The production population sits on a DRAFT budget; the delete path never changes budget status.
        await prisma.budget.update({ where: { id: s.budgetId }, data: { status } })
        const before = await budgetSnapshot(s.budgetId)
        expect(before.status).toBe(status)
        expect(before.totalAmount).toBe(10000)
        expect(before.items.map((i) => i.status)).toEqual(['EXECUTED', 'PENDING'])

        const res = await createVisit({ patientId: s.patientId, start: s.start, end: s.end })
        expect(res.status).toBe(201)
        // Not vacuous: the carry really ran.
        expect(await executedLinkOf(s.itemA)).toEqual([{ appointmentId: res.body.data.id }])

        expect(await budgetSnapshot(s.budgetId)).toEqual(before)
      })
    }
  })

  // ==========================================================================
  // G21 - ambiguity
  // ==========================================================================
  describe('G21: two predecessors on the same slot, only the most recently created one is carried', () => {
    it('the newer predecessor link (2900) moves, the older (4100) stays; the figure moves by exactly 2900', async () => {
      const patientId = await newPatient()
      const { itemIds } = await seedBudget(patientId, [4100, 2900])
      const [olderItem, newerItem] = itemIds
      await seedBystander(patientId, 1700)
      const { start, end } = slot()

      const older = await createVisitOk({ patientId, start, end })
      await deleteThroughRoute(older, [olderItem])
      // Created with a link of its own, so this create itself carries nothing.
      const newer = await createVisitOk({ patientId, start, end, body: { budgetItemIds: [newerItem] } })
      expect(await executedLinkOf(olderItem)).toEqual([{ appointmentId: older }])
      expect(
        (await put(`/api/appointments/${newer}/mark-done`, { executedBudgetItemIds: [newerItem] })).status
      ).toBe(200)
      expect((await del(`/api/appointments/${newer}`)).status).toBe(200)

      const createdAts = await prisma.appointment.findMany({
        where: { id: { in: [older, newer] } },
        select: { id: true, createdAt: true },
      })
      const t = (id: string) => createdAts.find((a) => a.id === id)!.createdAt.getTime()
      expect(t(newer)).toBeGreaterThan(t(older))

      await expectMoney(patientId, {
        lines: [{ type: 'appointment', cost: 1700 }],
        totalDebt: 1700,
        totalPaid: 0,
        outstanding: 1700,
        credit: 0,
      })

      const created = await createVisitOk({ patientId, start, end })

      expect(await executedLinkOf(newerItem)).toEqual([{ appointmentId: created }])
      expect(await executedLinkOf(olderItem)).toEqual([{ appointmentId: older }])
      await expectMoney(patientId, {
        lines: [
          { type: 'appointment', cost: 1700 },
          { type: 'budgetItem', cost: 2900 },
        ],
        totalDebt: 4600,
        totalPaid: 0,
        outstanding: 4600,
        credit: 0,
      })
    })
  })
})
