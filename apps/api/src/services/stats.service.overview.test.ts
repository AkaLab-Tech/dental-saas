/**
 * getOverviewStats — dashboard "pending payments" (task #396).
 *
 * These tests are DB-backed on purpose: the headline acceptance criterion is
 * that the dashboard figure and the debtors screen can never disagree, and
 * that can only be shown by running BOTH real queries over one seeded tenant.
 *
 * They live in this sibling file rather than inside stats.service.test.ts
 * because that file mocks the whole `@dental/database` module (a hoisted,
 * file-scoped `vi.mock` exposing only doctor/appointment/labwork.findMany),
 * so no real Prisma call — and therefore no cross-check against listDebtors —
 * is reachable from it. stats.service.test.ts is left untouched.
 *
 * Money fixtures are 2-decimal clinic amounts (178.30 / 165.95, not round
 * hundreds) so that a cents-level drift in the aggregation would actually
 * fail an assertion; the one exception is the explicit 1000/600 -> 400
 * headline case from the acceptance criteria.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { prisma } from '@dental/database'
import { getOverviewStats } from './stats.service.js'
import { listDebtors } from './payment.service.js'
import { deleteAppointment } from './appointment.service.js'

describe('stats.service — getOverviewStats pendingPayments (#396)', () => {
  let tenantId: string
  let doctorId: string
  let partialId: string
  let settledId: string
  let unpaidId: string
  let creditId: string
  const suffix = Date.now()

  async function seedAppointment(
    forPatientId: string,
    cost: number | null,
    overrides: Record<string, unknown> = {}
  ) {
    return prisma.appointment.create({
      data: {
        tenantId,
        patientId: forPatientId,
        doctorId,
        startTime: new Date(Date.now() + 3600_000),
        endTime: new Date(Date.now() + 5400_000),
        duration: 30,
        cost,
        ...overrides,
      },
    })
  }

  async function seedPayment(
    forPatientId: string,
    amount: number,
    overrides: Record<string, unknown> = {}
  ) {
    return prisma.patientPayment.create({
      data: {
        tenantId,
        patientId: forPatientId,
        amount,
        date: new Date(),
        kind: 'ADVANCE',
        ...overrides,
      },
    })
  }

  async function seedLabwork(forPatientId: string, price: number, overrides: Record<string, unknown> = {}) {
    return prisma.labwork.create({
      data: {
        tenantId,
        patientId: forPatientId,
        lab: 'Lab Central',
        date: new Date(),
        price,
        ...overrides,
      },
    })
  }

  function sumOutstanding(debtors: { outstanding: number }[]): number {
    return debtors.reduce((sum, d) => sum + d.outstanding, 0)
  }

  beforeAll(async () => {
    let freePlan = await prisma.plan.findUnique({ where: { name: 'free' } })
    if (!freePlan) {
      freePlan = await prisma.plan.create({
        data: { name: 'free', displayName: 'Free', price: 0, maxAdmins: 1, maxDoctors: 3, maxPatients: 50 },
      })
    }
    const tenant = await prisma.tenant.create({
      data: { name: 'Overview Svc', slug: `overview-svc-${suffix}` },
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
    doctorId = (
      await prisma.doctor.create({
        data: { tenantId, firstName: 'Overview', lastName: 'Doctor', email: `overview-doc-${suffix}@test.com` },
      })
    ).id
    partialId = (await prisma.patient.create({ data: { tenantId, firstName: 'Partial', lastName: 'Uno' } })).id
    settledId = (await prisma.patient.create({ data: { tenantId, firstName: 'Settled', lastName: 'Dos' } })).id
    unpaidId = (await prisma.patient.create({ data: { tenantId, firstName: 'Unpaid', lastName: 'Tres' } })).id
    creditId = (await prisma.patient.create({ data: { tenantId, firstName: 'Credit', lastName: 'Cuatro' } })).id
  })

  afterAll(async () => {
    await prisma.patientPayment.deleteMany({ where: { tenantId } })
    await prisma.labwork.deleteMany({ where: { tenantId } })
    await prisma.appointment.deleteMany({ where: { tenantId } })
    await prisma.patient.deleteMany({ where: { tenantId } })
    await prisma.doctor.deleteMany({ where: { tenantId } })
    await prisma.subscription.deleteMany({ where: { tenantId } })
    await prisma.tenant.delete({ where: { id: tenantId } })
  })

  beforeEach(async () => {
    await prisma.patientPayment.deleteMany({ where: { tenantId } })
    await prisma.labwork.deleteMany({ where: { tenantId } })
    await prisma.appointment.deleteMany({ where: { tenantId } })
  })

  it('equals the sum of the debtors screen outstanding column, exactly, over a mixed tenant', async () => {
    // One tenant containing every shape at once: partially paid, fully paid,
    // unpaid, a patient in credit, and a billable labwork.
    await seedAppointment(partialId, 178.3)
    await seedPayment(partialId, 165.95) // -> 12.35
    await seedLabwork(partialId, 43.75) // -> partial patient now 56.10
    await seedAppointment(settledId, 210.45)
    await seedPayment(settledId, 210.45) // -> 0
    await seedAppointment(unpaidId, 99.99) // -> 99.99
    await seedAppointment(creditId, 45.6)
    await seedPayment(creditId, 120.0) // -> 0, 74.40 credit that must not offset anyone

    const [overview, debtors] = await Promise.all([getOverviewStats(tenantId), listDebtors(tenantId)])

    // 56.10 + 0 + 99.99 + 0 = 156.09. toBe, not toBeCloseTo: the two figures
    // are produced by the same cents-based aggregation, so anything other
    // than bit-identical equality is the defect this task exists to prevent.
    expect(overview.pendingPayments).toBe(156.09)
    expect(overview.pendingPayments).toBe(sumOutstanding(debtors))
    expect(debtors.map((d) => d.patientId).sort()).toEqual([partialId, unpaidId].sort())
  })

  it('reports 400 for a 1000 appointment with 600 paid (the acceptance-criteria headline case)', async () => {
    await seedAppointment(partialId, 1000)
    await seedPayment(partialId, 600)

    const overview = await getOverviewStats(tenantId)

    expect(overview.pendingPayments).toBe(400)
    expect(overview.pendingPayments).toBe(sumOutstanding(await listDebtors(tenantId)))
  })

  it('is null when the overview is doctor-scoped (payments carry no doctor attribution)', async () => {
    await seedAppointment(partialId, 178.3)
    await seedPayment(partialId, 165.95)

    const overview = await getOverviewStats(tenantId, doctorId)

    expect(overview.pendingPayments).toBeNull()
    // The rest of the doctor-scoped overview is still computed.
    expect(overview.totalAppointments).toBe(1)
  })

  it('stays consistent with listDebtors after an appointment is cancelled (post-#391 ADVANCE conversion)', async () => {
    // deleteAppointment converts the linked kind=APPOINTMENT payment to
    // ADVANCE inside its transaction and then recalculates isPaid. The
    // money is still the patient's, so cancelling must remove the
    // appointment's cost from the debt WITHOUT dropping the payment.
    const cancelled = await seedAppointment(partialId, 88.4)
    await seedPayment(partialId, 88.4, { kind: 'APPOINTMENT', appointmentId: cancelled.id, note: 'Pago en consulta' })
    await seedAppointment(partialId, 178.3)

    const before = await getOverviewStats(tenantId)
    expect(before.pendingPayments).toBe(178.3) // (88.40 + 178.30) - 88.40

    const result = await deleteAppointment(tenantId, cancelled.id)
    expect(result.error).toBeUndefined()

    const converted = await prisma.patientPayment.findFirstOrThrow({
      where: { tenantId, appointmentId: cancelled.id },
    })
    expect(converted.kind).toBe('ADVANCE')
    expect(converted.isActive).toBe(true)

    const [after, debtors] = await Promise.all([getOverviewStats(tenantId), listDebtors(tenantId)])
    // 178.30 still billed, 88.40 still paid (now as an advance) -> 89.90.
    expect(after.pendingPayments).toBe(89.9)
    expect(after.pendingPayments).toBe(sumOutstanding(debtors))
  })

  it('reports exactly 0 with no fractional residue when a 2-decimal balance settles precisely', async () => {
    // 120.30 appointment + 0.43 labwork, settled by three separate
    // 2-decimal payments. Summed in dollars this chain lands a few ULPs off
    // and would report a fractional-cent residue instead of 0.
    await seedAppointment(settledId, 120.3)
    await seedLabwork(settledId, 0.43)
    await seedPayment(settledId, 40.1)
    await seedPayment(settledId, 80.2)
    await seedPayment(settledId, 0.43)

    const overview = await getOverviewStats(tenantId)

    expect(overview.pendingPayments).toBe(0)
    expect(await listDebtors(tenantId)).toEqual([])
  })
})
