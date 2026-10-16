import { prisma } from '@dental/database'

/**
 * Shared DB fixture for the #597 suites (repair script, SQL twin, and the
 * leave-CANCELLED restore). Not a test file: vitest only collects *.test.ts.
 *
 * Every row is created directly, because the states under test cannot be
 * produced through the API any more: since #596 the cancel edit itself clears
 * isPaid and converts the earmark, so "a row cancelled BEFORE #596" exists
 * only as data. No patient names: rows are labelled by role.
 */
export interface CancelledFixture {
  tenantId: string
  doctorId: string
  newPatient(label: string): Promise<string>
  /** A start time inside the current calendar month, so the accrual stats see it. */
  thisMonth(day: number): Date
  appointment(
    patientId: string,
    day: number,
    cost: number | null,
    overrides?: Record<string, unknown>
  ): Promise<string>
  payment(
    patientId: string,
    amount: number,
    overrides?: Record<string, unknown>
  ): Promise<string>
  wipe(): Promise<void>
  destroy(): Promise<void>
}

export async function createCancelledFixture(label: string): Promise<CancelledFixture> {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  let freePlan = await prisma.plan.findUnique({ where: { name: 'free' } })
  if (!freePlan) {
    freePlan = await prisma.plan.create({
      data: { name: 'free', displayName: 'Free', price: 0, maxAdmins: 1, maxDoctors: 3, maxPatients: 50 },
    })
  }
  const tenant = await prisma.tenant.create({
    data: { name: `Fixture ${label}`, slug: `fixture-${label}-${suffix}` },
  })
  const tenantId = tenant.id
  await prisma.subscription.create({
    data: {
      tenantId,
      planId: freePlan.id,
      status: 'ACTIVE',
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  })
  const doctorId = (
    await prisma.doctor.create({
      data: {
        tenantId,
        firstName: 'Doctor',
        lastName: label,
        email: `fixture-${label}-${suffix}@test.com`,
      },
    })
  ).id

  let seq = 0
  const thisMonth = (day: number) => {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth(), day, 10, 0, 0, 0)
  }

  const wipe = async () => {
    await prisma.patientPaymentEvent.deleteMany({ where: { tenantId } })
    await prisma.patientPayment.deleteMany({ where: { tenantId } })
    await prisma.labwork.deleteMany({ where: { tenantId } })
    await prisma.appointment.deleteMany({ where: { tenantId } })
    await prisma.patient.deleteMany({ where: { tenantId } })
  }

  return {
    tenantId,
    doctorId,
    thisMonth,
    async newPatient(role) {
      seq += 1
      return (
        await prisma.patient.create({
          data: { tenantId, firstName: `Patient${seq}`, lastName: role },
        })
      ).id
    },
    async appointment(patientId, day, cost, overrides = {}) {
      const start = thisMonth(day)
      return (
        await prisma.appointment.create({
          data: {
            tenantId,
            patientId,
            doctorId,
            startTime: start,
            endTime: new Date(start.getTime() + 30 * 60 * 1000),
            duration: 30,
            cost,
            ...overrides,
          },
        })
      ).id
    },
    async payment(patientId, amount, overrides = {}) {
      return (
        await prisma.patientPayment.create({
          data: { tenantId, patientId, amount, date: new Date(), kind: 'ADVANCE', ...overrides },
        })
      ).id
    },
    wipe,
    async destroy() {
      await wipe()
      await prisma.doctor.deleteMany({ where: { tenantId } })
      await prisma.subscription.deleteMany({ where: { tenantId } })
      await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {})
    },
  }
}
