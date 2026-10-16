import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { prisma } from '@dental/database'

import {
  formatResult,
  parseArgs,
  repairCancelledAppointmentPayments,
} from './repair-cancelled-appointment-payments.js'
import {
  SYSTEM_ACTOR_REPAIR_597,
  getPatientAccountStatement,
  recalculatePaidStatus,
} from '../services/payment.service.js'
import { getAppointmentStats, getAppointmentsByDoctor, getAppointmentsByPatient } from '../services/appointment.service.js'
import { getOverviewStats } from '../services/stats.service.js'
import { createCancelledFixture, type CancelledFixture } from '../test/cancelled-fixture.js'

/**
 * Task #597, script half. The guards are referenced BY NUMBER from the task
 * body (guards 1-4 and 8 live here; 5-7 in the appointment restore suite, 9 in
 * the SQL-twin suite).
 *
 * Every state is seeded directly: a row cancelled through the ordinary edit
 * BEFORE #596 (isActive true, status CANCELLED, frozen isPaid true, payment
 * still earmarked) can no longer be produced through the API, and it is the
 * state the repair exists for. It was reachable in production, so the fixture
 * does not build an impossible state.
 *
 * Every repair call passes `tenantId`, so a foreign row already in dental_test
 * can neither change an exact count nor be modified by an --apply here.
 */

/**
 * Local mirror of getPaidStatus in apps/app/src/components/payments/PaidStatusBadge.tsx
 * (the api package cannot import the React module). Only the inputs each render
 * site actually passes are reproduced: PatientAppointmentsSection passes
 * paidAmount and recordedPaidAmount; AppointmentCard and
 * DoctorAppointmentsSection pass isPaid and cost alone.
 */
function paidStatus(p: {
  isPaid: boolean
  cost: number
  paidAmount?: number
  recordedPaidAmount?: number
}): string {
  const amount = p.paidAmount ?? (p.isPaid ? p.cost : 0)
  if (p.isPaid) {
    if (p.recordedPaidAmount === undefined) return 'paid'
    const charged = Math.min(p.recordedPaidAmount, amount)
    if (charged <= 0) return 'covered'
    return charged >= amount ? 'charged' : 'mixed'
  }
  if (amount > 0) return 'partial'
  return 'pending'
}

describe('repairCancelledAppointmentPayments (#597)', () => {
  let fx: CancelledFixture
  let p1: string
  let p2: string

  let aC1: string // cancelled, cost 100, frozen isPaid true, two earmarked payments (60 + 40)
  let aOk: string // COMPLETED, cost 200, isPaid true, earmarked 200
  let aC0: string // cancelled, cost 50, isPaid false, no payment at all
  let aDel: string // soft-deleted cancelled, cost 70, isPaid true, earmarked 70
  let aC2: string // second patient: cancelled, cost 80, frozen isPaid true, earmarked 80
  let pC1a: string
  let pC1b: string
  let pDead: string // reversed (isActive false) earmark on aC1
  let pOk: string
  let pDel: string
  let pC2: string

  beforeAll(async () => {
    fx = await createCancelledFixture('repair-597')
  })

  afterAll(async () => {
    await fx.destroy()
  })

  beforeEach(async () => {
    await fx.wipe()
    p1 = await fx.newPatient('holder-one')
    p2 = await fx.newPatient('holder-two')

    aC1 = await fx.appointment(p1, 3, 100, { status: 'CANCELLED', isPaid: true })
    aOk = await fx.appointment(p1, 4, 200, { status: 'COMPLETED', isPaid: true })
    aC0 = await fx.appointment(p1, 5, 50, { status: 'CANCELLED', isPaid: false })
    aDel = await fx.appointment(p1, 6, 70, { status: 'CANCELLED', isPaid: true, isActive: false })
    aC2 = await fx.appointment(p2, 7, 80, { status: 'CANCELLED', isPaid: true })

    pC1a = await fx.payment(p1, 60, { kind: 'APPOINTMENT', appointmentId: aC1, note: 'Pago en consulta' })
    pC1b = await fx.payment(p1, 40, { kind: 'APPOINTMENT', appointmentId: aC1, note: null })
    pDead = await fx.payment(p1, 30, { kind: 'APPOINTMENT', appointmentId: aC1, isActive: false })
    pOk = await fx.payment(p1, 200, { kind: 'APPOINTMENT', appointmentId: aOk, note: 'Consulta normal' })
    pDel = await fx.payment(p1, 70, { kind: 'APPOINTMENT', appointmentId: aDel, note: 'Cita borrada' })
    pC2 = await fx.payment(p2, 80, { kind: 'APPOINTMENT', appointmentId: aC2, note: 'Pago' })
  })

  const count = () => repairCancelledAppointmentPayments({ apply: false, tenantId: fx.tenantId })
  const apply = () => repairCancelledAppointmentPayments({ apply: true, tenantId: fx.tenantId })

  /** The raw columns, read from the rows themselves (never through a merge). */
  const appointmentRow = (id: string) => prisma.appointment.findUniqueOrThrow({ where: { id } })
  const paymentRow = (id: string) => prisma.patientPayment.findUniqueOrThrow({ where: { id } })

  async function tenantState() {
    return {
      appointments: await prisma.appointment.findMany({ where: { tenantId: fx.tenantId }, orderBy: { id: 'asc' } }),
      payments: await prisma.patientPayment.findMany({ where: { tenantId: fx.tenantId }, orderBy: { id: 'asc' } }),
      events: await prisma.patientPaymentEvent.findMany({
        where: { tenantId: fx.tenantId },
        select: { paymentId: true, type: true, actorUserId: true },
        orderBy: [{ paymentId: 'asc' }, { type: 'asc' }],
      }),
    }
  }

  describe('the count (no --apply)', () => {
    it('counts the population and modifies nothing', async () => {
      const before = await tenantState()
      const result = await count()

      expect(result.applied).toBe(false)
      expect(result.paymentCount).toBe(3)
      expect(result.appointmentCount).toBe(2)
      expect(result.frozenIsPaidCount).toBe(2)
      expect(result.patientCount).toBe(2)
      expect(result.paidStatusChanges).toBe(0)
      expect(result.rows.map((r) => r.paymentId).sort()).toEqual([pC1a, pC1b, pC2].sort())
      expect(await tenantState()).toEqual(before)
    })
  })

  describe('guard 1: a row cancelled before #596 stops reading "Cubierto por saldo"', () => {
    async function renderedBothSites() {
      const siteA = (await getAppointmentsByPatient(fx.tenantId, p1)).find((a) => a.id === aC1)!
      const siteB = (await getAppointmentsByDoctor(fx.tenantId, fx.doctorId)).find((a) => a.id === aC1)!
      return {
        patientSection: paidStatus({
          isPaid: siteA.isPaid,
          cost: Number(siteA.cost),
          paidAmount: siteA.paidAmount,
          recordedPaidAmount: siteA.recordedPaidAmount,
        }),
        doctorSection: paidStatus({ isPaid: siteB.isPaid, cost: Number(siteB.cost) }),
      }
    }

    it('before the repair the fixture reproduces the symptom (patient section: covered, doctor section: paid)', async () => {
      expect(await renderedBothSites()).toEqual({ patientSection: 'covered', doctorSection: 'paid' })
    })

    it('after the repair neither render site reads covered or paid', async () => {
      await apply()
      expect(await renderedBothSites()).toEqual({ patientSection: 'pending', doctorSection: 'pending' })
    })
  })

  describe('the repair itself', () => {
    it('converts each earmarked payment to an ADVANCE with the suffix and one system-actor event, and clears isPaid', async () => {
      await apply()

      expect(await paymentRow(pC1a)).toMatchObject({ kind: 'ADVANCE', note: 'Pago en consulta (cita cancelada)' })
      expect(await paymentRow(pC1b)).toMatchObject({ kind: 'ADVANCE', note: ' (cita cancelada)' })
      expect(await paymentRow(pC2)).toMatchObject({ kind: 'ADVANCE', note: 'Pago (cita cancelada)' })
      expect((await appointmentRow(aC1)).isPaid).toBe(false)
      expect((await appointmentRow(aC2)).isPaid).toBe(false)

      const events = await prisma.patientPaymentEvent.findMany({
        where: { tenantId: fx.tenantId },
        select: { paymentId: true, type: true, actorUserId: true },
        orderBy: { paymentId: 'asc' },
      })
      expect(events).toEqual(
        [pC1a, pC1b, pC2]
          .sort()
          .map((paymentId) => ({ paymentId, type: 'CONVERTED_TO_ADVANCE', actorUserId: SYSTEM_ACTOR_REPAIR_597 }))
      )
    })
  })

  describe('guard 2: the repair is idempotent', () => {
    it('a second run reports zero rows and moves no figure', async () => {
      const first = await apply()
      expect(first.paymentCount).toBe(3)

      const afterFirst = await tenantState()
      const statementAfterFirst = await getPatientAccountStatement(fx.tenantId, p1)

      const second = await apply()
      expect(second).toMatchObject({
        applied: true,
        paymentCount: 0,
        appointmentCount: 0,
        frozenIsPaidCount: 0,
        patientCount: 0,
        paidStatusChanges: 0,
        rows: [],
      })
      expect(await tenantState()).toEqual(afterFirst)
      expect(await getPatientAccountStatement(fx.tenantId, p1)).toEqual(statementAfterFirst)
    })
  })

  describe('guard 3: the count and the repair agree', () => {
    it('the count taken immediately before equals what the repair reports and what actually changed', async () => {
      const counted = await count()
      const repaired = await apply()

      expect(repaired.paymentCount).toBe(counted.paymentCount)
      expect(repaired.appointmentCount).toBe(counted.appointmentCount)
      expect(repaired.frozenIsPaidCount).toBe(counted.frozenIsPaidCount)
      expect(repaired.patientCount).toBe(counted.patientCount)
      expect(repaired.rows).toEqual(counted.rows)

      // The reported number against the database, not against itself.
      const convertedInDb = await prisma.patientPaymentEvent.count({
        where: { tenantId: fx.tenantId, type: 'CONVERTED_TO_ADVANCE', actorUserId: SYSTEM_ACTOR_REPAIR_597 },
      })
      expect(convertedInDb).toBe(counted.paymentCount)
      const clearedInDb = await prisma.appointment.count({
        where: { tenantId: fx.tenantId, id: { in: [aC1, aC2] }, isPaid: false },
      })
      expect(clearedInDb).toBe(counted.frozenIsPaidCount)
    })
  })

  describe('guard 4: it touches nothing else', () => {
    it('a cancelled row without an earmark, a COMPLETED row with cost and payment, a soft-deleted cancelled row and a reversed payment are byte-identical', async () => {
      const untouchedAppointments = [aC0, aOk, aDel]
      const untouchedPayments = [pOk, pDel, pDead]
      const before = {
        appointments: await Promise.all(untouchedAppointments.map(appointmentRow)),
        payments: await Promise.all(untouchedPayments.map(paymentRow)),
      }

      await apply()

      expect({
        appointments: await Promise.all(untouchedAppointments.map(appointmentRow)),
        payments: await Promise.all(untouchedPayments.map(paymentRow)),
      }).toEqual(before)
      // And none of them grew an event.
      expect(
        await prisma.patientPaymentEvent.count({
          where: { tenantId: fx.tenantId, paymentId: { in: untouchedPayments } },
        })
      ).toBe(0)
    })

    it('the COMPLETED row keeps its kind=APPOINTMENT earmark', async () => {
      await apply()
      expect(await paymentRow(pOk)).toMatchObject({ kind: 'APPOINTMENT', note: 'Consulta normal' })
    })
  })

  describe('paidStatusChanges (does the SQL twin need the FIFO re-derivation?)', () => {
    it('is 0 when no other billable item is waiting on credit', async () => {
      const result = await apply()
      expect(result.paidStatusChanges).toBe(0)
    })

    it('is NOT 0 when the converted money becomes credit that covers open debt on the same patient', async () => {
      // P3 owes 80 on a COMPLETED visit and holds a cancelled visit whose 100
      // earmark, once converted, is free credit that FIFO applies to that debt.
      const p3 = await fx.newPatient('holder-three')
      await fx.appointment(p3, 8, 100, { status: 'CANCELLED', isPaid: true })
      const debt = await fx.appointment(p3, 9, 80, { status: 'COMPLETED', isPaid: false })
      const cancelled = (await prisma.appointment.findFirstOrThrow({ where: { patientId: p3, status: 'CANCELLED' } })).id
      await fx.payment(p3, 100, { kind: 'APPOINTMENT', appointmentId: cancelled })

      const result = await apply()

      expect(result.paidStatusChanges).toBe(1)
      expect((await appointmentRow(debt)).isPaid).toBe(true)
    })
  })

  describe('guard 8: the accrual figures move with the repair', () => {
    // Fixture: COMPLETED cost 200 isPaid true (aOk) + two cancelled rows with a
    // frozen isPaid true (aC1 cost 100, aC2 cost 80) in the current month. The
    // soft-deleted cancelled row (cost 70) is isActive false and is in neither.
    it('before: stats accrual = 380 (200 + 100 + 80), appointment revenue = 380', async () => {
      expect((await getOverviewStats(fx.tenantId)).monthlyBilledPaid).toBe(380)
      expect((await getAppointmentStats(fx.tenantId)).revenue).toBe(380)
    })

    it('after the repair: stats accrual = 200 (only the COMPLETED visit)', async () => {
      await apply()
      expect((await getOverviewStats(fx.tenantId)).monthlyBilledPaid).toBe(200)
    })

    it('after the repair: appointment revenue = 200', async () => {
      await apply()
      expect((await getAppointmentStats(fx.tenantId)).revenue).toBe(200)
    })
  })

  describe('recalculation is not what the repair relies on to clear the column', () => {
    it('recalculatePaidStatus alone leaves the frozen isPaid on a cancelled row (the defect the repair exists for)', async () => {
      await recalculatePaidStatus(fx.tenantId, p1)
      expect((await appointmentRow(aC1)).isPaid).toBe(true)
    })
  })

  describe('arguments and output', () => {
    it('counts by default and takes no connection argument', () => {
      expect(parseArgs([])).toEqual({ apply: false, tenantId: undefined, json: false })
      expect(parseArgs(['--apply', '--tenant=t1', '--json'])).toEqual({ apply: true, tenantId: 't1', json: true })
      expect(() => parseArgs(['--database-url=postgresql://x'])).toThrow('Unknown argument: --database-url=postgresql://x')
    })

    it('formats a count without claiming anything was changed', async () => {
      const text = formatResult(await count())
      expect(text).toContain('COUNT ONLY')
      expect(text).toContain('Would convert 3 payment(s) across 2 patient(s).')
      expect(text).toContain('Would clear isPaid on 2 of 2 appointment(s)')
      expect(text).toContain('Nothing was modified.')
      expect(text).not.toMatch(/Applied\./)
    })
  })
})
