import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import type { Mock } from 'vitest'
import { prisma } from '@dental/database'

// LOAD-BEARING (task #391): deleteAppointment/restoreAppointment wrap the
// soft-(un)delete and the payment conversion in ONE prisma.$transaction. A
// partial failure that lands the appointment as cancelled/restored while
// leaving its linked payment un-converted would be WORSE than the bug this
// task fixes, because a live kind=APPOINTMENT earmark on a cancelled
// appointment actively steers FIFO allocation. This file forces a
// mid-transaction failure (mocking the payment-conversion helper — an
// internal collaborator deleteAppointment/restoreAppointment genuinely call
// inside their transaction, not an unrelated layer) and asserts, against the
// real test DB, that BOTH writes rolled back together.
vi.mock('./payment.service.js', async () => {
  const actual = await vi.importActual<typeof import('./payment.service.js')>('./payment.service.js')
  return {
    ...actual,
    convertAppointmentPaymentsToAdvance: vi.fn(actual.convertAppointmentPaymentsToAdvance),
    restoreAppointmentPaymentsFromAdvance: vi.fn(actual.restoreAppointmentPaymentsFromAdvance),
  }
})

import { deleteAppointment, restoreAppointment } from './appointment.service.js'
import {
  convertAppointmentPaymentsToAdvance,
  restoreAppointmentPaymentsFromAdvance,
} from './payment.service.js'

describe('deleteAppointment / restoreAppointment transaction rollback (#391)', () => {
  let tenantId: string
  let patientId: string
  let doctorId: string
  const suffix = Date.now()

  beforeAll(async () => {
    let freePlan = await prisma.plan.findUnique({ where: { name: 'free' } })
    if (!freePlan) {
      freePlan = await prisma.plan.create({
        data: { name: 'free', displayName: 'Free', price: 0, maxAdmins: 1, maxDoctors: 3, maxPatients: 50 },
      })
    }
    const tenant = await prisma.tenant.create({
      data: { name: 'Rollback Svc', slug: `rollback-svc-${suffix}` },
    })
    tenantId = tenant.id
    await prisma.subscription.create({
      data: {
        tenantId,
        planId: freePlan.id,
        status: 'ACTIVE',
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    })
    const patient = await prisma.patient.create({ data: { tenantId, firstName: 'Rollback', lastName: 'Patient' } })
    patientId = patient.id
    const doctor = await prisma.doctor.create({
      data: { tenantId, firstName: 'Rollback', lastName: 'Doctor', email: `rollback-doc-${suffix}@test.com` },
    })
    doctorId = doctor.id
  })

  afterAll(async () => {
    await prisma.patientPayment.deleteMany({ where: { tenantId } })
    await prisma.appointment.deleteMany({ where: { tenantId } })
    await prisma.patient.deleteMany({ where: { tenantId } })
    await prisma.doctor.deleteMany({ where: { tenantId } })
    await prisma.subscription.deleteMany({ where: { tenantId } })
    await prisma.tenant.delete({ where: { id: tenantId } })
  })

  it('deleteAppointment: a mid-transaction failure in the payment conversion rolls back the appointment soft-delete too', async () => {
    const appointment = await prisma.appointment.create({
      data: {
        tenantId,
        patientId,
        doctorId,
        startTime: new Date(Date.now() + 3600_000),
        endTime: new Date(Date.now() + 5400_000),
        duration: 30,
        cost: 60,
      },
    })
    const payment = await prisma.patientPayment.create({
      data: {
        tenantId,
        patientId,
        appointmentId: appointment.id,
        amount: 60,
        date: new Date(),
        kind: 'APPOINTMENT',
        note: 'Pago en consulta',
      },
    })

    ;(convertAppointmentPaymentsToAdvance as unknown as Mock).mockRejectedValueOnce(
      new Error('boom: simulated mid-transaction failure')
    )

    await expect(deleteAppointment(tenantId, appointment.id)).rejects.toThrow(
      'boom: simulated mid-transaction failure'
    )

    // Neither write persisted: the appointment is still active/scheduled...
    const appointmentAfter = await prisma.appointment.findUniqueOrThrow({ where: { id: appointment.id } })
    expect(appointmentAfter.isActive).toBe(true)
    expect(appointmentAfter.status).toBe('SCHEDULED')

    // ...and the payment is still an active, un-converted APPOINTMENT earmark.
    const paymentAfter = await prisma.patientPayment.findUniqueOrThrow({ where: { id: payment.id } })
    expect(paymentAfter.kind).toBe('APPOINTMENT')
    expect(paymentAfter.isActive).toBe(true)
    expect(paymentAfter.note).toBe('Pago en consulta')

    expect(convertAppointmentPaymentsToAdvance).toHaveBeenCalledTimes(1)
  })

  it('restoreAppointment: a mid-transaction failure in the payment restore rolls back the appointment un-cancel too', async () => {
    const appointment = await prisma.appointment.create({
      data: {
        tenantId,
        patientId,
        doctorId,
        startTime: new Date(Date.now() + 7200_000),
        endTime: new Date(Date.now() + 9000_000),
        duration: 30,
        cost: 60,
        isActive: false,
        status: 'CANCELLED',
      },
    })
    const payment = await prisma.patientPayment.create({
      data: {
        tenantId,
        patientId,
        appointmentId: appointment.id,
        amount: 60,
        date: new Date(),
        kind: 'ADVANCE',
        note: 'Pago en consulta (cita cancelada)',
      },
    })

    ;(restoreAppointmentPaymentsFromAdvance as unknown as Mock).mockRejectedValueOnce(
      new Error('boom: simulated restore failure')
    )

    await expect(restoreAppointment(tenantId, appointment.id)).rejects.toThrow('boom: simulated restore failure')

    // Neither write persisted: the appointment is still cancelled/inactive...
    const appointmentAfter = await prisma.appointment.findUniqueOrThrow({ where: { id: appointment.id } })
    expect(appointmentAfter.isActive).toBe(false)
    expect(appointmentAfter.status).toBe('CANCELLED')

    // ...and the payment is still the un-restored ADVANCE row.
    const paymentAfter = await prisma.patientPayment.findUniqueOrThrow({ where: { id: payment.id } })
    expect(paymentAfter.kind).toBe('ADVANCE')
    expect(paymentAfter.note).toBe('Pago en consulta (cita cancelada)')

    expect(restoreAppointmentPaymentsFromAdvance).toHaveBeenCalledTimes(1)
  })
})
