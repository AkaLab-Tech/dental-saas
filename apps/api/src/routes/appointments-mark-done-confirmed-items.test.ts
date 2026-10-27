/**
 * Task #642: the response of the `mark-done` that CONFIRMS executed budget
 * items must describe the EXECUTED links that same request just created.
 *
 * THE DEFECT THIS FILE OWNS. `PUT /:id/mark-done` used to run, in order:
 *   1. validateExecutableBudgetItems  — validation only, no writes
 *   2. markAppointmentDone            — WHERE THE RESPONSE OBJECT IS BUILT
 *                                       (its FIFO run happens here)
 *   3. confirmExecutedBudgetItems     — WHERE THE `EXECUTED` ROWS ARE CREATED
 *                                       (ends with recalculatePaidStatus)
 *   4. res.json(<the object built at step 2>)
 * so `budgetItems` was `undefined` for exactly the items the same request had
 * just confirmed, and `paidAmount`/`outstanding`/`isPaid` were pre-charge too:
 * mergeAllocation sets all four from one map, and that map was built before the
 * new billable items existed. The client half is
 * apps/app/src/stores/appointments.store.ts, whose `completeAppointment` swaps
 * the write response into the row wholesale with no refetch — so the agenda
 * card showed no amount until something else refetched.
 *
 * The fix re-reads through getAppointmentById after a successful confirmation.
 *
 * GUARD LIST (the numbering is the task's, kept across files):
 *   guard 1 — a confirming mark-done returns the aggregate of the items it just
 *             executed. Run on BOTH fixtures: nothing paid, and a 4000 advance.
 *   guard 3 — a plain mark-done (no executedBudgetItemIds) is unchanged.
 *   guard 4 — a rejected id still leaves the appointment SCHEDULED in the
 *             DATABASE (restated here from appointments.test.ts so this fix's
 *             guard set stands on its own).
 *   guard 5 — GET /by-patient/:patientId read back after the same mark-done,
 *             each figure against its OWN literal.
 * guard 2 lives in apps/app/src/stores/appointments.store.test.ts.
 *
 * WHY BOTH FIXTURES, ALWAYS. On a no-payment fixture a stale (pre-charge) FIFO
 * and a correct (post-charge) one both report `paidAmount: 0` /
 * `outstanding: 4000`, so a guard that ran only there is satisfied by the
 * rejected "thread the summary in" approach. On the 4000-advance fixture the
 * stale reading still says 0 covered / 4000 outstanding while the correct one
 * says 4000 covered / 0 outstanding. The advance fixture is the one that
 * discriminates; the no-payment one is kept as the vacuity check.
 *
 * KNOWN, APPROVED CONSEQUENCE. On a confirming mark-done for a patient with
 * credit, `budgetItems.paidAmount` now goes UP and `budgetItems.outstanding`
 * DOWN relative to the old response. Those are the post-charge figures,
 * identical to what GET /:id and GET /by-patient/:patientId return a moment
 * later. Numbers moving is the fix working, not a regression.
 *
 * FIXTURE REACHABILITY. Nothing here writes a budgetItemAppointment row by
 * hand. Every EXECUTED link is produced by the real two-step production flow:
 *   PUT /api/appointments/:id            { budgetItemIds: [...] }          -> SCHEDULED
 *   PUT /api/appointments/:id/mark-done  { executedBudgetItemIds: [...] }  -> EXECUTED
 * and the SCHEDULED pre-state is asserted before the confirming call, so no
 * guard certifies a state the API cannot produce.
 *
 * Records are pinned by identity (the id returned by the fixture), never by
 * position in a list. Figures, dates and synthetic ids only — no real patient
 * data.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { api } from '../test/http.js'
import { prisma } from '@dental/database'
import { hashPassword } from '../services/auth.service.js'
import { generateToken } from '../test/tokens.js'

interface ItemsAggregate {
  count: number
  cost: number
  paidAmount: number
  outstanding: number
}

interface AppointmentRow {
  id: string
  status: string
  notes: string | null
  cost: number | string | null
  isPaid: boolean
  budgetItems?: ItemsAggregate
  paidAmount?: number
  outstanding?: number
}

describe('Task #642: a confirming mark-done describes the items it just executed', () => {
  let tenantId: string
  let adminToken: string
  let doctorId: string
  let dayOffset = 1
  let patientSeq = 0
  const suffix = Date.now()

  beforeAll(async () => {
    const tenant = await prisma.tenant.create({
      data: { name: 'Test Clinic MarkDone Items', slug: `test-clinic-markdone-items-${suffix}` },
    })
    tenantId = tenant.id
    const admin = await prisma.user.create({
      data: {
        email: `admin-markdone-items-${suffix}@test.com`,
        passwordHash: await hashPassword('AdminPass123!'),
        firstName: 'Admin',
        lastName: 'User',
        role: 'ADMIN',
        tenantId,
      },
    })
    adminToken = generateToken(admin.id, tenantId, 'ADMIN')
    doctorId = (
      await prisma.doctor.create({
        data: {
          tenantId,
          firstName: 'Dr. MarkDone',
          lastName: 'Doctor',
          email: `doctor-markdone-items-${suffix}@test.com`,
          specialty: 'General Dentistry',
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
    await prisma.refreshToken.deleteMany({ where: { user: { tenantId } } })
    await prisma.user.deleteMany({ where: { tenantId } })
    await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {})
  })

  // Every case starts from an empty tenant: a FIFO run is per patient, and a
  // leftover payment of a previous case would move another case's figures.
  beforeEach(async () => {
    await prisma.patientPayment.deleteMany({ where: { tenantId } })
    await prisma.appointment.deleteMany({ where: { tenantId } })
    await prisma.budget.deleteMany({ where: { tenantId } })
    await prisma.patient.deleteMany({ where: { tenantId } })
    dayOffset = 1
  })

  // --------------------------------------------------------------------------
  // Fixture helpers
  // --------------------------------------------------------------------------

  function get(path: string) {
    return api().get(path).set('Authorization', `Bearer ${adminToken}`)
  }

  function post(path: string, body: Record<string, unknown>) {
    return api().post(path).set('Authorization', `Bearer ${adminToken}`).send(body)
  }

  function put(path: string, body: Record<string, unknown>) {
    return api().put(path).set('Authorization', `Bearer ${adminToken}`).send(body)
  }

  async function newPatient(): Promise<string> {
    patientSeq += 1
    return (
      await prisma.patient.create({
        data: { tenantId, firstName: 'Fixture', lastName: `MarkDone${suffix}-${patientSeq}` },
      })
    ).id
  }

  function slot() {
    const start = new Date()
    start.setDate(start.getDate() + dayOffset++)
    start.setHours(10, 0, 0, 0)
    return { start, end: new Date(start.getTime() + 30 * 60 * 1000) }
  }

  /** A PENDING item of `price` in a fresh APPROVED, active budget. */
  async function seedPendingItem(patientId: string, price: number): Promise<string> {
    const budget = await prisma.budget.create({
      data: { tenantId, patientId, status: 'APPROVED', isActive: true },
    })
    return (
      await prisma.budgetItem.create({
        data: {
          budgetId: budget.id,
          description: `item ${price}`,
          unitPrice: price,
          totalPrice: price,
          quantity: 1,
          status: 'PENDING',
        },
      })
    ).id
  }

  async function createAppointment(
    patientId: string,
    body: Record<string, unknown> = {}
  ): Promise<string> {
    const { start, end } = slot()
    const res = await post('/api/appointments', {
      patientId,
      doctorId,
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      ...body,
    })
    expect(res.status).toBe(201)
    return res.body.data.id as string
  }

  /**
   * THE fixture of this task: a costless visit with two SCHEDULED items of
   * 2500 and 1500, confirmed EXECUTED by the mark-done under test. Two items
   * (not one) so `count` cannot be right by luck, and two different prices so
   * the total 4000 repeats neither price.
   *
   * `advance` is paid BEFORE the confirming call, so the patient has credit
   * that the pre-charge FIFO run cannot have attributed to these items.
   */
  async function confirmingMarkDone(advance?: number) {
    const patientId = await newPatient()
    const itemA = await seedPendingItem(patientId, 2500)
    const itemB = await seedPendingItem(patientId, 1500)
    const appointmentId = await createAppointment(patientId)

    expect((await put(`/api/appointments/${appointmentId}`, { budgetItemIds: [itemA, itemB] })).status).toBe(200)

    if (advance !== undefined) {
      const payment = await post(`/api/patients/${patientId}/payments`, {
        amount: advance,
        date: new Date().toISOString(),
      })
      expect(payment.status).toBe(201)
    }

    // PRE-STATE: the items really are only SCHEDULED a moment before the call,
    // and the visit really is costless (no cost key was ever sent).
    const before = await prisma.budgetItem.findMany({
      where: { id: { in: [itemA, itemB] } },
      select: { status: true },
    })
    expect(before.map((i) => i.status).sort()).toEqual(['SCHEDULED', 'SCHEDULED'])
    expect(
      await prisma.budgetItemAppointment.count({ where: { appointmentId, role: 'EXECUTED' } })
    ).toBe(0)
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } })).cost).toBeNull()

    const res = await put(`/api/appointments/${appointmentId}/mark-done`, {
      executedBudgetItemIds: [itemA, itemB],
      notes: 'visita cerrada',
    })
    expect(res.status).toBe(200)

    // POST-STATE: this request is the one that created the EXECUTED links.
    const links = await prisma.budgetItemAppointment.findMany({
      where: { appointmentId, role: 'EXECUTED' },
      select: { budgetItemId: true },
    })
    expect(links.map((l) => l.budgetItemId).sort()).toEqual([itemA, itemB].sort())

    return { patientId, appointmentId, itemA, itemB, body: res.body.data as AppointmentRow }
  }

  /** The patient record read: GET /api/appointments/by-patient/:patientId. */
  async function patientRecordRow(patientId: string, appointmentId: string): Promise<AppointmentRow> {
    const res = await get(`/api/appointments/by-patient/${patientId}`)
    expect(res.status).toBe(200)
    // Pinned by identity, never by position.
    const row = (res.body.data as AppointmentRow[]).find((a) => a.id === appointmentId)
    expect(row, 'appointment missing from the by-patient list').toBeDefined()
    return row!
  }

  // ==========================================================================
  // GUARD 1 — the confirming mark-done response carries the aggregate
  // ==========================================================================
  describe('guard 1: the confirming mark-done returns the aggregate of the items it just executed', () => {
    /**
     * VACUITY HALF. Correct and stale both report 0 covered / 4000 outstanding
     * here, so this case alone is NOT evidence — it only pins that the field is
     * present and totals the two prices. The advance case below is the one that
     * varies the axis.
     */
    it('nothing paid: the response reports 2 items / 4000 / 0 covered / 4000 outstanding', async () => {
      const { body } = await confirmingMarkDone()

      expect(body.budgetItems).toEqual({
        count: 2,
        cost: 4000,
        paidAmount: 0,
        outstanding: 4000,
      })
    })

    /**
     * THE DISCRIMINATING HALF. A pre-charge FIFO run cannot have attributed the
     * 4000 advance to items that were not billable yet, so a stale response
     * reports the advance unconsumed (0 covered / 4000 outstanding). The
     * post-charge figures are 4000 covered / 0 outstanding.
     */
    it('a 4000 advance paid before the call: the response reports the items COVERED, 2 items / 4000 / 4000 covered / 0 outstanding', async () => {
      const { body } = await confirmingMarkDone(4000)

      expect(body.budgetItems).toEqual({
        count: 2,
        cost: 4000,
        paidAmount: 4000,
        outstanding: 0,
      })
    })

    it('the confirming response is COMPLETED', async () => {
      expect((await confirmingMarkDone(4000)).body.status).toBe('COMPLETED')
    })

    it('the confirming response carries the notes this call sent', async () => {
      expect((await confirmingMarkDone(4000)).body.notes).toBe('visita cerrada')
    })

    it('the confirming response has no cost of its own — the items are the whole charge', async () => {
      expect((await confirmingMarkDone(4000)).body.cost).toBeNull()
    })

    /**
     * The appointment itself is not a billable item (cost null), so its own
     * paidAmount/outstanding are 0/0 on BOTH fixtures — the advance shows up
     * inside budgetItems, not here. Asserted so a future change that starts
     * reporting the patient's credit at this level is noticed.
     */
    it('the appointment-level paidAmount/outstanding stay 0/0 on a costless visit, advance or not', async () => {
      expect((await confirmingMarkDone()).body).toMatchObject({ paidAmount: 0, outstanding: 0 })
      expect((await confirmingMarkDone(4000)).body).toMatchObject({ paidAmount: 0, outstanding: 0 })
    })
  })

  // ==========================================================================
  // GUARD 3 — a plain mark-done is unchanged
  // ==========================================================================
  describe('guard 3: a plain mark-done (no executedBudgetItemIds) is unchanged', () => {
    /**
     * STATED LIMIT OF THIS GUARD. It owns the response BODY, not the query
     * count. An unconditional re-read would produce an identical body and keep
     * this green; "the extra read happens only on a confirming call" is held by
     * review of the diff, not by this test. A query-count observable was
     * considered at approval and declined as extra scope — do not add one.
     *
     * What it does own: a re-read placed on the WRONG SIDE of
     * markAppointmentDone. Then `status` reads back SCHEDULED and `notes` the
     * old ones, and the first two assertions below go red.
     */
    async function plainMarkDone(): Promise<AppointmentRow> {
      const patientId = await newPatient()
      const appointmentId = await createAppointment(patientId, {
        cost: 3000,
        notes: 'nota previa',
      })

      const res = await put(`/api/appointments/${appointmentId}/mark-done`, {
        notes: 'visita simple',
      })
      expect(res.status).toBe(200)
      return res.body.data as AppointmentRow
    }

    // Split one assertion per case on purpose: under the perturbation above
    // BOTH `status` and `notes` are wrong, and an assertion placed after a
    // failing one in the same `it()` never runs.
    it('the response status is COMPLETED', async () => {
      expect((await plainMarkDone()).status).toBe('COMPLETED')
    })

    it('the response carries the notes this call sent, not the ones it replaced', async () => {
      expect((await plainMarkDone()).notes).toBe('visita simple')
    })

    it('the response keeps its own 3000 cost, 0 paid / 3000 outstanding, and is not paid', async () => {
      const body = await plainMarkDone()
      expect(Number(body.cost)).toBe(3000)
      expect(body.paidAmount).toBe(0)
      expect(body.outstanding).toBe(3000)
      expect(body.isPaid).toBe(false)
    })

    it('the response carries no budgetItems — nothing was executed in this visit', async () => {
      expect((await plainMarkDone()).budgetItems).toBeUndefined()
    })

    it('the plain mark-done persisted COMPLETED and the new notes in the database too', async () => {
      const patientId = await newPatient()
      const appointmentId = await createAppointment(patientId, {
        cost: 3000,
        notes: 'nota previa',
      })

      expect(
        (await put(`/api/appointments/${appointmentId}/mark-done`, { notes: 'visita simple' })).status
      ).toBe(200)

      const stored = await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } })
      expect(stored.status).toBe('COMPLETED')
      expect(stored.notes).toBe('visita simple')
    })
  })

  // ==========================================================================
  // GUARD 4 — a rejected id leaves the appointment SCHEDULED in the DATABASE
  // ==========================================================================
  describe('guard 4: a rejected executedBudgetItemIds entry leaves the appointment untouched', () => {
    /**
     * Restated from appointments.test.ts ("mark-done rejects an
     * executedBudgetItemIds entry not associated…") so this fix's guard set
     * stands on its own: the re-read sits right after confirmExecutedBudgetItems,
     * i.e. inside the block whose order this guard pins.
     *
     * MEASURED: a version of this guard asserting only `res.status === 400`
     * stays GREEN when validateExecutableBudgetItems is moved to after
     * markAppointmentDone. It is the DATABASE assertion below that goes red —
     * the status assertion alone does not own this axis.
     */
    it('answers 400 ITEM_NOT_ASSOCIATED and the appointment is still SCHEDULED in the database', async () => {
      const patientId = await newPatient()
      // Never associated to this appointment.
      const strayItem = await seedPendingItem(patientId, 2500)
      const appointmentId = await createAppointment(patientId)

      const res = await put(`/api/appointments/${appointmentId}/mark-done`, {
        executedBudgetItemIds: [strayItem],
      })

      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('ITEM_NOT_ASSOCIATED')

      const stored = await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } })
      expect(stored.status).toBe('SCHEDULED')
    })

    it('the rejected item is still PENDING and no EXECUTED link was created', async () => {
      const patientId = await newPatient()
      const strayItem = await seedPendingItem(patientId, 2500)
      const appointmentId = await createAppointment(patientId)

      expect(
        (await put(`/api/appointments/${appointmentId}/mark-done`, { executedBudgetItemIds: [strayItem] })).status
      ).toBe(400)

      expect((await prisma.budgetItem.findUniqueOrThrow({ where: { id: strayItem } })).status).toBe('PENDING')
      expect(await prisma.budgetItemAppointment.count({ where: { appointmentId } })).toBe(0)
    })
  })

  // ==========================================================================
  // GUARD 5 — the later read agrees, each figure against its own literal
  // ==========================================================================
  describe('guard 5: GET /by-patient/:patientId read back after the same mark-done', () => {
    /**
     * Each read is asserted against its OWN literals. They are deliberately NOT
     * compared to each other: two stale readings agree, so an equality between
     * the two responses would be satisfied by both being wrong in the same way.
     */
    it('nothing paid: the by-patient row reports 2 items / 4000 / 0 covered / 4000 outstanding', async () => {
      const { patientId, appointmentId } = await confirmingMarkDone()

      const row = await patientRecordRow(patientId, appointmentId)
      expect(row.budgetItems).toEqual({ count: 2, cost: 4000, paidAmount: 0, outstanding: 4000 })
      expect(row.status).toBe('COMPLETED')
      expect(row.paidAmount).toBe(0)
      expect(row.outstanding).toBe(0)
    })

    /**
     * On the advance fixture the rejected "thread the summary in" approach is
     * caught here: it would carry the item costs from the confirmation result
     * while the covered/outstanding split stayed pre-charge, so the mark-done
     * side would claim 0 covered / 4000 outstanding against this read's
     * 4000 covered / 0 outstanding.
     */
    it('a 4000 advance: the by-patient row reports 2 items / 4000 / 4000 covered / 0 outstanding', async () => {
      const { patientId, appointmentId } = await confirmingMarkDone(4000)

      const row = await patientRecordRow(patientId, appointmentId)
      expect(row.budgetItems).toEqual({ count: 2, cost: 4000, paidAmount: 4000, outstanding: 0 })
      expect(row.status).toBe('COMPLETED')
      expect(row.paidAmount).toBe(0)
      expect(row.outstanding).toBe(0)
    })

    it('a 4000 advance: GET /api/appointments/:id reports the same literals on its own', async () => {
      const { appointmentId } = await confirmingMarkDone(4000)

      const res = await get(`/api/appointments/${appointmentId}`)
      expect(res.status).toBe(200)
      expect((res.body.data as AppointmentRow).budgetItems).toEqual({
        count: 2,
        cost: 4000,
        paidAmount: 4000,
        outstanding: 0,
      })
    })

    /**
     * The mark-done response's figures, asserted against the SAME literals this
     * later read asserts against its own. Written as a separate case so that if
     * both sides ever go stale together, two independent assertions fail rather
     * than one comparison silently agreeing.
     */
    it('a 4000 advance: the mark-done response asserts the same literals the later read does', async () => {
      const { body } = await confirmingMarkDone(4000)

      expect(body.budgetItems).toEqual({ count: 2, cost: 4000, paidAmount: 4000, outstanding: 0 })
    })
  })
})
