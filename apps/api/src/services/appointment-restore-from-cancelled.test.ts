import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { prisma } from '@dental/database'

import { getAppointmentById, getAppointmentStats, updateAppointment } from './appointment.service.js'
import { getPatientAccountStatement, recalculatePaidStatus } from './payment.service.js'
import { getOverviewStats } from './stats.service.js'
import { createCancelledFixture, type CancelledFixture } from '../test/cancelled-fixture.js'

/**
 * Task #597, the round trip through the ordinary edit: guards 5, 6, 7 and the
 * restore half of 8 (the repair script's half lives beside the script).
 *
 * The starting state IS reachable through the API: a visit with a payment
 * recorded against it (kind APPOINTMENT) and isPaid derived by FIFO. The cancel
 * and the restore are both real updateAppointment calls.
 *
 * isPaid is always read from the ROW (prisma.appointment), never through
 * getAppointmentById / mergeAllocation, which overwrite the rendered status
 * from the FIFO allocation and so cannot see a stale column. The merged read is
 * used only where the test is explicitly about the display.
 */
describe('leaving CANCELLED through updateAppointment (#597)', () => {
  let fx: CancelledFixture
  let patientId: string
  let visit: string // cost 100, earmarked 100
  let other: string // COMPLETED, cost 200, earmarked 200
  let visitPayment: string

  beforeAll(async () => {
    fx = await createCancelledFixture('restore-597')
  })

  afterAll(async () => {
    await fx.destroy()
  })

  beforeEach(async () => {
    await fx.wipe()
    patientId = await fx.newPatient('round-trip')
    visit = await fx.appointment(patientId, 3, 100, { status: 'SCHEDULED' })
    other = await fx.appointment(patientId, 4, 200, { status: 'COMPLETED' })
    visitPayment = await fx.payment(patientId, 100, { kind: 'APPOINTMENT', appointmentId: visit, note: 'Pago' })
    await fx.payment(patientId, 200, { kind: 'APPOINTMENT', appointmentId: other })
    await recalculatePaidStatus(fx.tenantId, patientId)
  })

  const cancel = () => updateAppointment(fx.tenantId, visit, { status: 'CANCELLED' }, null)
  const restore = (status: 'SCHEDULED' | 'NO_SHOW' = 'SCHEDULED') =>
    updateAppointment(fx.tenantId, visit, { status }, null)

  /** Raw columns, read from the rows themselves. */
  const row = () => prisma.appointment.findUniqueOrThrow({ where: { id: visit }, select: { isPaid: true, status: true } })
  const payment = () =>
    prisma.patientPayment.findUniqueOrThrow({ where: { id: visitPayment }, select: { kind: true, note: true } })
  async function figures() {
    const r = await getPatientAccountStatement(fx.tenantId, patientId)
    if (!r.success) throw new Error('statement failed')
    const { totalPaid, totalBilled, advancesCredit } = r.data
    return { totalPaid, totalBilled, advancesCredit }
  }

  it('the starting state: the visit is paid by its own earmark', async () => {
    expect(await row()).toEqual({ isPaid: true, status: 'SCHEDULED' })
    expect(await payment()).toEqual({ kind: 'APPOINTMENT', note: 'Pago' })
    expect(await figures()).toEqual({ totalPaid: 300, totalBilled: 300, advancesCredit: 0 })
  })

  describe('guard 5: leaving CANCELLED restores the imputation', () => {
    it('cancelling turns the money into credit', async () => {
      await cancel()
      expect(await payment()).toEqual({ kind: 'ADVANCE', note: 'Pago (cita cancelada)' })
      expect(await figures()).toEqual({ totalPaid: 300, totalBilled: 200, advancesCredit: 100 })
    })

    it('editing back to SCHEDULED makes it an earmark on the visit again, with the original note', async () => {
      await cancel()
      await restore()
      expect(await payment()).toEqual({ kind: 'APPOINTMENT', note: 'Pago' })
    })

    it('editing to another non-CANCELLED status (NO_SHOW) restores it too', async () => {
      await cancel()
      await restore('NO_SHOW')
      expect(await payment()).toEqual({ kind: 'APPOINTMENT', note: 'Pago' })
    })

    it('records a RESTORED_TO_APPOINTMENT event for it', async () => {
      await cancel()
      await restore()
      const types = (await prisma.patientPaymentEvent.findMany({ where: { paymentId: visitPayment }, orderBy: { occurredAt: 'asc' } })).map(
        (e) => e.type
      )
      expect(types).toEqual(['CONVERTED_TO_ADVANCE', 'RESTORED_TO_APPOINTMENT'])
    })

    it('an edit that does not change the status (notes) leaves a cancelled visit credit', async () => {
      await cancel()
      await updateAppointment(fx.tenantId, visit, { notes: 'sin cambio de estado' }, null)
      expect(await payment()).toEqual({ kind: 'ADVANCE', note: 'Pago (cita cancelada)' })
    })

    it('a soft-deleted cancelled visit restores nothing when its status is edited', async () => {
      await cancel()
      await prisma.appointment.update({ where: { id: visit }, data: { isActive: false } })
      await restore()
      expect(await payment()).toEqual({ kind: 'ADVANCE', note: 'Pago (cita cancelada)' })
    })
  })

  describe('guard 6: the round trip is value-preserving', () => {
    it('totalPaid, totalBilled and advancesCredit after cancel -> restore equal their values before the cancel', async () => {
      const before = await figures()
      await cancel()
      await restore()
      expect(await figures()).toEqual(before)
      expect(before).toEqual({ totalPaid: 300, totalBilled: 300, advancesCredit: 0 })
    })

    it('and the cancel in between did move them (so equality is not vacuous)', async () => {
      const before = await figures()
      await cancel()
      expect(await figures()).not.toEqual(before)
    })
  })

  describe('guard 7: leaving CANCELLED re-derives the isPaid COLUMN', () => {
    it('cancelling writes false to the row', async () => {
      await cancel()
      expect((await row()).isPaid).toBe(false)
    })

    it('the row reads isPaid true after the edit back to SCHEDULED (read from the row, not the merged allocation)', async () => {
      await cancel()
      await restore()
      expect((await row()).isPaid).toBe(true)
    })

    it('the DISPLAY is right either way: the merged read reports the visit paid in full', async () => {
      await cancel()
      await restore()
      const merged = await getAppointmentById(fx.tenantId, visit)
      expect(merged).toMatchObject({ paidAmount: 100, outstanding: 0, isPaid: true })
    })
  })

  describe('guard 8: the accrual figures move with the restore', () => {
    // Fixture: the visit (cost 100) and a COMPLETED visit (cost 200), both paid,
    // both in the current month.
    it('before the cancel: stats accrual = 300 and appointment revenue = 300', async () => {
      expect((await getOverviewStats(fx.tenantId)).monthlyBilledPaid).toBe(300)
      expect((await getAppointmentStats(fx.tenantId)).revenue).toBe(300)
    })

    it('after the cancel: both = 200', async () => {
      await cancel()
      expect((await getOverviewStats(fx.tenantId)).monthlyBilledPaid).toBe(200)
      expect((await getAppointmentStats(fx.tenantId)).revenue).toBe(200)
    })

    it('after the restore: stats accrual = 300 again', async () => {
      await cancel()
      await restore()
      expect((await getOverviewStats(fx.tenantId)).monthlyBilledPaid).toBe(300)
    })

    it('after the restore: appointment revenue = 300 again', async () => {
      await cancel()
      await restore()
      expect((await getAppointmentStats(fx.tenantId)).revenue).toBe(300)
    })
  })
})
