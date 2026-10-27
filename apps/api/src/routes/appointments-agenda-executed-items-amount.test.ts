/**
 * Task #619: the day's agenda must show what a visit bills even when the
 * charge comes from executed budget items instead of the appointment's own
 * cost. The billing authority is "a typed cost OR executed budget items, never
 * both"; before this task `GET /api/appointments` (the agenda) knew only the
 * first half, so a budgeted treatment showed no amount at all.
 *
 * This file is the SERVER half of the guard list. It owns:
 *
 *   guard 1 (server half) — GET /api/appointments carries `budgetItems` for a
 *                           visit that bills by executed items.
 *   guard 4 (server half) — the same fixture read back through BOTH
 *                           GET /api/appointments and
 *                           GET /api/appointments/by-patient/:patientId, each
 *                           figure asserted against its own literal expected
 *                           amount, never against the other response.
 *   guard 6 (server half) — PUT /api/appointments/:id and
 *                           PUT /api/appointments/:id/mark-done return
 *                           `budgetItems`, so the store's wholesale swap of a
 *                           write response does not drop the figure.
 *
 * The client halves live in
 * apps/app/src/components/appointments/AppointmentCard.test.tsx (guards 1, 2,
 * 3, 5 and the client half of 4) and
 * apps/app/src/stores/appointments.store.test.ts (client half of 6).
 *
 * FIXTURE REACHABILITY. Nothing here writes a budgetItemAppointment row by
 * hand. Every EXECUTED link is produced by the real two-step production flow,
 * the same one appointments-cost-is-the-authority.test.ts uses:
 *   PUT /api/appointments/:id            { budgetItemIds: [...] }          -> SCHEDULED
 *   PUT /api/appointments/:id/mark-done  { executedBudgetItemIds: [...] }  -> EXECUTED
 * so no guard below certifies a state the API cannot produce.
 *
 * Figures and synthetic ids only — no real patient data.
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

interface AgendaRow {
  id: string
  cost: number | string | null
  budgetItems?: ItemsAggregate
  paidAmount?: number
  outstanding?: number
}

describe('Task #619: the agenda shows the amount of a visit billed by executed budget items', () => {
  let tenantId: string
  let adminToken: string
  let doctorId: string
  let dayOffset = 1
  let patientSeq = 0
  const suffix = Date.now()

  beforeAll(async () => {
    const tenant = await prisma.tenant.create({
      data: { name: 'Test Clinic Agenda Items', slug: `test-clinic-agenda-items-${suffix}` },
    })
    tenantId = tenant.id
    const admin = await prisma.user.create({
      data: {
        email: `admin-agenda-items-${suffix}@test.com`,
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
          firstName: 'Dr. Agenda',
          lastName: 'Doctor',
          email: `doctor-agenda-items-${suffix}@test.com`,
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

  // The agenda list is tenant-wide, so every case starts from an empty tenant.
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
        data: { tenantId, firstName: 'Fixture', lastName: `Agenda${suffix}-${patientSeq}` },
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

  /** Link items (role SCHEDULED) then confirm them executed (role EXECUTED). */
  async function executeItems(appointmentId: string, itemIds: string[]) {
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
    return done
  }

  /** The agenda read: GET /api/appointments with no patient filter. */
  async function agendaRow(appointmentId: string): Promise<AgendaRow> {
    const res = await get('/api/appointments')
    expect(res.status).toBe(200)
    const row = (res.body.data as AgendaRow[]).find((a) => a.id === appointmentId)
    expect(row, 'appointment missing from the agenda list').toBeDefined()
    return row!
  }

  /** The patient record read: GET /api/appointments/by-patient/:patientId. */
  async function patientRecordRow(patientId: string, appointmentId: string): Promise<AgendaRow> {
    const res = await get(`/api/appointments/by-patient/${patientId}`)
    expect(res.status).toBe(200)
    const row = (res.body.data as AgendaRow[]).find((a) => a.id === appointmentId)
    expect(row, 'appointment missing from the by-patient list').toBeDefined()
    return row!
  }

  /**
   * THE fixture of this task: a costless visit whose charge is two executed
   * budget items, 2500 and 1500. Two items (not one) so the `count` cannot be
   * right by luck, and two different prices so the total 4000 is not a repeat
   * of either price.
   */
  async function costlessVisitWithTwoExecutedItems() {
    const patientId = await newPatient()
    const a = await seedPendingItem(patientId, 2500)
    const b = await seedPendingItem(patientId, 1500)
    const appointmentId = await createAppointment(patientId)
    await executeItems(appointmentId, [a, b])
    // The fixture really is costless: no cost key was ever sent.
    const stored = await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } })
    expect(stored.cost).toBeNull()
    return { patientId, appointmentId }
  }

  // ==========================================================================
  // GUARD 1 (server half) — the agenda carries the executed-items figure
  // ==========================================================================
  describe('guard 1: GET /api/appointments carries budgetItems for a visit billed by executed items', () => {
    it('the agenda row exposes the aggregate 2 items / 4000, with nothing paid yet', async () => {
      const { appointmentId } = await costlessVisitWithTwoExecutedItems()

      expect((await agendaRow(appointmentId)).budgetItems).toEqual({
        count: 2,
        cost: 4000,
        paidAmount: 0,
        outstanding: 4000,
      })
    })

    it('the agenda row has no cost of its own — the items are the whole charge', async () => {
      const { appointmentId } = await costlessVisitWithTwoExecutedItems()

      expect((await agendaRow(appointmentId)).cost).toBeNull()
    })

    it('a 4000 advance moves the aggregate to fully covered (the figure is the FIFO one, not a sum of prices)', async () => {
      const { patientId, appointmentId } = await costlessVisitWithTwoExecutedItems()
      const advance = await post(`/api/patients/${patientId}/payments`, {
        amount: 4000,
        date: new Date().toISOString(),
      })
      expect(advance.status).toBe(201)

      expect((await agendaRow(appointmentId)).budgetItems).toEqual({
        count: 2,
        cost: 4000,
        paidAmount: 4000,
        outstanding: 0,
      })
    })
  })

  // ==========================================================================
  // GUARD 2 (server half) — a costed visit is untouched
  // ==========================================================================
  describe('guard 2: a visit billing by a typed cost is unchanged by the agenda merge', () => {
    it('a costed visit with no items keeps its cost and acquires no budgetItems', async () => {
      const patientId = await newPatient()
      const appointmentId = await createAppointment(patientId, { cost: 3000 })

      const row = await agendaRow(appointmentId)
      expect(Number(row.cost)).toBe(3000)
      expect(row.budgetItems).toBeUndefined()
    })

    /**
     * The conditional merge in listAppointments is deliberate: a row whose
     * patient never needed a FIFO run must stay byte-identical to what the
     * agenda returned before this task. An unconditional mergeAllocation would
     * stamp paidAmount: 0 / outstanding: 0 on this costed appointment — an
     * invented figure, since no allocation was computed for it.
     */
    it('a costed visit of a patient with no executed item carries no paidAmount/outstanding from the agenda', async () => {
      const patientId = await newPatient()
      const appointmentId = await createAppointment(patientId, { cost: 3000 })

      const row = await agendaRow(appointmentId)
      expect(row.paidAmount).toBeUndefined()
      expect(row.outstanding).toBeUndefined()
    })

    /**
     * Since #590 a typed cost supersedes the items, so the server sends no
     * budgetItems block for a costed visit even when items were executed in
     * it. The agenda must not invent one.
     */
    it('a costed visit WITH an executed item still bills only its cost: no budgetItems block', async () => {
      const patientId = await newPatient()
      const itemId = await seedPendingItem(patientId, 2500)
      const appointmentId = await createAppointment(patientId, { cost: 3000 })
      await executeItems(appointmentId, [itemId])

      const row = await agendaRow(appointmentId)
      expect(Number(row.cost)).toBe(3000)
      expect(row.budgetItems).toBeUndefined()
    })
  })

  // ==========================================================================
  // GUARD 3 (server half) — a visit with neither
  // ==========================================================================
  describe('guard 3: a visit with neither a cost nor executed items has no amount to show', () => {
    it('the agenda row has cost null and no budgetItems', async () => {
      const patientId = await newPatient()
      const appointmentId = await createAppointment(patientId)

      const row = await agendaRow(appointmentId)
      expect(row.cost).toBeNull()
      expect(row.budgetItems).toBeUndefined()
    })
  })

  // ==========================================================================
  // GUARD 4 (server half) — agenda and patient record agree
  // ==========================================================================
  describe('guard 4: the agenda and the patient record report the same figure, each asserted on its own', () => {
    /**
     * Each read is asserted against its OWN literal 2 / 4000 / 0 / 4000. They
     * are deliberately NOT compared to each other: two reads that are both
     * wrong in the same way must not be able to satisfy this guard.
     */
    it('GET /api/appointments reports 2 items / 4000 / 0 covered / 4000 outstanding', async () => {
      const { appointmentId } = await costlessVisitWithTwoExecutedItems()

      expect((await agendaRow(appointmentId)).budgetItems).toEqual({
        count: 2,
        cost: 4000,
        paidAmount: 0,
        outstanding: 4000,
      })
    })

    it('GET /api/appointments/by-patient/:patientId reports 2 items / 4000 / 0 covered / 4000 outstanding', async () => {
      const { patientId, appointmentId } = await costlessVisitWithTwoExecutedItems()

      expect((await patientRecordRow(patientId, appointmentId)).budgetItems).toEqual({
        count: 2,
        cost: 4000,
        paidAmount: 0,
        outstanding: 4000,
      })
    })

    it('GET /api/appointments/:id reports 2 items / 4000 / 0 covered / 4000 outstanding', async () => {
      const { appointmentId } = await costlessVisitWithTwoExecutedItems()
      const res = await get(`/api/appointments/${appointmentId}`)
      expect(res.status).toBe(200)

      expect((res.body.data as AgendaRow).budgetItems).toEqual({
        count: 2,
        cost: 4000,
        paidAmount: 0,
        outstanding: 4000,
      })
    })
  })

  // ==========================================================================
  // GUARD 6 (server half) — the figure survives an ordinary edit
  // ==========================================================================
  describe('guard 6: the write responses carry budgetItems, so the store swap keeps the figure', () => {
    /**
     * The store replaces the agenda row with the write response wholesale
     * (`appointments.map((a) => (a.id === id ? writeResponse : a))`), so a
     * write response without budgetItems silently blanks the amount the agenda
     * was showing a moment earlier.
     */
    it('PUT /api/appointments/:id (an ordinary notes edit) returns the 2 items / 4000 aggregate', async () => {
      const { appointmentId } = await costlessVisitWithTwoExecutedItems()

      const res = await put(`/api/appointments/${appointmentId}`, { notes: 'edited note' })
      expect(res.status).toBe(200)
      expect((res.body.data as AgendaRow).budgetItems).toEqual({
        count: 2,
        cost: 4000,
        paidAmount: 0,
        outstanding: 4000,
      })
    })

    /**
     * LIMIT OF THIS GUARD. The mark-done exercised here is a later, notes-only
     * one (no executedBudgetItemIds), so the route answers with the object
     * markAppointmentDone built, and that object's FIFO merge already sees the
     * EXECUTED links — the fixture's own earlier confirming call created them.
     * This guard therefore pins only that branch of PUT /:id/mark-done: the one
     * that returns markAppointmentDone's own response, with no re-read.
     *
     * The other branch — the mark-done that *creates* the EXECUTED links — used
     * to be unable to carry the aggregate at all: the route validated up front,
     * called markAppointmentDone (which builds the response, including the FIFO
     * merge), and only then confirmExecutedBudgetItems, so at response time the
     * links did not exist yet and budgetItems came back undefined. Task #642
     * fixed that: after a successful confirmation the route re-reads through
     * getAppointmentById, so a confirming response now does carry budgetItems
     * describing the items it just confirmed. That branch is pinned by
     * apps/api/src/routes/appointments-mark-done-confirmed-items.test.ts, not
     * here.
     */
    it('PUT /api/appointments/:id/mark-done returns the 2 items / 4000 aggregate for already-executed items', async () => {
      const { appointmentId } = await costlessVisitWithTwoExecutedItems()

      // A later mark-done (notes only — the items were confirmed already).
      const res = await put(`/api/appointments/${appointmentId}/mark-done`, { notes: 'visit closed' })
      expect(res.status).toBe(200)
      expect((res.body.data as AgendaRow).budgetItems).toEqual({
        count: 2,
        cost: 4000,
        paidAmount: 0,
        outstanding: 4000,
      })
    })

    it('POST /api/appointments returns no budgetItems for a brand-new visit (nothing executed in it yet)', async () => {
      const patientId = await newPatient()
      const { start, end } = slot()
      const res = await post('/api/appointments', {
        patientId,
        doctorId,
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        cost: 3000,
      })
      expect(res.status).toBe(201)
      expect((res.body.data as AgendaRow).budgetItems).toBeUndefined()
      expect(Number((res.body.data as AgendaRow).cost)).toBe(3000)
    })

    /**
     * restoreAppointment needed no edit for this task: it returns
     * getAppointmentById, which has merged the allocation all along. Asserted
     * because it is cheap, and because a future refactor of that tail would
     * drop the figure from the restore response the store also swaps in.
     */
    it('PUT /api/appointments/:id/restore returns the 2 items / 4000 aggregate', async () => {
      const { appointmentId } = await costlessVisitWithTwoExecutedItems()
      expect((await api().delete(`/api/appointments/${appointmentId}`).set('Authorization', `Bearer ${adminToken}`)).status).toBe(200)

      const res = await put(`/api/appointments/${appointmentId}/restore`, {})
      expect(res.status).toBe(200)
      expect((res.body.data as AgendaRow).budgetItems).toEqual({
        count: 2,
        cost: 4000,
        paidAmount: 0,
        outstanding: 4000,
      })
    })
  })

  // ==========================================================================
  // The agenda merge is per patient, and only for the patients that need it
  // ==========================================================================
  describe('one agenda page mixing both billing authorities', () => {
    it('the items visit shows 4000 from its items and the costed visit shows its own 3000, in the same page', async () => {
      const { appointmentId: itemsVisit } = await costlessVisitWithTwoExecutedItems()
      const otherPatient = await newPatient()
      const costedVisit = await createAppointment(otherPatient, { cost: 3000 })

      const res = await get('/api/appointments')
      expect(res.status).toBe(200)
      const rows = res.body.data as AgendaRow[]

      const items = rows.find((a) => a.id === itemsVisit)!
      expect(items.budgetItems).toEqual({ count: 2, cost: 4000, paidAmount: 0, outstanding: 4000 })
      expect(items.cost).toBeNull()

      const costed = rows.find((a) => a.id === costedVisit)!
      expect(Number(costed.cost)).toBe(3000)
      expect(costed.budgetItems).toBeUndefined()
    })
  })
})
