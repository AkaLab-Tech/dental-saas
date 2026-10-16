/**
 * Task #590: the appointment's own `cost` is the single authority for what its
 * visit charges. A budget item holding an EXECUTED link on that appointment
 * creates no charge of its own while the appointment carries a cost above zero.
 *
 * The rule under test is CONDITIONAL, and that is the whole point. The
 * unconditional version ("an executed item never bills") was rejected: every
 * historical executed item on a costless appointment would stop billing on the
 * first deploy. So guards 1 and 2 are a PAIR — 1 pins that a costed visit
 * bills once, 2 pins that a costless visit still bills its items exactly as
 * before. A blanket removal of the item charge satisfies 1 and fails 2.
 *
 * The rule lives in THREE queries in payment.service.ts (see
 * APPOINTMENT_COST_IS_THE_AUTHORITY there), each feeding a different screen:
 *
 *   getBillableItems            -> GET /api/patients/:id/statement (and FIFO isPaid)
 *   getPatientBalance           -> GET /api/patients/:id/balance
 *   computeOutstandingByPatient -> listDebtors / dashboard pending payments
 *
 * Every money behaviour below is therefore asserted PER SITE, in its own
 * `it()`: an assertion placed after a failing one in the same `it()` is
 * unreachable, and three sites in one `it()` would leave two of them unproven
 * the moment the first breaks.
 *
 * FIXTURE REACHABILITY. Nothing here writes a budgetItemAppointment row by
 * hand. Every EXECUTED link is produced by the real two-step production flow:
 *   PUT /api/appointments/:id   { budgetItemIds: [...] }   -> role SCHEDULED
 *   PUT /api/appointments/:id/mark-done { executedBudgetItemIds: [...] } -> role EXECUTED
 * so no guard can certify a state the API cannot produce.
 *
 * Guard numbering is the task plan's (1-8). Guards 4, 5, 6 and 7 have a
 * frontend half; those halves live in
 * apps/app/src/components/appointments/AppointmentFormModal.test.tsx and
 * apps/app/src/pages/patients/PatientAppointmentsSection.test.tsx. Guard 8 is
 * frontend-only.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { api } from '../test/http.js'
import { prisma } from '@dental/database'
import { hashPassword } from '../services/auth.service.js'
import { generateToken } from '../test/tokens.js'
import {
  appointmentCostSupersedesItems,
  computeOutstandingByPatient,
  listBillableItems,
} from '../services/payment.service.js'

describe('Task #590: the appointment cost is the single authority for its visit', () => {
  let tenantId: string
  let adminToken: string
  let doctorId: string
  let dayOffset = 1
  const suffix = Date.now()

  beforeAll(async () => {
    const tenant = await prisma.tenant.create({
      data: { name: 'Test Clinic Cost Authority', slug: `test-clinic-cost-authority-${suffix}` },
    })
    tenantId = tenant.id
    const admin = await prisma.user.create({
      data: {
        email: `admin-cost-authority-${suffix}@test.com`,
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
          firstName: 'Dr. Authority',
          lastName: 'Doctor',
          email: `doctor-cost-authority-${suffix}@test.com`,
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

  // computeOutstandingByPatient and listDebtors are tenant-wide, so each case
  // starts from an empty tenant and gets its own patient.
  beforeEach(async () => {
    await prisma.patientPayment.deleteMany({ where: { tenantId } })
    await prisma.appointment.deleteMany({ where: { tenantId } })
    await prisma.budget.deleteMany({ where: { tenantId } })
    await prisma.patient.deleteMany({ where: { tenantId } })
    dayOffset = 1
  })

  // --------------------------------------------------------------------------
  // Fixture helpers — synthetic identifiers only, figures only.
  // --------------------------------------------------------------------------

  let patientSeq = 0
  async function newPatient(): Promise<string> {
    patientSeq += 1
    return (
      await prisma.patient.create({
        data: { tenantId, firstName: 'Fixture', lastName: `Case${suffix}-${patientSeq}` },
      })
    ).id
  }

  function slot() {
    const start = new Date()
    start.setDate(start.getDate() + dayOffset++)
    start.setHours(10, 0, 0, 0)
    return { start, end: new Date(start.getTime() + 30 * 60 * 1000) }
  }

  function post(path: string, body: Record<string, unknown>) {
    return api().post(path).set('Authorization', `Bearer ${adminToken}`).send(body)
  }

  function put(path: string, body: Record<string, unknown>) {
    return api().put(path).set('Authorization', `Bearer ${adminToken}`).send(body)
  }

  function get(path: string) {
    return api().get(path).set('Authorization', `Bearer ${adminToken}`)
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

  /** Create an appointment through the route the app uses. */
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

  /** Link items (role SCHEDULED) then confirm them executed (role EXECUTED). */
  async function executeItems(appointmentId: string, itemIds: string[]): Promise<void> {
    expect((await put(`/api/appointments/${appointmentId}`, { budgetItemIds: itemIds })).status).toBe(200)
    const done = await put(`/api/appointments/${appointmentId}/mark-done`, {
      executedBudgetItemIds: itemIds,
    })
    expect(done.status).toBe(200)
    // The fixture really is an EXECUTED link, not merely a SCHEDULED one.
    const links = await prisma.budgetItemAppointment.findMany({
      where: { appointmentId, role: 'EXECUTED' },
      select: { budgetItemId: true },
    })
    expect(links.map((l) => l.budgetItemId).sort()).toEqual([...itemIds].sort())
  }

  async function statement(patientId: string) {
    const res = await get(`/api/patients/${patientId}/statement`)
    expect(res.status).toBe(200)
    return res.body.data as {
      totalBilled: number
      appointmentsDebt: number
      advancesCredit: number
      totalPaid: number
    }
  }

  async function balance(patientId: string) {
    const res = await get(`/api/patients/${patientId}/balance`)
    expect(res.status).toBe(200)
    return res.body.data as {
      totalDebt: number
      totalPaid: number
      outstanding: number
      credit: number
    }
  }

  async function outstanding(patientId: string) {
    return (await computeOutstandingByPatient(tenantId)).get(patientId)
  }

  async function storedCost(appointmentId: string): Promise<number | null> {
    const row = await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } })
    return row.cost === null ? null : Number(row.cost)
  }

  /**
   * THE fixture of guard 1: one executed item of 2500 on an appointment whose
   * typed cost is also 2500. The two figures are deliberately equal because
   * that is the shape the task exists for; the asymmetric variant below
   * (3100 vs 2500) is what stops "2500" from being right by luck.
   */
  async function costedVisitWithExecutedItem(cost: number, itemPrice: number) {
    const patientId = await newPatient()
    const itemId = await seedPendingItem(patientId, itemPrice)
    const appointmentId = await createAppointment(patientId, { cost })
    await executeItems(appointmentId, [itemId])
    return { patientId, appointmentId, itemId }
  }

  async function costlessVisitWithExecutedItem(itemPrice: number) {
    const patientId = await newPatient()
    const itemId = await seedPendingItem(patientId, itemPrice)
    const appointmentId = await createAppointment(patientId)
    await executeItems(appointmentId, [itemId])
    // The fixture really is costless: no cost key was ever sent.
    expect(await storedCost(appointmentId)).toBeNull()
    return { patientId, appointmentId, itemId }
  }

  // ==========================================================================
  // GUARD 1 — the visit bills once
  // ==========================================================================
  describe('guard 1: cost 2500 + one executed item of 2500 bills 2500, not 5000', () => {
    it('statement (getBillableItems): totalBilled is 2500', async () => {
      const { patientId } = await costedVisitWithExecutedItem(2500, 2500)
      expect((await statement(patientId)).totalBilled).toBe(2500)
    })

    it('statement (getBillableItems): totalBilled is NOT the 5000 double charge', async () => {
      const { patientId } = await costedVisitWithExecutedItem(2500, 2500)
      expect((await statement(patientId)).totalBilled).not.toBe(5000)
    })

    it('balance (getPatientBalance): totalDebt is 2500 and outstanding is 2500', async () => {
      const { patientId } = await costedVisitWithExecutedItem(2500, 2500)
      expect(await balance(patientId)).toEqual({
        totalDebt: 2500,
        totalPaid: 0,
        outstanding: 2500,
        credit: 0,
      })
    })

    it('debtors (computeOutstandingByPatient): the tenant-wide figure is 2500', async () => {
      const { patientId } = await costedVisitWithExecutedItem(2500, 2500)
      expect(await outstanding(patientId)).toEqual({
        totalDebt: 2500,
        totalPaid: 0,
        outstanding: 2500,
      })
    })

    it('the ledger holds ONE row, the appointment: the item is not a charge of its own', async () => {
      const { patientId, appointmentId } = await costedVisitWithExecutedItem(2500, 2500)
      const billable = await listBillableItems(tenantId, patientId)
      expect(billable.map((b) => [b.type, b.id, b.cost])).toEqual([
        ['appointment', appointmentId, 2500],
      ])
    })

    // The asymmetric variant. With cost === itemPrice, "2500" is also what a
    // broken engine that billed only the ITEM would report. Here the three
    // candidate answers are distinct: 3100 (cost wins), 2500 (item wins),
    // 5600 (both bill).
    it('asymmetric: cost 3100 beside an executed item of 2500 bills 3100', async () => {
      const { patientId } = await costedVisitWithExecutedItem(3100, 2500)
      expect((await statement(patientId)).totalBilled).toBe(3100)
    })

    it('asymmetric: cost 3100 beside an executed item of 2500 does NOT bill the item alone (2500)', async () => {
      const { patientId } = await costedVisitWithExecutedItem(3100, 2500)
      expect((await statement(patientId)).totalBilled).not.toBe(2500)
    })

    it('asymmetric: cost 3100 beside an executed item of 2500 does NOT bill both (5600)', async () => {
      const { patientId } = await costedVisitWithExecutedItem(3100, 2500)
      expect((await statement(patientId)).totalBilled).not.toBe(5600)
    })
  })

  // ==========================================================================
  // GUARD 2 — the conditional holds in the other direction
  // ==========================================================================
  describe('guard 2: the same executed item of 2500 on a COSTLESS appointment still bills 2500', () => {
    it('statement (getBillableItems): totalBilled is 2500, exactly as before #590', async () => {
      const { patientId } = await costlessVisitWithExecutedItem(2500)
      expect((await statement(patientId)).totalBilled).toBe(2500)
    })

    it('balance (getPatientBalance): totalDebt is 2500, not 0', async () => {
      const { patientId } = await costlessVisitWithExecutedItem(2500)
      expect(await balance(patientId)).toEqual({
        totalDebt: 2500,
        totalPaid: 0,
        outstanding: 2500,
        credit: 0,
      })
    })

    it('debtors (computeOutstandingByPatient): the patient is still a debtor for 2500', async () => {
      const { patientId } = await costlessVisitWithExecutedItem(2500)
      expect(await outstanding(patientId)).toEqual({
        totalDebt: 2500,
        totalPaid: 0,
        outstanding: 2500,
      })
    })

    it('the ledger holds ONE row, the budget item, with its budget identity', async () => {
      const { patientId, itemId, appointmentId } = await costlessVisitWithExecutedItem(2500)
      const billable = await listBillableItems(tenantId, patientId)
      expect(billable.map((b) => [b.type, b.id, b.cost])).toEqual([['budgetItem', itemId, 2500]])
      expect(billable[0].appointmentId).toBe(appointmentId)
    })

    // The cost field has three states that reach the API differently (null, 0,
    // a number). Only the third supersedes, and 0 is the one a blanket
    // `cost !== null` check would get wrong.
    it('a typed 0 is not a charge and does not supersede: the item still bills 2500', async () => {
      const { patientId, appointmentId } = await costlessVisitWithExecutedItem(2500)
      expect((await put(`/api/appointments/${appointmentId}`, { cost: 0 })).status).toBe(200)
      expect(await storedCost(appointmentId)).toBe(0)
      expect((await statement(patientId)).totalBilled).toBe(2500)
    })

    it('clearing a cost back to null hands the charge back to the item: 2500 either way', async () => {
      const { patientId, appointmentId } = await costedVisitWithExecutedItem(2500, 2500)
      expect((await statement(patientId)).totalBilled).toBe(2500)

      expect((await put(`/api/appointments/${appointmentId}`, { cost: null })).status).toBe(200)
      expect(await storedCost(appointmentId)).toBeNull()

      // Same total, different source: the appointment is gone from the ledger
      // and the item has taken its place.
      expect((await statement(patientId)).totalBilled).toBe(2500)
      const billable = await listBillableItems(tenantId, patientId)
      expect(billable.map((b) => b.type)).toEqual(['budgetItem'])
    })

    // A cancelled appointment bills nothing of its own, so letting its cost
    // supersede would erase the budget work performed at that visit.
    it('a CANCELLED appointment with a cost of 2500 supersedes nothing: the item bills 2500', async () => {
      const { patientId, appointmentId } = await costedVisitWithExecutedItem(2500, 2500)
      expect((await put(`/api/appointments/${appointmentId}`, { status: 'CANCELLED' })).status).toBe(200)

      expect((await statement(patientId)).totalBilled).toBe(2500)
      const billable = await listBillableItems(tenantId, patientId)
      expect(billable.map((b) => [b.type, b.cost])).toEqual([['budgetItem', 2500]])
    })

    it('appointmentCostSupersedesItems: the predicate itself, over every axis', () => {
      // status x cost, so no single axis can carry the whole result by luck.
      expect(appointmentCostSupersedesItems({ status: 'COMPLETED', cost: 2500 })).toBe(true)
      expect(appointmentCostSupersedesItems({ status: 'SCHEDULED', cost: 2500 })).toBe(true)
      expect(appointmentCostSupersedesItems({ status: 'COMPLETED', cost: 0 })).toBe(false)
      expect(appointmentCostSupersedesItems({ status: 'COMPLETED', cost: null })).toBe(false)
      expect(appointmentCostSupersedesItems({ status: 'CANCELLED', cost: 2500 })).toBe(false)
      expect(appointmentCostSupersedesItems({ status: 'CANCELLED', cost: null })).toBe(false)
    })
  })

  // ==========================================================================
  // GUARD 3 — the ajustes / RX / consulta flow must not move
  // ==========================================================================
  describe('guard 3: an appointment with no executed items takes a typed cost, editable, billing once', () => {
    it('a typed 1900 with no budget item anywhere bills 1900 once', async () => {
      const patientId = await newPatient()
      const appointmentId = await createAppointment(patientId, { cost: 1900 })

      expect((await statement(patientId)).totalBilled).toBe(1900)
      const billable = await listBillableItems(tenantId, patientId)
      expect(billable.map((b) => [b.type, b.id, b.cost])).toEqual([
        ['appointment', appointmentId, 1900],
      ])
    })

    it('the field is still editable: 1900 edited to 2400 bills 2400, not 1900 and not 4300', async () => {
      const patientId = await newPatient()
      const appointmentId = await createAppointment(patientId, { cost: 1900 })
      expect((await put(`/api/appointments/${appointmentId}`, { cost: 2400 })).status).toBe(200)

      expect(await storedCost(appointmentId)).toBe(2400)
      const s = await statement(patientId)
      expect(s.totalBilled).toBe(2400)
      expect(s.appointmentsDebt).toBe(2400)
    })

    it('the edited figure is 2400 at the balance site too', async () => {
      const patientId = await newPatient()
      const appointmentId = await createAppointment(patientId, { cost: 1900 })
      expect((await put(`/api/appointments/${appointmentId}`, { cost: 2400 })).status).toBe(200)

      expect(await balance(patientId)).toEqual({
        totalDebt: 2400,
        totalPaid: 0,
        outstanding: 2400,
        credit: 0,
      })
    })

    it('the edited figure is 2400 at the tenant-wide site too', async () => {
      const patientId = await newPatient()
      const appointmentId = await createAppointment(patientId, { cost: 1900 })
      expect((await put(`/api/appointments/${appointmentId}`, { cost: 2400 })).status).toBe(200)

      expect(await outstanding(patientId)).toEqual({
        totalDebt: 2400,
        totalPaid: 0,
        outstanding: 2400,
      })
    })
  })

  // ==========================================================================
  // GUARD 4 (backend half) — the typed figure wins over the items' total
  // ==========================================================================
  describe('guard 4 (backend half): a typed 2000 saved against items totalling 2500', () => {
    async function typedUnderItems() {
      const patientId = await newPatient()
      const itemId = await seedPendingItem(patientId, 2500)
      const appointmentId = await createAppointment(patientId, { cost: 2000 })
      await executeItems(appointmentId, [itemId])
      expect(await storedCost(appointmentId)).toBe(2000)
      return { patientId, appointmentId }
    }

    it('bills 2000 — the typed figure', async () => {
      const { patientId } = await typedUnderItems()
      expect((await statement(patientId)).totalBilled).toBe(2000)
    })

    it('does NOT bill 2500 — the items total, i.e. the typed value was not ignored', async () => {
      const { patientId } = await typedUnderItems()
      expect((await statement(patientId)).totalBilled).not.toBe(2500)
    })

    it('does NOT bill 4500 — the sum, i.e. the item did not bill beside the cost', async () => {
      const { patientId } = await typedUnderItems()
      expect((await statement(patientId)).totalBilled).not.toBe(4500)
    })
  })

  // ==========================================================================
  // GUARD 5 (backend half) — the prefill is a prefill, not a write
  // ==========================================================================
  describe('guard 5 (backend half): associating items never writes the appointment row cost', () => {
    it('a PUT carrying budgetItemIds and no cost key leaves the stored cost null', async () => {
      const patientId = await newPatient()
      const itemId = await seedPendingItem(patientId, 2500)
      const appointmentId = await createAppointment(patientId)
      expect(await storedCost(appointmentId)).toBeNull()

      expect((await put(`/api/appointments/${appointmentId}`, { budgetItemIds: [itemId] })).status).toBe(200)

      expect(await storedCost(appointmentId)).toBeNull()
    })

    it('confirming the items EXECUTED still leaves the stored cost null', async () => {
      const patientId = await newPatient()
      const itemId = await seedPendingItem(patientId, 2500)
      const appointmentId = await createAppointment(patientId)
      await executeItems(appointmentId, [itemId])

      expect(await storedCost(appointmentId)).toBeNull()
    })

    it('a PUT carrying budgetItemIds and no cost key leaves an EXISTING stored cost untouched', async () => {
      const patientId = await newPatient()
      const itemId = await seedPendingItem(patientId, 2500)
      const appointmentId = await createAppointment(patientId, { cost: 1700 })

      expect((await put(`/api/appointments/${appointmentId}`, { budgetItemIds: [itemId] })).status).toBe(200)

      expect(await storedCost(appointmentId)).toBe(1700)
    })
  })

  // ==========================================================================
  // GUARD 6 (backend half) — unlinking leaves the cost as last saved
  // ==========================================================================
  describe('guard 6 (backend half): unlinking the items leaves the saved cost and bills it once', () => {
    it('unlinking every item leaves the stored cost at 2500 and bills 2500 once', async () => {
      const patientId = await newPatient()
      const itemId = await seedPendingItem(patientId, 2500)
      const appointmentId = await createAppointment(patientId, { cost: 2500, budgetItemIds: [itemId] })

      expect((await put(`/api/appointments/${appointmentId}`, { budgetItemIds: [] })).status).toBe(200)

      expect(await storedCost(appointmentId)).toBe(2500)
      expect((await statement(patientId)).totalBilled).toBe(2500)
      const billable = await listBillableItems(tenantId, patientId)
      expect(billable.map((b) => [b.type, b.cost])).toEqual([['appointment', 2500]])
    })

    it('state "a number": a cost of 2500 survives the unlink PUT that carries no cost key', async () => {
      const patientId = await newPatient()
      const itemId = await seedPendingItem(patientId, 2500)
      const appointmentId = await createAppointment(patientId, { cost: 2500, budgetItemIds: [itemId] })
      expect((await put(`/api/appointments/${appointmentId}`, { budgetItemIds: [] })).status).toBe(200)
      expect(await storedCost(appointmentId)).toBe(2500)
    })

    it('state "empty": cost null sent with the unlink clears it, and nothing bills', async () => {
      const patientId = await newPatient()
      const itemId = await seedPendingItem(patientId, 2500)
      const appointmentId = await createAppointment(patientId, { cost: 2500, budgetItemIds: [itemId] })

      expect((await put(`/api/appointments/${appointmentId}`, { cost: null, budgetItemIds: [] })).status).toBe(200)

      expect(await storedCost(appointmentId)).toBeNull()
      expect((await statement(patientId)).totalBilled).toBe(0)
    })

    it('state "0": cost 0 sent with the unlink stores 0 (not null) and bills nothing', async () => {
      const patientId = await newPatient()
      const itemId = await seedPendingItem(patientId, 2500)
      const appointmentId = await createAppointment(patientId, { cost: 2500, budgetItemIds: [itemId] })

      expect((await put(`/api/appointments/${appointmentId}`, { cost: 0, budgetItemIds: [] })).status).toBe(200)

      expect(await storedCost(appointmentId)).toBe(0)
      expect((await statement(patientId)).totalBilled).toBe(0)
    })
  })

  // ==========================================================================
  // GUARD 7 — the figures agree across surfaces
  // ==========================================================================
  //
  // Three CODE PATHS, not three renderings of one figure, so each gets its own
  // stated expectation rather than an equality between them (three surfaces
  // wrong together would satisfy an equality):
  //   (a) the appointment card      GET /api/appointments/by-patient/:id
  //       -> getAppointmentsByPatient -> buildPatientAllocationMap + mergeAllocation
  //   (b) the patient statement     GET /api/patients/:id/statement
  //       -> getPatientAccountStatement -> getBillableItems + computeFifoAllocation
  //   (c) the day's agenda          GET /api/appointments?from=&to=
  //       -> listAppointments -> attachRecordedPayments only (no allocation merge)
  describe("guard 7: guard 1's fixture, stated per surface", () => {
    it('(a) the appointment card shows cost 2500, paidAmount 0, outstanding 2500 and NO budgetItems block', async () => {
      const { patientId, appointmentId } = await costedVisitWithExecutedItem(2500, 2500)

      const res = await get(`/api/appointments/by-patient/${patientId}`)
      expect(res.status).toBe(200)
      const cards = res.body.data as Record<string, unknown>[]
      expect(cards).toHaveLength(1)
      const card = cards[0]
      expect(card.id).toBe(appointmentId)
      expect(Number(card.cost)).toBe(2500)
      expect(card.paidAmount).toBe(0)
      expect(card.outstanding).toBe(2500)
      // Absent, not zeroed: the item is no longer billable, so the display
      // aggregate has nothing to sum.
      expect('budgetItems' in card).toBe(false)
    })

    it('(a) the same card DOES carry the budgetItems block when the visit has no cost (the block is not simply gone)', async () => {
      const { patientId } = await costlessVisitWithExecutedItem(2500)

      const res = await get(`/api/appointments/by-patient/${patientId}`)
      expect(res.status).toBe(200)
      const card = (res.body.data as Record<string, unknown>[])[0]
      expect(card.cost).toBeNull()
      expect(card.budgetItems).toEqual({ count: 1, cost: 2500, paidAmount: 0, outstanding: 2500 })
    })

    it('(b) the patient statement shows totalBilled 2500 and appointmentsDebt 2500 with no payment', async () => {
      const { patientId } = await costedVisitWithExecutedItem(2500, 2500)
      expect(await statement(patientId)).toMatchObject({
        totalBilled: 2500,
        appointmentsDebt: 2500,
        advancesCredit: 0,
        totalPaid: 0,
      })
    })

    it("(c) the day's agenda shows cost 2500 and carries no items figure at all (by construction)", async () => {
      const { patientId, appointmentId } = await costedVisitWithExecutedItem(2500, 2500)
      const row = await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } })
      const from = new Date(row.startTime)
      from.setHours(0, 0, 0, 0)
      const to = new Date(row.startTime)
      to.setHours(23, 59, 59, 999)

      const res = await get(
        `/api/appointments?patientId=${patientId}&from=${from.toISOString()}&to=${to.toISOString()}`
      )
      expect(res.status).toBe(200)
      const agenda = res.body.data as Record<string, unknown>[]
      expect(agenda).toHaveLength(1)
      expect(Number(agenda[0].cost)).toBe(2500)
      // listAppointments calls neither buildPatientAllocationMap nor
      // mergeAllocation, so no items aggregate exists on this path — true
      // before #590 as well, asserted so the agenda cannot start carrying a
      // second figure without this guard noticing.
      expect('budgetItems' in agenda[0]).toBe(false)
    })
  })
})
