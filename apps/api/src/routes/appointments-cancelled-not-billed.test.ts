/**
 * Task #588: a CANCELLED appointment must not bill.
 *
 * `isActive` is the soft-delete flag, not the lifecycle status: a CANCELLED
 * appointment is still `isActive: true`, so before this task its cost entered
 * the patient's debt exactly like a completed visit.
 *
 * The billable-appointment rule lives in THREE queries in payment.service.ts,
 * and each feeds a different screen:
 *
 *   getBillableItems            -> GET /api/patients/:id/statement  (and the FIFO isPaid flags)
 *   getPatientBalance           -> GET /api/patients/:id/balance
 *   computeOutstandingByPatient -> listDebtors / dashboard pending payments
 *
 * Every behaviour below is therefore asserted PER SITE, because a guard that
 * touches only one of them leaves the other two unguarded.
 *
 * Guard numbering (from the task brief):
 *   1 cancelled + cost does not bill      2 completed + same cost still bills
 *   3 cancelling releases the money       4 one assertion per status
 *   5 soft-deleted still does not bill    6 emptying the cost clears it
 *   (the frontend half of 6 lives in AppointmentFormModal.test.tsx)
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { api } from '../test/http.js'
import { prisma } from '@dental/database'
import { hashPassword } from '../services/auth.service.js'
import { generateToken } from '../test/tokens.js'
import { computeOutstandingByPatient, listDebtors } from '../services/payment.service.js'

type Status =
  | 'SCHEDULED'
  | 'CONFIRMED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'NO_SHOW'
  | 'RESCHEDULED'

describe('Task #588: a cancelled appointment does not bill', () => {
  let tenantId: string
  let adminToken: string
  let doctorId: string
  let dayOffset = 1
  const testSlug = `test-clinic-cancelled-not-billed-${Date.now()}`

  beforeAll(async () => {
    const tenant = await prisma.tenant.create({
      data: { name: 'Test Clinic Cancelled Not Billed', slug: testSlug },
    })
    tenantId = tenant.id
    const admin = await prisma.user.create({
      data: {
        email: `admin-cancelled-nb-${Date.now()}@test.com`,
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
          firstName: 'Dr. Cancel',
          lastName: 'Doctor',
          email: `doctor-cancelled-nb-${Date.now()}@test.com`,
          specialty: 'General Dentistry',
        },
      })
    ).id
  })

  afterAll(async () => {
    await prisma.patientPayment.deleteMany({ where: { tenantId } })
    await prisma.appointment.deleteMany({ where: { tenantId } })
    await prisma.patient.deleteMany({ where: { tenantId } })
    await prisma.doctor.deleteMany({ where: { tenantId } })
    await prisma.refreshToken.deleteMany({ where: { user: { tenantId } } })
    await prisma.user.deleteMany({ where: { tenantId } })
    await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {})
  })

  // One patient per case, and a clean tenant per case: computeOutstandingByPatient
  // and listDebtors are tenant-wide.
  beforeEach(async () => {
    await prisma.patientPayment.deleteMany({ where: { tenantId } })
    await prisma.appointment.deleteMany({ where: { tenantId } })
    await prisma.patient.deleteMany({ where: { tenantId } })
    dayOffset = 1
  })

  async function newPatient(): Promise<string> {
    return (
      await prisma.patient.create({
        data: { tenantId, firstName: 'Cancel', lastName: `Case${Date.now()}${Math.random()}` },
      })
    ).id
  }

  function slot() {
    const start = new Date()
    start.setDate(start.getDate() + dayOffset++)
    start.setHours(10, 0, 0, 0)
    return { start, end: new Date(start.getTime() + 30 * 60 * 1000) }
  }

  // Direct row: the state the real clinic record was in (status CANCELLED,
  // isActive still true) cannot be produced by DELETE, which also soft-deletes.
  async function seedAppointment(
    patientId: string,
    cost: number,
    status: Status,
    isActive = true
  ): Promise<string> {
    const { start, end } = slot()
    return (
      await prisma.appointment.create({
        data: { tenantId, patientId, doctorId, startTime: start, endTime: end, duration: 30, cost, status, isActive },
      })
    ).id
  }

  // Real route, so a paidAmount becomes a kind=APPOINTMENT payment earmarked to
  // the appointment, exactly as the app builds it.
  async function createViaApi(patientId: string, cost: number, paidAmount?: number): Promise<string> {
    const { start, end } = slot()
    const res = await api()
      .post('/api/appointments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        patientId,
        doctorId,
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        cost,
        ...(paidAmount !== undefined ? { paidAmount } : {}),
      })
    expect(res.status).toBe(201)
    return res.body.data.id as string
  }

  async function put(id: string, body: Record<string, unknown>) {
    return api().put(`/api/appointments/${id}`).set('Authorization', `Bearer ${adminToken}`).send(body)
  }

  async function statement(patientId: string) {
    const res = await api()
      .get(`/api/patients/${patientId}/statement`)
      .set('Authorization', `Bearer ${adminToken}`)
    expect(res.status).toBe(200)
    return res.body.data as {
      totalBilled: number
      appointmentsDebt: number
      advancesCredit: number
      totalPaid: number
    }
  }

  async function balance(patientId: string) {
    const res = await api()
      .get(`/api/patients/${patientId}/balance`)
      .set('Authorization', `Bearer ${adminToken}`)
    expect(res.status).toBe(200)
    return res.body.data as { totalDebt: number; totalPaid: number; outstanding: number; credit: number }
  }

  async function outstanding(patientId: string) {
    return (await computeOutstandingByPatient(tenantId)).get(patientId)
  }

  async function isPaid(appointmentId: string) {
    return (await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } })).isPaid
  }

  describe('guard 1: a cancelled appointment with a cost does not bill', () => {
    it('statement (getBillableItems): totalBilled and appointmentsDebt are 0 for a CANCELLED 2300', async () => {
      const patientId = await newPatient()
      await seedAppointment(patientId, 2300, 'CANCELLED')

      const s = await statement(patientId)
      expect(s.totalBilled).toBe(0)
      expect(s.appointmentsDebt).toBe(0)
    })

    it('balance (getPatientBalance): totalDebt and outstanding are 0 for a CANCELLED 2300', async () => {
      const patientId = await newPatient()
      await seedAppointment(patientId, 2300, 'CANCELLED')

      expect(await balance(patientId)).toEqual({ totalDebt: 0, totalPaid: 0, outstanding: 0, credit: 0 })
    })

    it('debtors (computeOutstandingByPatient): the patient has no debt and is not listed', async () => {
      const patientId = await newPatient()
      await seedAppointment(patientId, 2300, 'CANCELLED')

      const o = await outstanding(patientId)
      expect(o?.totalDebt ?? 0).toBe(0)
      expect(o?.outstanding ?? 0).toBe(0)
      expect((await listDebtors(tenantId)).map((d) => d.patientId)).not.toContain(patientId)
    })
  })

  describe('guard 2: a completed appointment with the same cost still bills', () => {
    it('statement: totalBilled and appointmentsDebt are 2300 for a COMPLETED 2300', async () => {
      const patientId = await newPatient()
      await seedAppointment(patientId, 2300, 'COMPLETED')

      const s = await statement(patientId)
      expect(s.totalBilled).toBe(2300)
      expect(s.appointmentsDebt).toBe(2300)
    })

    it('balance: totalDebt and outstanding are 2300 for a COMPLETED 2300', async () => {
      const patientId = await newPatient()
      await seedAppointment(patientId, 2300, 'COMPLETED')

      expect(await balance(patientId)).toEqual({ totalDebt: 2300, totalPaid: 0, outstanding: 2300, credit: 0 })
    })

    it('debtors: the patient owes 2300 and is listed', async () => {
      const patientId = await newPatient()
      await seedAppointment(patientId, 2300, 'COMPLETED')

      expect(await outstanding(patientId)).toEqual({ totalDebt: 2300, totalPaid: 0, outstanding: 2300 })
      const row = (await listDebtors(tenantId)).find((d) => d.patientId === patientId)
      expect(row?.outstanding).toBe(2300)
    })
  })

  describe('guard 3: cancelling an already-billed appointment releases the money', () => {
    // A: 2300, fully charged in the consultation (kind=APPOINTMENT payment
    // earmarked to it). B: 1000, later, unpaid. Before the cancel the patient
    // owes exactly B.
    async function setUp() {
      const patientId = await newPatient()
      const a = await createViaApi(patientId, 2300, 2300)
      const b = await createViaApi(patientId, 1000)
      return { patientId, a, b }
    }

    it('precondition: A is paid by its own earmark and B is the only debt (1000)', async () => {
      const { patientId, a, b } = await setUp()

      expect(await isPaid(a)).toBe(true)
      expect(await isPaid(b)).toBe(false)
      expect(await statement(patientId)).toMatchObject({ totalBilled: 3300, appointmentsDebt: 1000, advancesCredit: 0 })
    })

    it('ordinary edit to CANCELLED: the earmarked 2300 becomes an advance and is re-applied to B (statement)', async () => {
      const { patientId, a, b } = await setUp()

      const res = await put(a, { status: 'CANCELLED' })
      expect(res.status).toBe(200)

      const payments = await prisma.patientPayment.findMany({ where: { tenantId, patientId } })
      expect(payments).toHaveLength(1)
      expect(payments[0].kind).toBe('ADVANCE')
      expect(Number(payments[0].amount)).toBe(2300)

      // 2300 paid - 1000 now covered by the released money = 1300 credit.
      expect(await statement(patientId)).toMatchObject({
        totalBilled: 1000,
        appointmentsDebt: 0,
        advancesCredit: 1300,
        totalPaid: 2300,
      })
      expect(await isPaid(b)).toBe(true)
    })

    it('ordinary edit to CANCELLED: balance shows debt 1000, paid 2300, credit 1300 (getPatientBalance)', async () => {
      const { patientId, a } = await setUp()

      expect((await put(a, { status: 'CANCELLED' })).status).toBe(200)

      expect(await balance(patientId)).toEqual({ totalDebt: 1000, totalPaid: 2300, outstanding: 0, credit: 1300 })
    })

    it('ordinary edit to CANCELLED: the patient leaves the debtors list with totalDebt 1000 (computeOutstandingByPatient)', async () => {
      const { patientId, a } = await setUp()
      // Before: paid 2300 against 3300 billed -> still owes 1000, listed.
      expect((await listDebtors(tenantId)).find((d) => d.patientId === patientId)?.outstanding).toBe(1000)

      expect((await put(a, { status: 'CANCELLED' })).status).toBe(200)

      expect(await outstanding(patientId)).toEqual({ totalDebt: 1000, totalPaid: 2300, outstanding: 0 })
      expect((await listDebtors(tenantId)).map((d) => d.patientId)).not.toContain(patientId)
    })

    it('ordinary edit to CANCELLED: a cancelled appointment with NO later charge turns the whole 2300 into credit', async () => {
      const patientId = await newPatient()
      const a = await createViaApi(patientId, 2300, 2300)

      expect((await put(a, { status: 'CANCELLED' })).status).toBe(200)

      expect(await statement(patientId)).toMatchObject({ totalBilled: 0, appointmentsDebt: 0, advancesCredit: 2300 })
    })

    it('ordinary edit to CANCELLED of an unpaid appointment: appointmentsDebt falls by exactly its cost (3300 -> 1000)', async () => {
      const patientId = await newPatient()
      const a = await createViaApi(patientId, 2300)
      await createViaApi(patientId, 1000)
      expect((await statement(patientId)).appointmentsDebt).toBe(3300)

      expect((await put(a, { status: 'CANCELLED' })).status).toBe(200)

      expect((await statement(patientId)).appointmentsDebt).toBe(1000)
    })

    it('saving an appointment that is ALREADY CANCELLED does not convert again: only the transition converts', async () => {
      // Legacy state the old edit form produced: status CANCELLED, payment still
      // earmarked (kind APPOINTMENT) to it. A later save must not touch the money.
      const { patientId, a } = await setUp()
      await prisma.appointment.update({ where: { id: a }, data: { status: 'CANCELLED' } })

      expect((await put(a, { status: 'CANCELLED', notes: 'second save' })).status).toBe(200)

      const payments = await prisma.patientPayment.findMany({ where: { tenantId, patientId } })
      expect(payments.map((p) => p.kind)).toEqual(['APPOINTMENT'])
    })

    it('deleteAppointment path is unchanged: 2300 becomes an advance, re-applied to B, credit 1300', async () => {
      const { patientId, a, b } = await setUp()

      const res = await api().delete(`/api/appointments/${a}`).set('Authorization', `Bearer ${adminToken}`)
      expect(res.status).toBe(200)

      expect(await statement(patientId)).toMatchObject({ totalBilled: 1000, appointmentsDebt: 0, advancesCredit: 1300 })
      expect(await isPaid(b)).toBe(true)
    })
  })

  describe('guard 4: every status has its own decision', () => {
    // [status, bills?, why]. "Unchanged" is a decision, asserted as one.
    const decisions: Array<[Status, boolean, string]> = [
      ['COMPLETED', true, 'work performed'],
      ['IN_PROGRESS', true, 'work being performed'],
      ['SCHEDULED', true, 'deliberately unchanged by #588: still bills'],
      ['CONFIRMED', true, 'deliberately unchanged by #588: still bills'],
      ['NO_SHOW', true, 'unchanged: the clinic decides by the cost it types'],
      ['RESCHEDULED', true, 'deliberately unchanged by #588: still bills'],
      ['CANCELLED', false, 'the fix: a visit that did not happen is not debt'],
    ]

    for (const [status, bills, why] of decisions) {
      const expected = bills ? 150 : 0
      const verb = bills ? 'BILLS' : 'does NOT bill'

      it(`${status} ${verb} (${why}) - statement`, async () => {
        const patientId = await newPatient()
        await seedAppointment(patientId, 150, status)
        expect((await statement(patientId)).totalBilled).toBe(expected)
      })

      it(`${status} ${verb} (${why}) - balance`, async () => {
        const patientId = await newPatient()
        await seedAppointment(patientId, 150, status)
        expect((await balance(patientId)).totalDebt).toBe(expected)
      })

      it(`${status} ${verb} (${why}) - debtors`, async () => {
        const patientId = await newPatient()
        await seedAppointment(patientId, 150, status)
        expect((await outstanding(patientId))?.totalDebt ?? 0).toBe(expected)
      })
    }
  })

  describe('guard 5: a soft-deleted appointment still does not bill', () => {
    it('statement: an inactive COMPLETED 2300 contributes 0', async () => {
      const patientId = await newPatient()
      await seedAppointment(patientId, 2300, 'COMPLETED', false)
      expect((await statement(patientId)).totalBilled).toBe(0)
    })

    it('balance: an inactive COMPLETED 2300 contributes 0', async () => {
      const patientId = await newPatient()
      await seedAppointment(patientId, 2300, 'COMPLETED', false)
      expect((await balance(patientId)).totalDebt).toBe(0)
    })

    it('debtors: an inactive COMPLETED 2300 contributes 0 and is not listed', async () => {
      const patientId = await newPatient()
      await seedAppointment(patientId, 2300, 'COMPLETED', false)
      expect((await outstanding(patientId))?.totalDebt ?? 0).toBe(0)
      expect((await listDebtors(tenantId)).map((d) => d.patientId)).not.toContain(patientId)
    })
  })

  describe('guard 6 (API half): emptying the cost clears it', () => {
    it('PUT cost: null is accepted and the stored cost becomes null', async () => {
      const patientId = await newPatient()
      const a = await seedAppointment(patientId, 500, 'COMPLETED')

      const res = await put(a, { cost: null })
      expect(res.status).toBe(200)

      expect((await prisma.appointment.findUniqueOrThrow({ where: { id: a } })).cost).toBeNull()
      expect((await statement(patientId)).totalBilled).toBe(0)
    })

    it('clearing the cost re-runs FIFO: the money that covered A flows to B (isPaid true, credit 50)', async () => {
      const patientId = await newPatient()
      const a = await createViaApi(patientId, 100)
      const b = await createViaApi(patientId, 50)
      const adv = await api()
        .post(`/api/patients/${patientId}/payments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: 100, date: new Date().toISOString() })
      expect(adv.status).toBe(201)
      expect(await isPaid(a)).toBe(true)
      expect(await isPaid(b)).toBe(false)

      expect((await put(a, { cost: null })).status).toBe(200)

      expect(await isPaid(b)).toBe(true)
      expect(await statement(patientId)).toMatchObject({ totalBilled: 50, appointmentsDebt: 0, advancesCredit: 50 })
    })

    it('a typed 0 still works: the stored cost is 0, not null', async () => {
      const patientId = await newPatient()
      const a = await seedAppointment(patientId, 500, 'COMPLETED')

      const res = await put(a, { cost: 0 })
      expect(res.status).toBe(200)

      expect(Number((await prisma.appointment.findUniqueOrThrow({ where: { id: a } })).cost)).toBe(0)
    })

    it('omitting cost leaves the stored cost untouched', async () => {
      const patientId = await newPatient()
      const a = await seedAppointment(patientId, 500, 'COMPLETED')

      expect((await put(a, { notes: 'no cost key' })).status).toBe(200)

      expect(Number((await prisma.appointment.findUniqueOrThrow({ where: { id: a } })).cost)).toBe(500)
    })

    it('create still rejects cost: null (clearing is an update-only concept)', async () => {
      const patientId = await newPatient()
      const { start, end } = slot()
      const res = await api()
        .post('/api/appointments')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ patientId, doctorId, startTime: start.toISOString(), endTime: end.toISOString(), cost: null })
      expect(res.status).toBe(400)
    })
  })
})
