import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { prisma } from '@dental/database'
import {
  computeOutstandingByPatient,
  getPatientAccountStatement,
  getPatientBalance,
  listBillableItems,
  type PatientAccountStatement,
} from './payment.service.js'
import { createBudget, updateBudgetItem } from './budget.service.js'
import {
  deleteAppointment,
  restoreAppointment,
  updateAppointment,
} from './appointment.service.js'
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

  // ==================================================================
  // #685 PART 2. The four guards below are the part-2 plan's G3, G4, G5
  // and G8. Three of those four labels were ALREADY TAKEN above by
  // unrelated guards of #679, so the plan's names are carried in each
  // test name in parentheses and the local labels continue the file's
  // own sequence. The mapping, which the PR body and #685 both cite:
  //
  //   plan G3 -> G10   a second EXECUTED link does not double-charge
  //   plan G4 -> G11   the route is refused in the right order
  //   plan G5 -> G12   the typed cost is what blocks recovery
  //   plan G8 -> G13   clearing the cost after the restore leaves the
  //                    payment the restore converted intact
  //
  // No existing guard is renamed, renumbered or altered: a label that
  // means two things is two things to keep true. plan G6 is deliberately
  // not written here (the #602 block in budget-appointment.service.test.ts
  // already covers it), and plan G7 is not written at all — it is gated on
  // a production dry-run this chain cannot run, so it is deferred for an
  // unevaluated condition, not judged unnecessary.
  // ==================================================================

  /** The third money reader of the plan's G3, beside listBillableItems and getPatientBalance. */
  async function outstandingFor(patientId: string) {
    const byPatient = await computeOutstandingByPatient(tenantId)
    return byPatient.get(patientId) ?? { totalDebt: 0, totalPaid: 0, outstanding: 0 }
  }

  /**
   * Every fixture in this file seeds at(0) for the one shared doctor. The
   * part-2 guards call the real restoreAppointment, whose checkTimeConflict
   * runs against the other cases' active visits, so each of them needs a slot
   * of its own. A slot is scaffolding here, never an axis — except in G11,
   * where the collision IS the axis and is built deliberately.
   */
  async function moveAppointment(appointmentId: string, slot: Date): Promise<void> {
    await prisma.appointment.update({
      where: { id: appointmentId },
      data: { startTime: slot, endTime: new Date(slot.getTime() + 30 * 60_000) },
    })
  }

  // ------------------------------------------------------------------
  // G10 (plan G3) - A SECOND EXECUTED LINK MUST NOT DOUBLE-CHARGE.
  // getBillableItems keys budgetCharges by ITEM (BUDGET_ITEM_ONCE_PER_ITEM)
  // and its link query filters appointment.isActive, while getPatientBalance
  // and computeOutstandingByPatient use item-level `some` filters. Measured
  // anyway, on two axes varied SEPARATELY:
  //   (a) number of EXECUTED links on one item: 1 (G10-A) vs 2 (G10-B)
  //   (b) the second link's appointment isActive: true (G10-B) vs false (G10-C)
  // The second visit is deliberately EARLIER than the first, so "the date of
  // the earliest ACTIVE link" is a real discriminator: with both active the
  // charge must carry the second visit's date, and with the second one
  // deactivated it must fall back to the first's.
  // G10-D is the vacuity control: both links inactive -> the item is not
  // billed AT ALL. Without it, "does not double-charge" stays green because
  // nothing billed, which is the trap part 1 fell into.
  // ------------------------------------------------------------------
  async function buildSecondExecutedLink(opts: {
    label: string
    linkedPrice: number
    unlinkedPrice: number
  }) {
    const fixture = await buildExecutedThenPendingCase({
      label: opts.label,
      linkedPrice: opts.linkedPrice,
      unlinkedPrice: opts.unlinkedPrice,
      appointmentCost: null,
    })
    seq += 1
    const firstStart = at(200 + seq)
    await moveAppointment(fixture.appointmentId, firstStart)

    // The SECOND visit, earlier in time, reaches its own EXECUTED link on the
    // SAME item through the real services: setAppointmentBudgetItems only
    // touches SCHEDULED links of its own appointment, so the first visit's
    // EXECUTED link survives this and the item ends with two.
    seq += 1
    const secondStart = at(100 + seq)
    const secondAppointmentId = (
      await prisma.appointment.create({
        data: {
          tenantId,
          patientId: fixture.patientId,
          doctorId,
          startTime: secondStart,
          endTime: new Date(secondStart.getTime() + 30 * 60_000),
          duration: 30,
          cost: null,
        },
      })
    ).id
    const associated = await setAppointmentBudgetItems(
      tenantId,
      secondAppointmentId,
      [fixture.linkedItemId],
      null
    )
    if (!associated.success) {
      throw new Error(`fixture: setAppointmentBudgetItems failed: ${associated.code}`)
    }
    const confirmed = await confirmExecutedBudgetItems(
      tenantId,
      secondAppointmentId,
      [fixture.linkedItemId],
      null
    )
    if (!confirmed.success) {
      throw new Error(`fixture: confirmExecutedBudgetItems failed: ${confirmed.code}`)
    }
    const reverted = await updateBudgetItem(tenantId, fixture.budgetId, fixture.linkedItemId, {
      status: 'PENDING',
    })
    if (!reverted.success) throw new Error(`fixture: updateBudgetItem failed: ${reverted.code}`)

    expect(await executedLinkCount(fixture.linkedItemId)).toBe(2)
    expect(secondStart.getTime()).toBeLessThan(firstStart.getTime())
    // Vacuity check on the projection's own budget filter: a budget that
    // drifted into DRAFT or CANCELLED would make every figure below pass on an
    // empty aggregate.
    const budget = await prisma.budget.findUniqueOrThrow({
      where: { id: fixture.budgetId },
      select: { status: true, isActive: true },
    })
    expect(['APPROVED', 'PARTIAL']).toContain(budget.status)
    expect(budget.isActive).toBe(true)

    return { ...fixture, secondAppointmentId, firstStart, secondStart }
  }

  describe('G10-A (plan G3): the control — ONE EXECUTED link bills the item exactly once', () => {
    let fixture: Awaited<ReturnType<typeof buildExecutedThenPendingCase>>
    let start: Date

    beforeAll(async () => {
      fixture = await buildExecutedThenPendingCase({
        label: 'G10-A',
        linkedPrice: 5100,
        unlinkedPrice: 2100,
        appointmentCost: null,
      })
      seq += 1
      start = at(200 + seq)
      await moveAppointment(fixture.appointmentId, start)
      expect(await executedLinkCount(fixture.linkedItemId)).toBe(1)
    })

    it('all three money readers charge 5100 once, dated by the only link', async () => {
      const billable = await listBillableItems(tenantId, fixture.patientId)
      expect(billable).toHaveLength(1)
      expect(billable[0]).toMatchObject({
        id: fixture.linkedItemId,
        type: 'budgetItem',
        cost: 5100,
        appointmentId: fixture.appointmentId,
      })
      expect(billable[0].date.getTime()).toBe(start.getTime())
      expect(await balance(fixture.patientId)).toEqual({
        totalDebt: 5100,
        totalPaid: 0,
        outstanding: 5100,
        credit: 0,
      })
      expect(await outstandingFor(fixture.patientId)).toEqual({
        totalDebt: 5100,
        totalPaid: 0,
        outstanding: 5100,
      })
    })

    it('the statement bills 5100 against a projection of exactly the unlinked 2100', async () => {
      const data = await statement(fixture.patientId)
      expect(data.totalBilled).toBe(5100)
      expect(data.remainingBudgetProjection).toBe(2100)
    })
  })

  describe('G10-B (plan G3): TWO active EXECUTED links still bill the item once, at the earlier link', () => {
    let fixture: Awaited<ReturnType<typeof buildSecondExecutedLink>>

    beforeAll(async () => {
      fixture = await buildSecondExecutedLink({
        label: 'G10-B',
        linkedPrice: 5200,
        unlinkedPrice: 2200,
      })
    })

    it('all three money readers charge 5200 ONCE, never 10400', async () => {
      const billable = await listBillableItems(tenantId, fixture.patientId)
      expect(billable).toHaveLength(1)
      expect(billable[0]).toMatchObject({ id: fixture.linkedItemId, cost: 5200 })
      expect(await balance(fixture.patientId)).toEqual({
        totalDebt: 5200,
        totalPaid: 0,
        outstanding: 5200,
        credit: 0,
      })
      expect(await outstandingFor(fixture.patientId)).toEqual({
        totalDebt: 5200,
        totalPaid: 0,
        outstanding: 5200,
      })
    })

    it('the charge carries the EARLIER active link: its date and its appointment', async () => {
      const billable = await listBillableItems(tenantId, fixture.patientId)
      expect(billable[0].appointmentId).toBe(fixture.secondAppointmentId)
      expect(billable[0].date.getTime()).toBe(fixture.secondStart.getTime())
    })

    it('the statement counts 5200 once, with a projection of exactly the unlinked 2200', async () => {
      const data = await statement(fixture.patientId)
      expect(data.totalBilled).toBe(5200)
      expect(data.remainingBudgetProjection).toBe(2200)
      expect(data.totalBilled + data.remainingBudgetProjection).toBe(7400)
    })
  })

  describe('G10-C (plan G3): with the SECOND link’s visit deleted, the charge falls back to the first', () => {
    let fixture: Awaited<ReturnType<typeof buildSecondExecutedLink>>

    beforeAll(async () => {
      fixture = await buildSecondExecutedLink({
        label: 'G10-C',
        linkedPrice: 5300,
        unlinkedPrice: 2300,
      })
      // ONE perturbation: the second visit goes inactive. The link itself stays.
      await prisma.appointment.update({
        where: { id: fixture.secondAppointmentId },
        data: { isActive: false },
      })
      expect(await executedLinkCount(fixture.linkedItemId)).toBe(2)
    })

    it('still exactly one charge of 5300 in all three readers', async () => {
      const billable = await listBillableItems(tenantId, fixture.patientId)
      expect(billable).toHaveLength(1)
      expect(billable[0]).toMatchObject({ id: fixture.linkedItemId, cost: 5300 })
      expect(await balance(fixture.patientId)).toEqual({
        totalDebt: 5300,
        totalPaid: 0,
        outstanding: 5300,
        credit: 0,
      })
      expect(await outstandingFor(fixture.patientId)).toEqual({
        totalDebt: 5300,
        totalPaid: 0,
        outstanding: 5300,
      })
    })

    it('the charge now carries the FIRST visit, the only active one', async () => {
      const billable = await listBillableItems(tenantId, fixture.patientId)
      expect(billable[0].appointmentId).toBe(fixture.appointmentId)
      expect(billable[0].date.getTime()).toBe(fixture.firstStart.getTime())
    })

    it('the projection is still exactly the unlinked 2300', async () => {
      expect((await statement(fixture.patientId)).remainingBudgetProjection).toBe(2300)
    })
  })

  describe('G10-D (plan G3): VACUITY — with BOTH links on inactive visits the item is not billed at all', () => {
    let fixture: Awaited<ReturnType<typeof buildSecondExecutedLink>>

    beforeAll(async () => {
      fixture = await buildSecondExecutedLink({
        label: 'G10-D',
        linkedPrice: 5400,
        unlinkedPrice: 2400,
      })
      await prisma.appointment.updateMany({
        where: { id: { in: [fixture.appointmentId, fixture.secondAppointmentId] } },
        data: { isActive: false },
      })
      expect(await executedLinkCount(fixture.linkedItemId)).toBe(2)
    })

    it('nothing is billed: the "billed once" assertions above are not green because nothing billed', async () => {
      expect(await listBillableItems(tenantId, fixture.patientId)).toEqual([])
      expect(await balance(fixture.patientId)).toEqual({
        totalDebt: 0,
        totalPaid: 0,
        outstanding: 0,
        credit: 0,
      })
      expect(await outstandingFor(fixture.patientId)).toEqual({
        totalDebt: 0,
        totalPaid: 0,
        outstanding: 0,
      })
    })

    it('and the item comes back into the projection — 5400 + 2400 = 7800', async () => {
      const data = await statement(fixture.patientId)
      expect(data.remainingBudgetProjection).toBe(7800)
      expect(data.totalBilled).toBe(0)
    })
  })

  // ------------------------------------------------------------------
  // G11 (plan G4) - THE ROUTE WORKS, AND IS REFUSED IN THE RIGHT ORDER.
  // Through the real services, from G2's state: restoreAppointment returns
  // TIME_CONFLICT while the re-creation is active, and succeeds once that
  // re-creation is soft-deleted. ONE axis, the replacement's isActive, and
  // two outcomes on the SAME record — which is what makes step 1 of the
  // runbook (soft-delete the empty duplicate FIRST) load-bearing rather than
  // a precaution.
  // ------------------------------------------------------------------
  describe('G11 (plan G4): restore is refused while the re-creation is active and succeeds once it is deleted', () => {
    let fixture: Awaited<ReturnType<typeof buildExecutedThenPendingCase>>
    let replacementId: string
    let slot: Date

    beforeAll(async () => {
      fixture = await buildExecutedThenPendingCase({
        label: 'G11',
        linkedPrice: 6100,
        unlinkedPrice: 2600,
        appointmentCost: null,
      })
      seq += 1
      slot = at(300 + seq)
      await moveAppointment(fixture.appointmentId, slot)

      // The original is soft-deleted through the real service, so this is the
      // production state and not a hand-written one.
      const deleted = await deleteAppointment(tenantId, fixture.appointmentId, null)
      if (deleted.error) throw new Error(`fixture: deleteAppointment failed: ${deleted.error.code}`)
      expect(await listBillableItems(tenantId, fixture.patientId)).toEqual([])

      // The re-creation: same patient, same doctor, same minute, active and
      // empty of money — the shape the production dry-run measures in (N1).
      replacementId = (
        await prisma.appointment.create({
          data: {
            tenantId,
            patientId: fixture.patientId,
            doctorId,
            startTime: slot,
            endTime: new Date(slot.getTime() + 30 * 60_000),
            duration: 30,
            status: 'SCHEDULED',
            cost: null,
          },
        })
      ).id
    })

    it('with the re-creation ACTIVE, restoreAppointment refuses with TIME_CONFLICT', async () => {
      const refused = await restoreAppointment(tenantId, fixture.appointmentId, null)
      expect(refused.error?.code).toBe('TIME_CONFLICT')
      expect(refused.appointment).toBeUndefined()
      // The refusal left the record alone: still deleted, still billing nothing.
      expect(
        (
          await prisma.appointment.findUniqueOrThrow({
            where: { id: fixture.appointmentId },
            select: { isActive: true },
          })
        ).isActive
      ).toBe(false)
      expect(await listBillableItems(tenantId, fixture.patientId)).toEqual([])
    })

    it('with the re-creation SOFT-DELETED, the same call succeeds and the item bills 6100 again', async () => {
      const removed = await deleteAppointment(tenantId, replacementId, null)
      if (removed.error) throw new Error(`deleteAppointment failed: ${removed.error.code}`)

      const restored = await restoreAppointment(tenantId, fixture.appointmentId, null)
      expect(restored.error).toBeUndefined()
      expect(restored.appointment?.isActive).toBe(true)
      expect(restored.appointment?.status).toBe('SCHEDULED')

      const billable = await listBillableItems(tenantId, fixture.patientId)
      expect(billable).toHaveLength(1)
      expect(billable[0]).toMatchObject({
        id: fixture.linkedItemId,
        type: 'budgetItem',
        cost: 6100,
        appointmentId: fixture.appointmentId,
      })
      expect((await balance(fixture.patientId)).totalDebt).toBe(6100)
    })
  })

  // ------------------------------------------------------------------
  // G12 (plan G5) - THE TYPED COST IS WHAT BLOCKS RECOVERY, and clearing it
  // is what finishes the route. From the restored state of G2-R-COST: with
  // cost = 1500 the item reads 0 and the visit bills; with the cost cleared
  // through the real updateAppointment (the payload
  // AppointmentFormModal sends for an emptied field is cost: null) the item
  // bills and the visit does not. ONE axis: the cost. The pre-clearing
  // assertions are their own test, so the post-clearing ones cannot be green
  // on a fixture where nothing ever billed.
  // ------------------------------------------------------------------
  describe('G12 (plan G5): the item bills once the typed visit cost is cleared, and not before', () => {
    let fixture: Awaited<ReturnType<typeof buildExecutedThenPendingCase>>

    beforeAll(async () => {
      fixture = await buildSoftDeletedThenRestored({
        label: 'G12',
        linkedPrice: 7100,
        unlinkedPrice: 2700,
        appointmentCost: 1500,
      })
    })

    it('BEFORE: the typed 1500 is the charge and the item reads 0', async () => {
      const billable = await listBillableItems(tenantId, fixture.patientId)
      expect(billable).toHaveLength(1)
      expect(billable[0]).toMatchObject({
        id: fixture.appointmentId,
        type: 'appointment',
        cost: 1500,
      })
      expect(billable.filter((i) => i.type === 'budgetItem')).toEqual([])
      expect((await balance(fixture.patientId)).totalDebt).toBe(1500)
      expect((await statement(fixture.patientId)).remainingBudgetProjection).toBe(9800)
    })

    describe('after clearing the Costo field through updateAppointment', () => {
      beforeAll(async () => {
        const cleared = await updateAppointment(tenantId, fixture.appointmentId, { cost: null }, null)
        if (cleared.error) throw new Error(`updateAppointment failed: ${cleared.error.code}`)
        expect(
          (
            await prisma.appointment.findUniqueOrThrow({
              where: { id: fixture.appointmentId },
              select: { cost: true },
            })
          ).cost
        ).toBeNull()
      })

      it('AFTER: the item bills 7100 and the visit bills nothing of its own', async () => {
        const billable = await listBillableItems(tenantId, fixture.patientId)
        expect(billable).toHaveLength(1)
        expect(billable[0]).toMatchObject({
          id: fixture.linkedItemId,
          type: 'budgetItem',
          cost: 7100,
          appointmentId: fixture.appointmentId,
        })
        expect(billable.filter((i) => i.type === 'appointment')).toEqual([])
      })

      it('AFTER: the balance is the item price, and the projection is exactly the unlinked 2700', async () => {
        expect(await balance(fixture.patientId)).toEqual({
          totalDebt: 7100,
          totalPaid: 0,
          outstanding: 7100,
          credit: 0,
        })
        const data = await statement(fixture.patientId)
        expect(data.totalBilled).toBe(7100)
        expect(data.remainingBudgetProjection).toBe(2700)
      })
    })
  })

  // ------------------------------------------------------------------
  // G13 (plan G8) - CLEARING THE COST AFTER THE RESTORE MUST NOT DISTURB THE
  // PAYMENT THE RESTORE JUST CONVERTED. This is the one thing in the part-2
  // plan that is not read off the code, and it is the #639 shape: a
  // correct-looking write that stripped charges while payments stayed.
  // Sequence, all through the real services on ONE record: a stranded item on
  // an appointment that carries a typed cost AND a payment earmarked to it ->
  // deleteAppointment (convertAppointmentPaymentsToAdvance turns it into an
  // ADVANCE) -> restoreAppointment (restoreAppointmentPaymentsFromAdvance
  // turns it back) -> clear the cost.
  // Axes varied SEPARATELY, because "a payment is present" and "the record is
  // paid" are co-present if the payment always covers the cost:
  //   (a) converted payment present (G13-A, G13-B) vs absent (G13-C)
  //   (b) isPaid true (G13-A: payment == cost) vs false with a payment
  //       present (G13-B: payment < cost)
  // The pre-clearing state is asserted in its own test in every case, which
  // is the vacuity control the plan asks for: a green after the clearing
  // cannot come from nothing having moved, because the before-state is
  // measured and is different.
  // FALSIFIER: any payment that disappears, deactivates, changes amount or
  // reverts to ADVANCE means step 3 is not safe in this order and the route
  // goes back to the product lead.
  // ------------------------------------------------------------------
  async function buildConvertedPaymentThenRestored(opts: {
    label: string
    linkedPrice: number
    unlinkedPrice: number
    appointmentCost: number
    paidAmount: number | null
  }) {
    const fixture = await buildExecutedThenPendingCase({
      label: opts.label,
      linkedPrice: opts.linkedPrice,
      unlinkedPrice: opts.unlinkedPrice,
      appointmentCost: opts.appointmentCost,
    })
    seq += 1
    const slot = at(400 + seq)
    await moveAppointment(fixture.appointmentId, slot)

    if (opts.paidAmount !== null) {
      // The real auto-payment path: updateAppointment records a
      // kind=APPOINTMENT payment linked to this appointment.
      const paid = await updateAppointment(
        tenantId,
        fixture.appointmentId,
        { paidAmount: opts.paidAmount },
        null
      )
      if (paid.error) throw new Error(`fixture: updateAppointment failed: ${paid.error.code}`)
      const seeded = await prisma.patientPayment.findFirstOrThrow({
        where: { tenantId, appointmentId: fixture.appointmentId },
        select: { kind: true, isActive: true, amount: true },
      })
      expect(seeded).toMatchObject({ kind: 'APPOINTMENT', isActive: true })
      expect(seeded.amount.toNumber()).toBe(opts.paidAmount)
    }

    const deleted = await deleteAppointment(tenantId, fixture.appointmentId, null)
    if (deleted.error) throw new Error(`fixture: deleteAppointment failed: ${deleted.error.code}`)
    if (opts.paidAmount !== null) {
      // The conversion the restore will have to undo.
      const converted = await prisma.patientPayment.findFirstOrThrow({
        where: { tenantId, appointmentId: fixture.appointmentId },
        select: { kind: true, isActive: true },
      })
      expect(converted).toMatchObject({ kind: 'ADVANCE', isActive: true })
    }

    const restored = await restoreAppointment(tenantId, fixture.appointmentId, null)
    if (restored.error) throw new Error(`fixture: restoreAppointment failed: ${restored.error.code}`)

    const appointment = await prisma.appointment.findUniqueOrThrow({
      where: { id: fixture.appointmentId },
      select: { isActive: true, status: true, cost: true, isPaid: true },
    })
    expect(appointment.isActive).toBe(true)
    expect(appointment.cost?.toNumber()).toBe(opts.appointmentCost)

    // The row's IDENTITY, read before the clearing write. kind/amount/isActive
    // cannot tell "left alone" from "deleted and re-created with the same
    // values", and a re-created row loses its id, its createdAt and — by
    // cascade — its PatientPaymentEvent audit trail, which is the
    // strip-and-restate shape of #639 the falsifier has to catch.
    const paymentAfterRestore =
      opts.paidAmount === null
        ? null
        : await prisma.patientPayment.findFirstOrThrow({
            where: { tenantId, appointmentId: fixture.appointmentId },
            select: { id: true, createdAt: true },
          })
    const eventsAfterRestore = paymentAfterRestore
      ? await prisma.patientPaymentEvent.count({ where: { paymentId: paymentAfterRestore.id } })
      : 0

    return {
      ...fixture,
      isPaidAfterRestore: appointment.isPaid,
      paymentAfterRestore,
      eventsAfterRestore,
    }
  }

  async function paymentRowFor(appointmentId: string) {
    const payment = await prisma.patientPayment.findFirst({
      where: { tenantId, appointmentId },
      select: { kind: true, isActive: true, amount: true, appointmentId: true },
    })
    return payment
      ? {
          kind: payment.kind,
          isActive: payment.isActive,
          amount: payment.amount.toNumber(),
          appointmentId: payment.appointmentId,
        }
      : null
  }

  describe('G13-A (plan G8): payment present and equal to the cost (isPaid true)', () => {
    let fixture: Awaited<ReturnType<typeof buildConvertedPaymentThenRestored>>

    beforeAll(async () => {
      fixture = await buildConvertedPaymentThenRestored({
        label: 'G13-A',
        linkedPrice: 8100,
        unlinkedPrice: 2800,
        appointmentCost: 1500,
        paidAmount: 1500,
      })
    })

    it('BEFORE the clearing: the restore gave the payment back as kind APPOINTMENT and the visit bills 1500', async () => {
      expect(await paymentRowFor(fixture.appointmentId)).toEqual({
        kind: 'APPOINTMENT',
        isActive: true,
        amount: 1500,
        appointmentId: fixture.appointmentId,
      })
      expect(fixture.isPaidAfterRestore).toBe(true)
      expect(await balance(fixture.patientId)).toEqual({
        totalDebt: 1500,
        totalPaid: 1500,
        outstanding: 0,
        credit: 0,
      })
    })

    describe('after clearing the Costo field', () => {
      beforeAll(async () => {
        const cleared = await updateAppointment(tenantId, fixture.appointmentId, { cost: null }, null)
        // A cost-only payload is NOT refused on an already-paid record:
        // CANNOT_UNMARK_PAID needs an explicit isPaid: false, which this
        // payload does not carry. What the FULL edit-modal payload does on a
        // paid record is the plan's G7, deferred for an unevaluated condition.
        if (cleared.error) throw new Error(`updateAppointment failed: ${cleared.error.code}`)
      })

      it('the payment is untouched: same row, still active, still 1500, still kind APPOINTMENT', async () => {
        expect(await paymentRowFor(fixture.appointmentId)).toEqual({
          kind: 'APPOINTMENT',
          isActive: true,
          amount: 1500,
          appointmentId: fixture.appointmentId,
        })
        expect(
          await prisma.patientPayment.count({ where: { tenantId, patientId: fixture.patientId } })
        ).toBe(1)
      })

      it('the payment is the SAME ROW: same id and same createdAt, not a re-created copy', async () => {
        const row = await prisma.patientPayment.findFirstOrThrow({
          where: { tenantId, appointmentId: fixture.appointmentId },
          select: { id: true, createdAt: true },
        })
        expect(row.id).toBe(fixture.paymentAfterRestore?.id)
        expect(row.createdAt.getTime()).toBe(fixture.paymentAfterRestore?.createdAt.getTime())
      })

      it('the payment keeps its audit trail: the same PatientPaymentEvent rows, and there were some', async () => {
        // Vacuity first: a count of 0 before the clearing would make the
        // equality below pass on an empty trail.
        expect(fixture.eventsAfterRestore).toBeGreaterThan(0)
        expect(
          await prisma.patientPaymentEvent.count({
            where: { paymentId: fixture.paymentAfterRestore?.id },
          })
        ).toBe(fixture.eventsAfterRestore)
      })

      it('the balance moved by exactly the item price minus the cleared cost: 8100 - 1500 = 6600', async () => {
        expect(await balance(fixture.patientId)).toEqual({
          totalDebt: 8100,
          totalPaid: 1500,
          outstanding: 6600,
          credit: 0,
        })
        const billable = await listBillableItems(tenantId, fixture.patientId)
        expect(billable).toHaveLength(1)
        expect(billable[0]).toMatchObject({ id: fixture.linkedItemId, cost: 8100 })
      })
    })
  })

  describe('G13-B (plan G8): payment present but SMALLER than the cost (isPaid false)', () => {
    let fixture: Awaited<ReturnType<typeof buildConvertedPaymentThenRestored>>

    beforeAll(async () => {
      fixture = await buildConvertedPaymentThenRestored({
        label: 'G13-B',
        linkedPrice: 8200,
        unlinkedPrice: 2900,
        appointmentCost: 1500,
        paidAmount: 500,
      })
    })

    it('BEFORE the clearing: the payment is back as kind APPOINTMENT at 500 and the record is NOT paid', async () => {
      expect(await paymentRowFor(fixture.appointmentId)).toEqual({
        kind: 'APPOINTMENT',
        isActive: true,
        amount: 500,
        appointmentId: fixture.appointmentId,
      })
      expect(fixture.isPaidAfterRestore).toBe(false)
      expect(await balance(fixture.patientId)).toEqual({
        totalDebt: 1500,
        totalPaid: 500,
        outstanding: 1000,
        credit: 0,
      })
    })

    describe('after clearing the Costo field', () => {
      beforeAll(async () => {
        const cleared = await updateAppointment(tenantId, fixture.appointmentId, { cost: null }, null)
        if (cleared.error) throw new Error(`updateAppointment failed: ${cleared.error.code}`)
      })

      it('the payment is untouched: still active, still 500, still kind APPOINTMENT', async () => {
        expect(await paymentRowFor(fixture.appointmentId)).toEqual({
          kind: 'APPOINTMENT',
          isActive: true,
          amount: 500,
          appointmentId: fixture.appointmentId,
        })
      })

      it('the payment is the SAME ROW: same id and same createdAt, not a re-created copy', async () => {
        const row = await prisma.patientPayment.findFirstOrThrow({
          where: { tenantId, appointmentId: fixture.appointmentId },
          select: { id: true, createdAt: true },
        })
        expect(row.id).toBe(fixture.paymentAfterRestore?.id)
        expect(row.createdAt.getTime()).toBe(fixture.paymentAfterRestore?.createdAt.getTime())
      })

      it('the payment keeps its audit trail: the same PatientPaymentEvent rows, and there were some', async () => {
        // Vacuity first: a count of 0 before the clearing would make the
        // equality below pass on an empty trail.
        expect(fixture.eventsAfterRestore).toBeGreaterThan(0)
        expect(
          await prisma.patientPaymentEvent.count({
            where: { paymentId: fixture.paymentAfterRestore?.id },
          })
        ).toBe(fixture.eventsAfterRestore)
      })

      it('the balance moved by exactly 8200 - 1500 = 6700 of debt, with the 500 still paid', async () => {
        expect(await balance(fixture.patientId)).toEqual({
          totalDebt: 8200,
          totalPaid: 500,
          outstanding: 7700,
          credit: 0,
        })
      })
    })
  })

  describe('G13-C (plan G8): no payment at all — the other end of the presence axis', () => {
    let fixture: Awaited<ReturnType<typeof buildConvertedPaymentThenRestored>>

    beforeAll(async () => {
      fixture = await buildConvertedPaymentThenRestored({
        label: 'G13-C',
        linkedPrice: 8300,
        unlinkedPrice: 3000,
        appointmentCost: 1500,
        paidAmount: null,
      })
    })

    it('BEFORE the clearing: there is no payment to convert, and the visit bills 1500 unpaid', async () => {
      expect(await paymentRowFor(fixture.appointmentId)).toBeNull()
      expect(await balance(fixture.patientId)).toEqual({
        totalDebt: 1500,
        totalPaid: 0,
        outstanding: 1500,
        credit: 0,
      })
    })

    describe('after clearing the Costo field', () => {
      beforeAll(async () => {
        const cleared = await updateAppointment(tenantId, fixture.appointmentId, { cost: null }, null)
        if (cleared.error) throw new Error(`updateAppointment failed: ${cleared.error.code}`)
      })

      it('no payment is invented by the clearing write', async () => {
        expect(await paymentRowFor(fixture.appointmentId)).toBeNull()
        expect(
          await prisma.patientPayment.count({ where: { tenantId, patientId: fixture.patientId } })
        ).toBe(0)
      })

      it('the balance moved by exactly 8300 - 1500 = 6800', async () => {
        expect(await balance(fixture.patientId)).toEqual({
          totalDebt: 8300,
          totalPaid: 0,
          outstanding: 8300,
          credit: 0,
        })
      })
    })
  })
})
