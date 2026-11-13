import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { prisma } from '@dental/database'
import {
  getPatientAccountStatement,
  getPatientBalance,
  listBillableItems,
  type PatientAccountStatement,
} from './payment.service.js'
import { createBudget, updateBudgetItem } from './budget.service.js'
import { restoreAppointment } from './appointment.service.js'
import { confirmExecutedBudgetItems, setAppointmentBudgetItems } from './budget-appointment.service.js'

/**
 * Task #679: `remainingBudgetProjection` must be the exact complement of what
 * getBillableItems charges, so no budget item is ever billed and projected at
 * the same time.
 *
 * The signal is the EXECUTED link on a live, non-superseded appointment, never
 * BudgetItem.status: an item can leave EXECUTED while its link stays, and the
 * link is what bills. Every guard below names, per perturbation site (item
 * status / link presence / appointment isActive / appointment cost /
 * appointment status), which half of the statement moves.
 *
 * Nothing here writes the defect state directly: the item reaches
 * "PENDING with a live EXECUTED link" through setAppointmentBudgetItems ->
 * confirmExecutedBudgetItems -> updateBudgetItem({ status: 'PENDING' }), the
 * three real services, because the premise of the issue is that the API can
 * produce that state. Direct prisma writes are used only for scaffolding
 * (tenant, patient, doctor, appointment) and for the appointment-level
 * perturbations, which never touch an item's status or its links.
 *
 * Prices are DISTINCT per item inside a patient: coinciding amounts would hide
 * a swap, and each projection total below is read back as the exact sum of the
 * prices that must survive the filter.
 */

const DAY = 24 * 60 * 60 * 1000
const BASE = new Date('2026-04-06T15:00:00.000Z').getTime()
const at = (days: number) => new Date(BASE + days * DAY)

describe('remainingBudgetProjection excludes exactly what the EXECUTED link bills (#679)', () => {
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
      data: { name: 'Exec Link Projection', slug: `exec-link-projection-${suffix}` },
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
          firstName: 'Projection',
          lastName: 'Doctor',
          email: `projection-doc-${suffix}@test.com`,
        },
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

  async function newPatient(label: string): Promise<string> {
    seq += 1
    return (
      await prisma.patient.create({ data: { tenantId, firstName: label, lastName: `P${seq}` } })
    ).id
  }

  async function seedAppointment(patientId: string, cost: number | null): Promise<string> {
    const startTime = at(0)
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
        },
      })
    ).id
  }

  async function statement(patientId: string): Promise<PatientAccountStatement> {
    const result = await getPatientAccountStatement(tenantId, patientId)
    if (!result.success) throw new Error(`getPatientAccountStatement failed: ${result.code}`)
    return result.data
  }

  async function balance(patientId: string) {
    const result = await getPatientBalance(tenantId, patientId)
    if (!result.success) throw new Error(`getPatientBalance failed: ${result.code}`)
    return result.data
  }

  async function executedLinkCount(itemId: string): Promise<number> {
    return prisma.budgetItemAppointment.count({ where: { budgetItemId: itemId, role: 'EXECUTED' } })
  }

  /**
   * Builds the state at the heart of #679 for ONE item: PENDING status, a live
   * `role: 'EXECUTED'` link, reached only through the real services. A second
   * item on the same budget is never associated to anything, so every
   * projection total below is a sum of two distinct prices and a filter that
   * swallowed everything could not pass.
   */
  async function buildExecutedThenPendingCase(opts: {
    label: string
    linkedPrice: number
    unlinkedPrice: number
    appointmentCost: number | null
  }): Promise<{
    patientId: string
    budgetId: string
    linkedItemId: string
    unlinkedItemId: string
    appointmentId: string
  }> {
    const patientId = await newPatient(opts.label)
    const appointmentId = await seedAppointment(patientId, opts.appointmentCost)

    const created = await createBudget(tenantId, patientId, {
      items: [
        { description: `linked ${opts.linkedPrice}`, quantity: 1, unitPrice: opts.linkedPrice },
        { description: `unlinked ${opts.unlinkedPrice}`, quantity: 1, unitPrice: opts.unlinkedPrice },
      ],
    })
    if (!created.success) throw new Error(`fixture: createBudget failed: ${created.code}`)
    const budgetId = created.data.id

    const items = await prisma.budgetItem.findMany({
      where: { budgetId },
      orderBy: { order: 'asc' },
      select: { id: true, totalPrice: true },
    })
    expect(items.map((i) => i.totalPrice.toNumber())).toEqual([
      opts.linkedPrice,
      opts.unlinkedPrice,
    ])
    const linkedItemId = items[0].id
    const unlinkedItemId = items[1].id

    // PENDING -> SCHEDULED, with a role=SCHEDULED link.
    const associated = await setAppointmentBudgetItems(tenantId, appointmentId, [linkedItemId], null)
    if (!associated.success) {
      throw new Error(`fixture: setAppointmentBudgetItems failed: ${associated.code}`)
    }
    // SCHEDULED -> EXECUTED, with a role=EXECUTED link.
    const confirmed = await confirmExecutedBudgetItems(tenantId, appointmentId, [linkedItemId], null)
    if (!confirmed.success) {
      throw new Error(`fixture: confirmExecutedBudgetItems failed: ${confirmed.code}`)
    }
    // EXECUTED -> PENDING. ITEM_EXECUTED_REQUIRES_LINK refuses only the inbound
    // transition, so this is accepted and the EXECUTED link survives it.
    const reverted = await updateBudgetItem(tenantId, budgetId, linkedItemId, { status: 'PENDING' })
    if (!reverted.success) throw new Error(`fixture: updateBudgetItem failed: ${reverted.code}`)

    // The fixture state, asserted per perturbation site before any guard reads
    // a figure off it.
    const linked = await prisma.budgetItem.findUniqueOrThrow({
      where: { id: linkedItemId },
      select: { status: true },
    })
    expect(linked.status).toBe('PENDING')
    expect(await executedLinkCount(linkedItemId)).toBe(1)

    const unlinked = await prisma.budgetItem.findUniqueOrThrow({
      where: { id: unlinkedItemId },
      select: { status: true },
    })
    expect(unlinked.status).toBe('PENDING')
    expect(
      await prisma.budgetItemAppointment.count({ where: { budgetItemId: unlinkedItemId } })
    ).toBe(0)

    // Vacuity check: the projection's own budget filter excludes DRAFT and
    // CANCELLED budgets, so a budget that drifted into either would make every
    // guard below pass on an empty aggregate.
    const budget = await prisma.budget.findUniqueOrThrow({
      where: { id: budgetId },
      select: { status: true, isActive: true },
    })
    expect(budget.status).toBe('APPROVED')
    expect(budget.isActive).toBe(true)

    return { patientId, budgetId, linkedItemId, unlinkedItemId, appointmentId }
  }

  // ------------------------------------------------------------------
  // G1 - THE DEFECT. Item A: PENDING, live EXECUTED link, appointment
  // active / non-CANCELLED / no cost. A is billed, so A must NOT be
  // projected. Before the fix the projection read A's status and counted it.
  // ------------------------------------------------------------------
  describe('G1: an item that left EXECUTED but kept its link is billed, so it is not projected', () => {
    let fixture: Awaited<ReturnType<typeof buildExecutedThenPendingCase>>

    beforeAll(async () => {
      fixture = await buildExecutedThenPendingCase({
        label: 'G1',
        linkedPrice: 1100,
        unlinkedPrice: 2200,
        appointmentCost: null,
      })
    })

    it('billing half: the live EXECUTED link bills item A at 1100 although its status is PENDING', async () => {
      const billable = await listBillableItems(tenantId, fixture.patientId)
      expect(billable).toHaveLength(1)
      expect(billable[0]).toMatchObject({
        id: fixture.linkedItemId,
        type: 'budgetItem',
        cost: 1100,
        appointmentId: fixture.appointmentId,
      })
      expect(await balance(fixture.patientId)).toEqual({
        totalDebt: 1100,
        totalPaid: 0,
        outstanding: 1100,
        credit: 0,
      })
    })

    it("projection half: the projection is exactly the unlinked 2200 and excludes A's 1100", async () => {
      expect((await statement(fixture.patientId)).remainingBudgetProjection).toBe(2200)
    })

    it('the statement bills A once: totalBilled 1100 against a projection of 2200, never 3300 on either side', async () => {
      const data = await statement(fixture.patientId)
      expect(data.totalBilled).toBe(1100)
      expect(data.appointmentsDebt).toBe(1100)
      expect(data.totalBilled + data.remainingBudgetProjection).toBe(3300)
    })
  })

  // ------------------------------------------------------------------
  // G2 - THE isActive CLAUSE. Same state as G1, then the appointment is
  // soft-deleted. getBillableItems requires appointment.isActive, so nobody
  // bills A any more and A must come BACK into the projection. Dropping
  // isActive from the projection filter would make A's work vanish from both
  // figures (production: 7 items, 86,500.00, measured 2026-11-12).
  // ------------------------------------------------------------------
  describe('G2: a soft-deleted appointment stops billing the item, so the item is projected again', () => {
    let fixture: Awaited<ReturnType<typeof buildExecutedThenPendingCase>>

    beforeAll(async () => {
      fixture = await buildExecutedThenPendingCase({
        label: 'G2',
        linkedPrice: 1300,
        unlinkedPrice: 2400,
        appointmentCost: null,
      })
      await prisma.appointment.update({
        where: { id: fixture.appointmentId },
        data: { isActive: false },
      })
      // Only the appointment moved: the item is still PENDING with its link.
      expect(await executedLinkCount(fixture.linkedItemId)).toBe(1)
      expect(
        (
          await prisma.budgetItem.findUniqueOrThrow({
            where: { id: fixture.linkedItemId },
            select: { status: true },
          })
        ).status
      ).toBe('PENDING')
    })

    it('billing half: nothing is billed once the appointment is inactive', async () => {
      expect(await listBillableItems(tenantId, fixture.patientId)).toEqual([])
      expect(await balance(fixture.patientId)).toEqual({
        totalDebt: 0,
        totalPaid: 0,
        outstanding: 0,
        credit: 0,
      })
    })

    it('projection half: the item is projected again — 1300 + 2400 = 3700', async () => {
      expect((await statement(fixture.patientId)).remainingBudgetProjection).toBe(3700)
    })
  })

  // ------------------------------------------------------------------
  // G2-R / G2-R-COST - THE INVERSE OF G2 (#685). Start from G2's state (item
  // PENDING, live EXECUTED link, appointment soft-deleted), then restore the
  // appointment through the real restoreAppointment (writes isActive true,
  // status SCHEDULED). The two cases differ on ONE axis: the typed
  // appointment cost. Everything else, including the order of operations, is
  // identical.
  // ------------------------------------------------------------------
  async function buildSoftDeletedThenRestored(opts: {
    label: string
    linkedPrice: number
    unlinkedPrice: number
    appointmentCost: number | null
  }) {
    const fixture = await buildExecutedThenPendingCase(opts)
    // G2's state: only the appointment moves, the item keeps status and link.
    // Every fixture seeds at(0) for the one shared doctor, and restoring runs
    // checkTimeConflict against the other cases' active visits, so this
    // appointment gets a slot of its own first (a slot is not an axis here).
    seq += 1
    const slot = at(100 + seq)
    await prisma.appointment.update({
      where: { id: fixture.appointmentId },
      data: { isActive: false, startTime: slot, endTime: new Date(slot.getTime() + 30 * 60_000) },
    })
    expect(await listBillableItems(tenantId, fixture.patientId)).toEqual([])

    const restored = await restoreAppointment(tenantId, fixture.appointmentId, null)
    if (restored.error) throw new Error(`fixture: restoreAppointment failed: ${restored.error.code}`)

    const appointment = await prisma.appointment.findUniqueOrThrow({
      where: { id: fixture.appointmentId },
      select: { isActive: true, status: true, cost: true },
    })
    expect(appointment.isActive).toBe(true)
    expect(appointment.status).toBe('SCHEDULED')
    expect(appointment.cost?.toNumber() ?? null).toBe(opts.appointmentCost)
    // The item itself was not touched by the restore.
    expect(await executedLinkCount(fixture.linkedItemId)).toBe(1)
    expect(
      (
        await prisma.budgetItem.findUniqueOrThrow({
          where: { id: fixture.linkedItemId },
          select: { status: true },
        })
      ).status
    ).toBe('PENDING')
    return fixture
  }

  describe('G2-R: restoring the soft-deleted appointment moves the item from the projection into totalBilled', () => {
    let fixture: Awaited<ReturnType<typeof buildExecutedThenPendingCase>>

    beforeAll(async () => {
      fixture = await buildSoftDeletedThenRestored({
        label: 'G2-R',
        linkedPrice: 1700,
        unlinkedPrice: 2300,
        appointmentCost: null,
      })
    })

    it('billing half: the item bills 1700 again through its EXECUTED link', async () => {
      const billable = await listBillableItems(tenantId, fixture.patientId)
      expect(billable).toHaveLength(1)
      expect(billable[0]).toMatchObject({
        id: fixture.linkedItemId,
        type: 'budgetItem',
        cost: 1700,
        appointmentId: fixture.appointmentId,
      })
      expect(await balance(fixture.patientId)).toEqual({
        totalDebt: 1700,
        totalPaid: 0,
        outstanding: 1700,
        credit: 0,
      })
    })

    it('projection half: the item leaves the projection, which is exactly the unlinked 2300', async () => {
      expect((await statement(fixture.patientId)).remainingBudgetProjection).toBe(2300)
    })

    it('the statement moves 1700 into totalBilled and never counts it on both sides', async () => {
      const data = await statement(fixture.patientId)
      expect(data.totalBilled).toBe(1700)
      expect(data.totalBilled + data.remainingBudgetProjection).toBe(4000)
    })
  })

  describe('G2-R-COST: restoring with a typed appointment cost bills the visit, not the item (#590)', () => {
    let fixture: Awaited<ReturnType<typeof buildExecutedThenPendingCase>>

    beforeAll(async () => {
      fixture = await buildSoftDeletedThenRestored({
        label: 'G2-R-COST',
        linkedPrice: 1700,
        unlinkedPrice: 2300,
        appointmentCost: 1500,
      })
    })

    it("billing half: the visit's own 1500 bills, as an appointment", async () => {
      const billable = await listBillableItems(tenantId, fixture.patientId)
      expect(billable).toHaveLength(1)
      expect(billable[0]).toMatchObject({
        id: fixture.appointmentId,
        type: 'appointment',
        cost: 1500,
      })
      expect(await balance(fixture.patientId)).toEqual({
        totalDebt: 1500,
        totalPaid: 0,
        outstanding: 1500,
        credit: 0,
      })
    })

    it('billing half: the item does not bill, superseded by the typed cost', async () => {
      const billable = await listBillableItems(tenantId, fixture.patientId)
      expect(billable.map((i) => i.id)).not.toContain(fixture.linkedItemId)
      expect(billable.filter((i) => i.type === 'budgetItem')).toEqual([])
    })

    it('projection half: the item stays projected — 1700 + 2300 = 4000 — while totalBilled is 1500', async () => {
      const data = await statement(fixture.patientId)
      expect(data.remainingBudgetProjection).toBe(4000)
      expect(data.totalBilled).toBe(1500)
    })
  })

  // ------------------------------------------------------------------
  // G3 - THE #590 CLAUSE (NOT_SUPERSEDED_BY_APPOINTMENT_COST). Item C holds a
  // live EXECUTED link on an active, non-CANCELLED appointment with cost > 0.
  // The visit's own cost is the charge, so C is NOT billed as an item and must
  // stay projected. Dropping the clause un-projects C while nobody bills it.
  // ------------------------------------------------------------------
  describe('G3: the visit cost supersedes the item, so the item is not billed and stays projected', () => {
    let fixture: Awaited<ReturnType<typeof buildExecutedThenPendingCase>>

    beforeAll(async () => {
      fixture = await buildExecutedThenPendingCase({
        label: 'G3',
        linkedPrice: 3300,
        unlinkedPrice: 2600,
        appointmentCost: 700,
      })
      const appointment = await prisma.appointment.findUniqueOrThrow({
        where: { id: fixture.appointmentId },
        select: { isActive: true, status: true, cost: true },
      })
      expect(appointment.isActive).toBe(true)
      expect(appointment.status).toBe('SCHEDULED')
      expect(appointment.cost?.toNumber()).toBe(700)
    })

    it("billing half: the appointment's own 700 is the only charge; item C is not billed", async () => {
      const billable = await listBillableItems(tenantId, fixture.patientId)
      expect(billable).toHaveLength(1)
      expect(billable[0]).toMatchObject({
        id: fixture.appointmentId,
        type: 'appointment',
        cost: 700,
      })
      expect(billable.map((i) => i.id)).not.toContain(fixture.linkedItemId)
      expect(await balance(fixture.patientId)).toEqual({
        totalDebt: 700,
        totalPaid: 0,
        outstanding: 700,
        credit: 0,
      })
    })

    it('projection half: C stays projected — 3300 + 2600 = 5900', async () => {
      const data = await statement(fixture.patientId)
      expect(data.remainingBudgetProjection).toBe(5900)
      expect(data.totalBilled).toBe(700)
    })
  })

  // ------------------------------------------------------------------
  // G4 - CANCELLED-BUT-ACTIVE MUST STILL BE EXCLUDED. Item D's link sits on an
  // appointment with isActive true, status CANCELLED and cost > 0. CANCELLED is
  // a member of NOT_SUPERSEDED_BY_APPOINTMENT_COST, so the cost supersedes
  // nothing and D IS billed - hence D must be excluded from the projection.
  // Adding `appointment: { status: { not: 'CANCELLED' } }` here would bill and
  // project D at once: the double count this task removes.
  // ------------------------------------------------------------------
  describe('G4: a link on a cancelled-but-active costed visit still bills, so the item is excluded', () => {
    let fixture: Awaited<ReturnType<typeof buildExecutedThenPendingCase>>

    beforeAll(async () => {
      fixture = await buildExecutedThenPendingCase({
        label: 'G4',
        linkedPrice: 4400,
        unlinkedPrice: 2800,
        appointmentCost: 900,
      })
      await prisma.appointment.update({
        where: { id: fixture.appointmentId },
        data: { status: 'CANCELLED' },
      })
      const appointment = await prisma.appointment.findUniqueOrThrow({
        where: { id: fixture.appointmentId },
        select: { isActive: true, status: true, cost: true },
      })
      expect(appointment.isActive).toBe(true)
      expect(appointment.status).toBe('CANCELLED')
      expect(appointment.cost?.toNumber()).toBe(900)
    })

    it('billing half: the cancelled visit bills nothing of its own, and item D bills 4400', async () => {
      const billable = await listBillableItems(tenantId, fixture.patientId)
      expect(billable).toHaveLength(1)
      expect(billable[0]).toMatchObject({
        id: fixture.linkedItemId,
        type: 'budgetItem',
        cost: 4400,
        appointmentId: fixture.appointmentId,
      })
      expect(await balance(fixture.patientId)).toEqual({
        totalDebt: 4400,
        totalPaid: 0,
        outstanding: 4400,
        credit: 0,
      })
    })

    it('projection half: D is excluded — the projection is exactly the unlinked 2800', async () => {
      const data = await statement(fixture.patientId)
      expect(data.remainingBudgetProjection).toBe(2800)
      expect(data.totalBilled).toBe(4400)
    })
  })

  // ------------------------------------------------------------------
  // G5 - VACUITY. An item with no link at all is not billed and must be
  // projected: the filter above must not swallow ordinary planned work.
  // ------------------------------------------------------------------
  describe('G5: an item with no link at all is projected', () => {
    let patientId: string
    let itemId: string

    beforeAll(async () => {
      patientId = await newPatient('G5')
      const created = await createBudget(tenantId, patientId, {
        items: [{ description: 'planned 2900', quantity: 1, unitPrice: 2900 }],
      })
      if (!created.success) throw new Error(`fixture: createBudget failed: ${created.code}`)
      const item = await prisma.budgetItem.findFirstOrThrow({
        where: { budgetId: created.data.id },
        select: { id: true, status: true, totalPrice: true },
      })
      itemId = item.id
      expect(item.status).toBe('PENDING')
      expect(item.totalPrice.toNumber()).toBe(2900)
      expect(await prisma.budgetItemAppointment.count({ where: { budgetItemId: itemId } })).toBe(0)
      expect(
        (
          await prisma.budget.findUniqueOrThrow({
            where: { id: created.data.id },
            select: { status: true },
          })
        ).status
      ).toBe('APPROVED')
    })

    it('billing half: an unlinked item is not billed', async () => {
      expect(await listBillableItems(tenantId, patientId)).toEqual([])
      expect((await balance(patientId)).totalDebt).toBe(0)
    })

    it('projection half: the unlinked item is projected at 2900', async () => {
      const data = await statement(patientId)
      expect(data.remainingBudgetProjection).toBe(2900)
      expect(data.totalBilled).toBe(0)
    })
  })
})
