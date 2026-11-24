import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { prisma } from '@dental/database'
import { getPatientBalance } from './payment.service.js'
import { createAppointment, getAppointmentById, updateAppointment } from './appointment.service.js'

/**
 * Task #717: the form now WARNS when a paidAmount is typed on a visit with no
 * charge of its own. The warning is informational; none of the money moves.
 * These guards pin the server-side facts the client's warning leans on, and
 * the behaviour that must not change:
 *
 *  - G4 / acceptance 3: the money of a charge-less paid appointment still
 *    becomes credit (alone) or pays the older charge (FIFO), exactly as before.
 *  - G3-API: only a POSITIVE-price EXECUTED link reaches the appointment's
 *    `budgetItems`. A zero-price link produces no entry at all, which is what
 *    the client reads as "no charge" (absence), so that reading is not a
 *    coincidence of the client fixture. A cost-0 visit still carries a positive
 *    link's figure (the link alone is not what decides; the price is).
 *
 * Every figure is a literal, with DISTINCT amounts per case so a swap shows.
 */

const DAY = 24 * 60 * 60 * 1000
const BASE = new Date('2026-05-04T15:00:00.000Z').getTime()
const at = (days: number) => new Date(BASE + days * DAY)

describe('a payment typed on a charge-less appointment (#717)', () => {
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
      data: { name: 'Charge Less Payment', slug: `charge-less-payment-${suffix}` },
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
          firstName: 'Chargeless',
          lastName: 'Doctor',
          email: `chargeless-doc-${suffix}@test.com`,
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
    await prisma.subscription.deleteMany({ where: { tenantId } })
    await prisma.tenant.delete({ where: { id: tenantId } })
  })

  async function newPatient(label: string): Promise<string> {
    seq += 1
    return (
      await prisma.patient.create({ data: { tenantId, firstName: label, lastName: `P${seq}` } })
    ).id
  }

  async function seedAppointment(
    patientId: string,
    cost: number | null,
    days: number
  ): Promise<string> {
    const startTime = at(days)
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

  async function balance(patientId: string) {
    const result = await getPatientBalance(tenantId, patientId)
    if (!result.success) throw new Error(`getPatientBalance failed: ${result.code}`)
    return result.data
  }

  async function read(appointmentId: string) {
    const appointment = await getAppointmentById(tenantId, appointmentId)
    if (!appointment) throw new Error('fixture: appointment missing')
    return appointment
  }

  /** A budget with ONE item of the given price, linked EXECUTED to the appointment. */
  async function linkExecutedItem(
    patientId: string,
    appointmentId: string,
    price: number
  ): Promise<string> {
    const budget = await prisma.budget.create({
      data: { tenantId, patientId, status: 'APPROVED', totalAmount: price },
    })
    const item = await prisma.budgetItem.create({
      data: {
        budgetId: budget.id,
        description: `executed ${price}`,
        quantity: 1,
        unitPrice: price,
        totalPrice: price,
        status: 'EXECUTED',
      },
    })
    await prisma.budgetItemAppointment.create({
      data: { budgetItemId: item.id, appointmentId, role: 'EXECUTED' },
    })
    return item.id
  }

  // ------------------------------------------------------------------
  // G4 (a): alone, a charge-less visit's payment is pure credit.
  // ------------------------------------------------------------------
  describe('G4 (a): the only appointment is charge-less — the money is credit', () => {
    let patientId: string
    let appointmentId: string

    beforeAll(async () => {
      patientId = await newPatient('G4a')
      appointmentId = await seedAppointment(patientId, null, 0)
    })

    it('before: nothing owed, nothing paid, nothing allocated to the visit', async () => {
      expect(await balance(patientId)).toEqual({
        totalDebt: 0,
        totalPaid: 0,
        outstanding: 0,
        credit: 0,
      })
      const before = await read(appointmentId)
      expect(before.paidAmount).toBe(0)
      expect(before.outstanding).toBe(0)
      expect(before.budgetItems).toBeUndefined()
    })

    it('after recording 430 on it: balance is 430 credit, and the visit itself still allocates 0', async () => {
      const result = await updateAppointment(tenantId, appointmentId, { paidAmount: 430 }, null)
      expect(result.error).toBeUndefined()

      expect(await balance(patientId)).toEqual({
        totalDebt: 0,
        totalPaid: 430,
        outstanding: 0,
        credit: 430,
      })
      const payments = await prisma.patientPayment.findMany({ where: { tenantId, patientId } })
      expect(payments).toHaveLength(1)
      expect(payments[0].amount.toNumber()).toBe(430)
      expect(payments[0].kind).toBe('APPOINTMENT')
      expect(payments[0].appointmentId).toBe(appointmentId)

      const after = await read(appointmentId)
      expect(after.paidAmount).toBe(0)
      expect(after.outstanding).toBe(0)
      expect(after.budgetItems).toBeUndefined()
      expect(after.hasRecordedPayment).toBe(true)
    })
  })

  // ------------------------------------------------------------------
  // G4 (b): beside an older charge, the same money pays that charge (FIFO),
  // never the charge-less visit.
  // ------------------------------------------------------------------
  describe('G4 (b): an older costed visit exists — the money pays it by FIFO, not the charge-less one', () => {
    let patientId: string
    let costedId: string
    let chargeLessId: string

    beforeAll(async () => {
      patientId = await newPatient('G4b')
      costedId = await seedAppointment(patientId, 1000, 0)
      chargeLessId = await seedAppointment(patientId, null, 1)
    })

    it('before: 1000 owed against nothing paid; both visits allocate 0', async () => {
      expect(await balance(patientId)).toEqual({
        totalDebt: 1000,
        totalPaid: 0,
        outstanding: 1000,
        credit: 0,
      })
      expect((await read(costedId)).paidAmount).toBe(0)
      expect((await read(chargeLessId)).paidAmount).toBe(0)
    })

    it('after recording 410 on the charge-less visit: 410 of the 1000 is paid, the charge-less visit still allocates 0', async () => {
      const result = await updateAppointment(tenantId, chargeLessId, { paidAmount: 410 }, null)
      expect(result.error).toBeUndefined()

      expect(await balance(patientId)).toEqual({
        totalDebt: 1000,
        totalPaid: 410,
        outstanding: 590,
        credit: 0,
      })
      const costed = await read(costedId)
      expect(costed.paidAmount).toBe(410)
      expect(costed.outstanding).toBe(590)
      const chargeLess = await read(chargeLessId)
      expect(chargeLess.paidAmount).toBe(0)
      expect(chargeLess.outstanding).toBe(0)
    })
  })

  // ------------------------------------------------------------------
  // G3-API: what reaches the appointment's `budgetItems`, i.e. what the client
  // reads as "this visit has an item charge".
  // ------------------------------------------------------------------
  describe('G3-API: the client reads absence of budgetItems as "no item charge"', () => {
    it('(b) a zero-price EXECUTED link produces NO budgetItems entry', async () => {
      const patientId = await newPatient('G3b')
      const appointmentId = await seedAppointment(patientId, null, 0)
      const itemId = await linkExecutedItem(patientId, appointmentId, 0)

      // The link is really there; only its price is zero.
      expect(
        await prisma.budgetItemAppointment.count({ where: { budgetItemId: itemId, role: 'EXECUTED' } })
      ).toBe(1)
      const appointment = await read(appointmentId)
      expect(appointment.budgetItems).toBeUndefined()
      expect(appointment.cost).toBeNull()
    })

    it('control (vacuity): the same shape with a 3100 price DOES carry budgetItems', async () => {
      const patientId = await newPatient('G3ctl')
      const appointmentId = await seedAppointment(patientId, null, 0)
      await linkExecutedItem(patientId, appointmentId, 3100)

      const appointment = await read(appointmentId)
      expect(appointment.budgetItems).toEqual({
        count: 1,
        cost: 3100,
        paidAmount: 0,
        outstanding: 3100,
      })
    })

    it('(a) a cost-0 visit still carries the positive link figure (a typed 0 does not supersede the items)', async () => {
      const patientId = await newPatient('G3a')
      const appointmentId = await seedAppointment(patientId, 0, 0)
      await linkExecutedItem(patientId, appointmentId, 1800)

      const appointment = await read(appointmentId)
      expect(appointment.cost?.toString()).toBe('0')
      expect(appointment.budgetItems).toEqual({
        count: 1,
        cost: 1800,
        paidAmount: 0,
        outstanding: 1800,
      })
    })
  })

  // ------------------------------------------------------------------
  // Acceptance 3, second half: this task changes nothing under services/.
  // The behavioural guards above are the real pin; this checks the exported
  // surface used by the guards still has the shapes they read.
  // ------------------------------------------------------------------
  it('createAppointment with a paidAmount on a charge-less visit records the same credit', async () => {
    const patientId = await newPatient('create')
    const result = await createAppointment(tenantId, {
      patientId,
      doctorId,
      startTime: at(5),
      endTime: new Date(at(5).getTime() + 30 * 60_000),
      paidAmount: 270,
    })
    expect(result.error).toBeUndefined()
    expect(await balance(patientId)).toEqual({
      totalDebt: 0,
      totalPaid: 270,
      outstanding: 0,
      credit: 270,
    })
  })
})
