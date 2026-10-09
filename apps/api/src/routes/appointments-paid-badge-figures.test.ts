/**
 * Task #524: the paid badge must tell "charged in this consultation" from
 * "covered by an advance". The client derives that from TWO figures the API
 * produces for every appointment:
 *
 *   - paidAmount          what the FIFO allocation applied (charged + covered)
 *   - recordedPaidAmount  the kind=APPOINTMENT payment recorded on it
 *
 * These tests build the four acceptance cases as real rows through the real
 * routes (POST /api/appointments with paidAmount -> a kind=APPOINTMENT payment;
 * POST /api/patients/:id/payments -> an advance) and read them back through
 * GET /api/appointments/by-patient/:id and GET /api/appointments/:id, so the two
 * figures are PRODUCED by buildPatientAllocationMap / attachRecordedPayments,
 * never asserted from a hand-built object.
 *
 * The badge state those figures yield is pinned on the client in
 * apps/app/src/components/payments/PaidStatusBadge.test.tsx, which feeds the
 * exact same (isPaid, cost, paidAmount, recordedPaidAmount) tuples asserted
 * here. The two files are the two halves of one contract.
 *
 * One patient per case: FIFO is per patient, and a shared advance would be
 * spent by whichever appointment is oldest.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { api } from '../test/http.js'
import { prisma } from '@dental/database'
import { hashPassword } from '../services/auth.service.js'
import { generateToken } from '../test/tokens.js'

interface Figures {
  isPaid: boolean
  cost: number
  paidAmount: number
  outstanding: number
  recordedPaidAmount: number
}

describe('Task #524: paidAmount / recordedPaidAmount tell charged from covered', () => {
  let tenantId: string
  let adminToken: string
  let doctorId: string
  const testSlug = `test-clinic-paid-badge-${Date.now()}`
  let dayOffset = 1

  beforeAll(async () => {
    const tenant = await prisma.tenant.create({
      data: { name: 'Test Clinic for Paid Badge', slug: testSlug },
    })
    tenantId = tenant.id

    const admin = await prisma.user.create({
      data: {
        email: `admin-paid-badge-${Date.now()}@test.com`,
        passwordHash: await hashPassword('AdminPass123!'),
        firstName: 'Admin',
        lastName: 'User',
        role: 'ADMIN',
        tenantId,
      },
    })
    adminToken = generateToken(admin.id, tenantId, 'ADMIN')

    const doctor = await prisma.doctor.create({
      data: {
        tenantId,
        firstName: 'Dr. Badge',
        lastName: 'Doctor',
        email: `doctor-paid-badge-${Date.now()}@test.com`,
        specialty: 'General Dentistry',
      },
    })
    doctorId = doctor.id
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

  async function newPatient(label: string): Promise<string> {
    const patient = await prisma.patient.create({
      data: { tenantId, firstName: label, lastName: 'Badge', email: `${label}-${Date.now()}@test.com` },
    })
    return patient.id
  }

  // Real route: a consultation payment is created by POST /api/appointments
  // with paidAmount (kind=APPOINTMENT, linked to the appointment).
  async function createAppointment(patientId: string, cost: number, chargedHere?: number): Promise<string> {
    const start = new Date()
    start.setDate(start.getDate() + dayOffset++)
    start.setHours(10, 0, 0, 0)
    const end = new Date(start.getTime() + 30 * 60 * 1000)
    const res = await api()
      .post('/api/appointments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        patientId,
        doctorId,
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        cost,
        ...(chargedHere !== undefined ? { paidAmount: chargedHere } : {}),
      })
    expect(res.status).toBe(201)
    return res.body.data.id as string
  }

  // Real route: an advance (Entrega) with no appointment attached.
  async function addAdvance(patientId: string, amount: number): Promise<void> {
    const res = await api()
      .post(`/api/patients/${patientId}/payments`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ amount, date: new Date().toISOString() })
    expect(res.status).toBe(201)
    expect(res.body.data.kind).toBe('ADVANCE')
  }

  async function readFigures(patientId: string, appointmentId: string): Promise<Figures> {
    const res = await api()
      .get(`/api/appointments/by-patient/${patientId}`)
      .set('Authorization', `Bearer ${adminToken}`)
    expect(res.status).toBe(200)
    const row = (res.body.data as Array<Figures & { id: string }>).find((a) => a.id === appointmentId)
    expect(row, 'appointment missing from by-patient list').toBeDefined()
    const { isPaid, cost, paidAmount, outstanding, recordedPaidAmount } = row!
    return { isPaid, cost: Number(cost), paidAmount, outstanding, recordedPaidAmount }
  }

  it('case 1: cost 3000, nothing charged and no advance -> unpaid, applied 0, recorded 0 (pending)', async () => {
    const patientId = await newPatient('case1')
    const a = await createAppointment(patientId, 3000)

    expect(await readFigures(patientId, a)).toEqual({
      isPaid: false,
      cost: 3000,
      paidAmount: 0,
      outstanding: 3000,
      recordedPaidAmount: 0,
    })
  })

  it('case 2: cost 3000 covered only by a 3000 advance -> paid with applied 3000 but recorded 0 (covered by balance)', async () => {
    const patientId = await newPatient('case2')
    const a = await createAppointment(patientId, 3000)
    await addAdvance(patientId, 3000)

    expect(await readFigures(patientId, a)).toEqual({
      isPaid: true,
      cost: 3000,
      paidAmount: 3000,
      outstanding: 0,
      recordedPaidAmount: 0,
    })
  })

  it('case 3: cost 2000 fully charged in the consultation -> paid with applied 2000 and recorded 2000 (charged here)', async () => {
    const patientId = await newPatient('case3')
    const b = await createAppointment(patientId, 2000, 2000)

    expect(await readFigures(patientId, b)).toEqual({
      isPaid: true,
      cost: 2000,
      paidAmount: 2000,
      outstanding: 0,
      recordedPaidAmount: 2000,
    })
  })

  it('case 4: cost 5000, 2000 charged in the consultation while a 3000 advance exists -> applied 5000 but recorded only 2000 (charged + covered)', async () => {
    const patientId = await newPatient('case4')
    const c = await createAppointment(patientId, 5000, 2000)
    await addAdvance(patientId, 3000)

    // The two figures must DIFFER here: this is the pair a two-state
    // charged/covered reading cannot represent.
    const figures = await readFigures(patientId, c)
    expect(figures).toEqual({
      isPaid: true,
      cost: 5000,
      paidAmount: 5000,
      outstanding: 0,
      recordedPaidAmount: 2000,
    })
    expect(figures.recordedPaidAmount).toBeGreaterThan(0)
    expect(figures.recordedPaidAmount).toBeLessThan(figures.paidAmount)

    // The single-appointment read goes through the same two merges.
    const single = await api()
      .get(`/api/appointments/${c}`)
      .set('Authorization', `Bearer ${adminToken}`)
    expect(single.status).toBe(200)
    expect(single.body.data).toMatchObject({
      isPaid: true,
      paidAmount: 5000,
      recordedPaidAmount: 2000,
    })
  })

  it('a charge that does not reach the cost, with no advance, stays unpaid with recorded == applied (partial, not covered)', async () => {
    const patientId = await newPatient('partial')
    const a = await createAppointment(patientId, 5000, 2000)

    expect(await readFigures(patientId, a)).toEqual({
      isPaid: false,
      cost: 5000,
      paidAmount: 2000,
      outstanding: 3000,
      recordedPaidAmount: 2000,
    })
  })
})
