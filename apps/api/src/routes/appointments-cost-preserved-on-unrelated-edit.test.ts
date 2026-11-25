/**
 * Task #713 (an appointment cost cleared silently) - API-side guards.
 *
 * G4: editing appointment B makes recalculatePaidStatus rewrite appointment A's
 *     row (isPaid flips). A's `cost` must survive that write.
 * G5: PUT omitting the `cost` key preserves the stored figure; PUT with
 *     `cost: null` clears it. (appointments.test.ts only covers numeric cost
 *     changes on PUT, so these live here rather than being duplicated there.)
 *
 * Assertions are on `cost`, never `updatedAt`: `updatedAt` is @updatedAt and
 * recalculatePaidStatus moves it on rows no human touched.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { api } from '../test/http.js'
import { prisma } from '@dental/database'
import { hashPassword } from '../services/auth.service.js'
import { generateToken } from '../test/tokens.js'

describe('Task #713 - appointment cost survives unrelated writes', () => {
  let tenantId: string
  let adminUserId: string
  let adminToken: string
  let patientId: string
  let doctorId: string
  const testSlug = `test-clinic-cost-preserved-${Date.now()}`

  const at = (daysFromNow: number) => {
    const start = new Date()
    start.setDate(start.getDate() + daysFromNow)
    start.setHours(10, 0, 0, 0)
    return { startTime: start, endTime: new Date(start.getTime() + 30 * 60 * 1000) }
  }

  const makeAppointment = (daysFromNow: number, cost: number | null) =>
    prisma.appointment.create({
      data: { tenantId, patientId, doctorId, ...at(daysFromNow), duration: 30, cost, isPaid: false },
    })

  beforeAll(async () => {
    const tenant = await prisma.tenant.create({
      data: { name: 'Test Clinic for Cost Preserved', slug: testSlug },
    })
    tenantId = tenant.id

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
    await prisma.subscription.create({
      data: {
        tenantId,
        planId: freePlan.id,
        status: 'ACTIVE',
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    })

    const admin = await prisma.user.create({
      data: {
        email: `admin-cost-preserved-${Date.now()}@test.com`,
        passwordHash: await hashPassword('AdminPass123!'),
        firstName: 'Admin',
        lastName: 'User',
        role: 'ADMIN',
        tenantId,
      },
    })
    adminUserId = admin.id
    adminToken = generateToken(admin.id, tenantId, 'ADMIN')

    const patient = await prisma.patient.create({
      data: { tenantId, firstName: 'Test', lastName: 'Patient' },
    })
    patientId = patient.id

    const doctor = await prisma.doctor.create({
      data: { tenantId, firstName: 'Dr. Test', lastName: 'Doctor', specialty: 'General Dentistry' },
    })
    doctorId = doctor.id
  })

  afterAll(async () => {
    await prisma.patientPayment.deleteMany({ where: { tenantId } })
    await prisma.appointment.deleteMany({ where: { tenantId } })
    await prisma.patient.deleteMany({ where: { tenantId } })
    await prisma.doctor.deleteMany({ where: { tenantId } })
    await prisma.refreshToken.deleteMany({ where: { userId: adminUserId } })
    await prisma.user.deleteMany({ where: { tenantId } })
    await prisma.subscription.deleteMany({ where: { tenantId } })
    await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {})
  })

  beforeEach(async () => {
    await prisma.patientPayment.deleteMany({ where: { tenantId } })
    await prisma.appointment.deleteMany({ where: { tenantId } })
  })

  describe('G4 - recalculatePaidStatus rewrites a sibling appointment without touching its cost', () => {
    it("flips appointment A's isPaid when B is edited, and leaves A's cost at 1500", async () => {
      // B is older, so FIFO pays it first; A is newer. State is seeded straight
      // into the database (B already paid) so no recalculation runs before the
      // edit under test: the only write to A's row is the one the PUT causes.
      const b = await makeAppointment(5, 1500)
      await prisma.appointment.update({ where: { id: b.id }, data: { isPaid: true } })
      const a = await makeAppointment(6, 1500)
      await prisma.patientPayment.create({
        data: { tenantId, patientId, amount: 1500, date: new Date(), kind: 'ADVANCE' },
      })

      // Precondition: the 1500 pays B (older) and leaves A unpaid.
      expect((await prisma.appointment.findUnique({ where: { id: b.id } }))?.isPaid).toBe(true)
      expect((await prisma.appointment.findUnique({ where: { id: a.id } }))?.isPaid).toBe(false)

      // Clear B's cost on purpose: B stops being billable, so the same 1500 now
      // covers A and recalculatePaidStatus writes A's row.
      const res = await api()
        .put(`/api/appointments/${b.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ cost: null })
      expect(res.status).toBe(200)

      const afterA = await prisma.appointment.findUnique({ where: { id: a.id } })
      // (a) the recalculation really ran over A - without this the test is vacuous.
      expect(afterA?.isPaid).toBe(true)
      // (b) and it did not touch A's cost.
      expect(afterA?.cost?.toNumber()).toBe(1500)
    })
  })

  describe('G5 - PUT cost semantics', () => {
    it('omitting the cost key preserves the stored figure', async () => {
      const a = await makeAppointment(5, 1500)

      const res = await api()
        .put(`/api/appointments/${a.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ notes: 'edit without cost key' })
      expect(res.status).toBe(200)
      expect(res.body.data.notes).toBe('edit without cost key')
      expect(Number(res.body.data.cost)).toBe(1500)

      const row = await prisma.appointment.findUnique({ where: { id: a.id } })
      expect(row?.cost?.toNumber()).toBe(1500)
    })

    it('cost: null clears the stored figure', async () => {
      const a = await makeAppointment(5, 1500)

      const res = await api()
        .put(`/api/appointments/${a.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ cost: null })
      expect(res.status).toBe(200)
      expect(res.body.data.cost).toBeNull()

      const row = await prisma.appointment.findUnique({ where: { id: a.id } })
      expect(row?.cost).toBeNull()
    })
  })
})
