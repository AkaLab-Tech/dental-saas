import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { api } from '../test/http.js'
import { prisma } from '@dental/database'
import { hashPassword } from '../services/auth.service.js'
import { generateToken } from '../test/tokens.js'
import { createLabwork, updateLabwork } from '../services/labwork.service.js'
import { recalculatePaidStatus } from '../services/payment.service.js'

/**
 * Task #470: FIFO (recalculatePaidStatus) owns `isPaid` for patient-linked
 * billable labworks, so a manual write is rejected (400) instead of being
 * silently reverted. Runs against the real test database; nothing is mocked.
 *
 * The HTTP body carries only the message string (errorMessageMap), never the
 * code, so the code is asserted at the service layer and the HTTP layer
 * asserts status + the distinct message.
 */
const MANAGED_MESSAGE =
  "isPaid is derived from the patient's payments for this labwork and cannot be set manually"

describe('Labworks - isPaid owned by payments (#470)', () => {
  let tenantId: string
  let adminToken: string
  let patientId: string
  let appointmentId: string
  const created: string[] = []
  const slug = `test-labworks-paid-managed-${Date.now()}`

  beforeAll(async () => {
    const tenant = await prisma.tenant.create({
      data: { name: 'Paid Managed Clinic', slug, currency: 'USD', timezone: 'America/New_York' },
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

    const user = await prisma.user.create({
      data: {
        tenantId,
        email: `admin@${slug}.com`,
        firstName: 'Admin',
        lastName: 'User',
        passwordHash: await hashPassword('password123'),
        role: 'ADMIN',
      },
    })
    adminToken = generateToken(user.id, tenantId, 'ADMIN')

    const patient = await prisma.patient.create({
      data: { tenantId, firstName: 'Paid', lastName: 'Managed' },
    })
    patientId = patient.id

    const doctor = await prisma.doctor.create({
      data: { tenantId, firstName: 'Dr', lastName: 'Managed' },
    })
    const appointment = await prisma.appointment.create({
      data: {
        tenantId,
        patientId,
        doctorId: doctor.id,
        startTime: new Date('2025-08-01T10:00:00Z'),
        endTime: new Date('2025-08-01T10:30:00Z'),
        cost: 300,
        status: 'COMPLETED',
      },
    })
    appointmentId = appointment.id
  })

  afterAll(async () => {
    await prisma.patientPayment.deleteMany({ where: { tenantId } })
    await prisma.labwork.deleteMany({ where: { tenantId } })
    await prisma.appointment.deleteMany({ where: { tenantId } })
    await prisma.doctor.deleteMany({ where: { tenantId } })
    await prisma.patient.deleteMany({ where: { tenantId } })
    await prisma.user.deleteMany({ where: { tenantId } })
    await prisma.subscription.deleteMany({ where: { tenantId } })
    await prisma.tenant.delete({ where: { id: tenantId } })
  })

  async function seed(data: {
    patientId: string | null
    price: number
    isPaid?: boolean
    appointmentId?: string
    priceIncludedInAppointment?: boolean
  }) {
    const row = await prisma.labwork.create({
      data: {
        tenantId,
        patientId: data.patientId,
        appointmentId: data.appointmentId ?? null,
        priceIncludedInAppointment: data.priceIncludedInAppointment ?? false,
        lab: 'Seed Lab',
        date: new Date('2025-08-01'),
        price: data.price,
        isPaid: data.isPaid ?? false,
      },
    })
    created.push(row.id)
    return row.id
  }

  async function storedIsPaid(id: string) {
    const row = await prisma.labwork.findUniqueOrThrow({ where: { id }, select: { isPaid: true } })
    return row.isPaid
  }

  const post = (body: Record<string, unknown>) =>
    api()
      .post('/api/labworks')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ lab: 'Http Lab', date: '2025-08-01', ...body })

  const put = (id: string, body: Record<string, unknown>) =>
    api().put(`/api/labworks/${id}`).set('Authorization', `Bearer ${adminToken}`).send(body)

  describe('POST /api/labworks - predicate matrix (isPaid:true sent)', () => {
    it('REJECTS linked + priced: 400 with the distinct message, and nothing is persisted', async () => {
      const before = await prisma.labwork.count({ where: { tenantId, lab: 'Create Reject Lab' } })
      const res = await post({ lab: 'Create Reject Lab', patientId, price: 100, isPaid: true })

      expect(res.status).toBe(400)
      expect(res.body.success).toBe(false)
      expect(res.body.error).toBe(MANAGED_MESSAGE)
      const after = await prisma.labwork.count({ where: { tenantId, lab: 'Create Reject Lab' } })
      expect(after).toBe(before)
    })

    it('REJECTS linked + zero price + priceIncludedInAppointment (price ignored, flag decides)', async () => {
      const res = await post({
        lab: 'Create Included Lab',
        patientId,
        appointmentId,
        priceIncludedInAppointment: true,
        price: 0,
        isPaid: true,
      })

      expect(res.status).toBe(400)
      expect(res.body.error).toBe(MANAGED_MESSAGE)
    })

    it('ALLOWS unlinked + priced (no patient, so FIFO does not own it): 201, isPaid true stored', async () => {
      const res = await post({ price: 100, isPaid: true })

      expect(res.status).toBe(201)
      expect(res.body.data.isPaid).toBe(true)
      expect(await storedIsPaid(res.body.data.id)).toBe(true)
      created.push(res.body.data.id)
    })

    it('ALLOWS linked + zero price (nothing billable, FIFO ignores it): 201, isPaid true stored', async () => {
      const res = await post({ patientId, price: 0, isPaid: true })

      expect(res.status).toBe(201)
      expect(res.body.data.isPaid).toBe(true)
      expect(await storedIsPaid(res.body.data.id)).toBe(true)
      created.push(res.body.data.id)
    })

    it('ALLOWS linked + priced when isPaid is omitted (guard only fires on an explicit isPaid): 201, isPaid false', async () => {
      const res = await post({ patientId, price: 100 })

      expect(res.status).toBe(201)
      expect(res.body.data.isPaid).toBe(false)
      created.push(res.body.data.id)
    })
  })

  describe('PUT /api/labworks/:id - predicate matrix', () => {
    it('REJECTS isPaid:true on a stored linked + priced labwork: 400, distinct message, stored isPaid unchanged', async () => {
      const id = await seed({ patientId, price: 100, isPaid: false })

      const res = await put(id, { isPaid: true })

      expect(res.status).toBe(400)
      expect(res.body.success).toBe(false)
      expect(res.body.error).toBe(MANAGED_MESSAGE)
      expect(await storedIsPaid(id)).toBe(false)
    })

    it('REJECTS isPaid:false on a stored linked + priced PAID labwork: 400 and stored isPaid stays true', async () => {
      const id = await seed({ patientId, price: 100, isPaid: true })

      const res = await put(id, { isPaid: false })

      expect(res.status).toBe(400)
      expect(res.body.error).toBe(MANAGED_MESSAGE)
      expect(await storedIsPaid(id)).toBe(true)
    })

    it('REJECTS isPaid on a stored linked + zero price + priceIncludedInAppointment labwork', async () => {
      const id = await seed({
        patientId,
        price: 0,
        appointmentId,
        priceIncludedInAppointment: true,
        isPaid: true,
      })

      const res = await put(id, { isPaid: false })

      expect(res.status).toBe(400)
      expect(res.body.error).toBe(MANAGED_MESSAGE)
      expect(await storedIsPaid(id)).toBe(true)
    })

    it('ALLOWS isPaid on a stored unlinked + priced labwork: 200 and the value is stored', async () => {
      const id = await seed({ patientId: null, price: 100, isPaid: false })

      const res = await put(id, { isPaid: true })

      expect(res.status).toBe(200)
      expect(res.body.data.isPaid).toBe(true)
      expect(await storedIsPaid(id)).toBe(true)
    })

    it('ALLOWS isPaid on a stored linked + zero price labwork: 200 and the value is stored', async () => {
      const id = await seed({ patientId, price: 0, isPaid: false })

      const res = await put(id, { isPaid: true })

      expect(res.status).toBe(200)
      expect(res.body.data.isPaid).toBe(true)
      expect(await storedIsPaid(id)).toBe(true)
    })

    it('REJECTS a PUT that moves an unlinked priced labwork into the managed shape while sending isPaid', async () => {
      const id = await seed({ patientId: null, price: 100, isPaid: false })

      const res = await put(id, { patientId, isPaid: true })

      expect(res.status).toBe(400)
      expect(res.body.error).toBe(MANAGED_MESSAGE)
      const row = await prisma.labwork.findUniqueOrThrow({ where: { id } })
      expect(row.isPaid).toBe(false)
      expect(row.patientId).toBeNull()
    })

    it('REJECTS a PUT that raises a linked zero-price labwork to a positive price while sending isPaid', async () => {
      const id = await seed({ patientId, price: 0, isPaid: false })

      const res = await put(id, { price: 50, isPaid: true })

      expect(res.status).toBe(400)
      expect(res.body.error).toBe(MANAGED_MESSAGE)
      expect(await storedIsPaid(id)).toBe(false)
    })

    it('does NOT reject an edit that carries no isPaid on a managed labwork (stale tab): 200, other field written', async () => {
      const id = await seed({ patientId, price: 100, isPaid: false })

      const res = await put(id, { lab: 'Renamed Lab' })

      expect(res.status).toBe(200)
      expect(res.body.data.lab).toBe('Renamed Lab')
      expect(await storedIsPaid(id)).toBe(false)
    })
  })

  describe('POST /api/labworks - isPaid:false leniency (stale-tab contract)', () => {
    // Stale clients always submit `isPaid: false`. On create that is a provable
    // no-op (stored value = priceIncluded || isPaid || false = false), so it
    // must not 400 or stale tabs could not create a labwork at all.
    it('ACCEPTS linked + priced + priceIncluded false + isPaid:false: 201 and stored isPaid is false', async () => {
      const res = await post({ lab: 'Create NoOp Lab', patientId, price: 100, isPaid: false })

      expect(res.status).toBe(201)
      expect(res.body.data.isPaid).toBe(false)
      expect(await storedIsPaid(res.body.data.id)).toBe(false)
      created.push(res.body.data.id)
    })

    // Here create would force-store `true` (priceIncluded wins), i.e. #470's
    // own failure mode: the client asked for false and gets true.
    it('REJECTS linked + zero price + priceIncluded true + isPaid:false: 400 and nothing persisted', async () => {
      const before = await prisma.labwork.count({ where: { tenantId, lab: 'Create ForceTrue Lab' } })
      const res = await post({
        lab: 'Create ForceTrue Lab',
        patientId,
        appointmentId,
        priceIncludedInAppointment: true,
        price: 0,
        isPaid: false,
      })

      expect(res.status).toBe(400)
      expect(res.body.success).toBe(false)
      expect(res.body.error).toBe(MANAGED_MESSAGE)
      const after = await prisma.labwork.count({ where: { tenantId, lab: 'Create ForceTrue Lab' } })
      expect(after).toBe(before)
    })

    // INTENTIONAL ASYMMETRY - do not "fix" into symmetry. The same payload
    // (`isPaid: false` on a linked, priced labwork) is a harmless no-op on
    // create but is rejected on update: there the stored row may be paid, and
    // FIFO would revert a hand-set `false`, misleading the client.
    it('is deliberately asymmetric: isPaid:false is accepted on create but rejected on update of a stored paid managed labwork', async () => {
      const createRes = await post({ lab: 'Asym Lab', patientId, price: 100, isPaid: false })
      expect(createRes.status).toBe(201)
      created.push(createRes.body.data.id)

      const storedPaidId = await seed({ patientId, price: 100, isPaid: true })
      const updateRes = await put(storedPaidId, { isPaid: false })

      expect(updateRes.status).toBe(400)
      expect(updateRes.body.error).toBe(MANAGED_MESSAGE)
      expect(await storedIsPaid(storedPaidId)).toBe(true)
    })
  })

  describe('service layer - error identity (code is not on the HTTP body)', () => {
    it('createLabwork returns code PAID_MANAGED_BY_PAYMENTS for linked + priced + isPaid', async () => {
      const result = await createLabwork(tenantId, {
        patientId,
        lab: 'Svc Create',
        date: new Date('2025-08-01'),
        price: 100,
        isPaid: true,
      })

      expect(result).toEqual({ success: false, code: 'PAID_MANAGED_BY_PAYMENTS' })
    })

    it('createLabwork succeeds for linked + zero price + isPaid (opposite outcome)', async () => {
      const result = await createLabwork(tenantId, {
        patientId,
        lab: 'Svc Create Zero',
        date: new Date('2025-08-01'),
        price: 0,
        isPaid: true,
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.isPaid).toBe(true)
        created.push(result.data.id)
      }
    })

    it('updateLabwork returns code PAID_MANAGED_BY_PAYMENTS and leaves the stored value untouched', async () => {
      const id = await seed({ patientId, price: 100, isPaid: false })

      const result = await updateLabwork(tenantId, id, { isPaid: true })

      expect(result).toEqual({ success: false, code: 'PAID_MANAGED_BY_PAYMENTS' })
      expect(await storedIsPaid(id)).toBe(false)
    })

    it('updateLabwork succeeds for linked + zero price + isPaid (opposite outcome)', async () => {
      const id = await seed({ patientId, price: 0, isPaid: false })

      const result = await updateLabwork(tenantId, id, { isPaid: true })

      expect(result.success).toBe(true)
      expect(await storedIsPaid(id)).toBe(true)
    })
  })

  describe('#470 regression: FIFO owns isPaid', () => {
    it('documents the defect: a hand-set isPaid written straight to the DB is flipped back by recalculatePaidStatus', async () => {
      const isolatedPatient = await prisma.patient.create({
        data: { tenantId, firstName: 'Fifo', lastName: 'Owner' },
      })
      // Written through Prisma, bypassing the service: simulates the old manual path.
      const id = await seed({ patientId: isolatedPatient.id, price: 100, isPaid: true })
      expect(await storedIsPaid(id)).toBe(true)

      const result = await recalculatePaidStatus(tenantId, isolatedPatient.id)

      expect(result.labworkChanges).toBe(1)
      expect(await storedIsPaid(id)).toBe(false)
    })

    it('closes the defect: the same hand-set step is impossible through the API (400) and FIFO still owns the value', async () => {
      const isolatedPatient = await prisma.patient.create({
        data: { tenantId, firstName: 'Fifo', lastName: 'Closed' },
      })
      const id = await seed({ patientId: isolatedPatient.id, price: 100, isPaid: false })

      const res = await put(id, { isPaid: true })

      expect(res.status).toBe(400)
      expect(res.body.error).toBe(MANAGED_MESSAGE)
      expect(await storedIsPaid(id)).toBe(false)

      // FIFO then agrees with the stored value: nothing to correct.
      const recalc = await recalculatePaidStatus(tenantId, isolatedPatient.id)
      expect(recalc.labworkChanges).toBe(0)
      expect(await storedIsPaid(id)).toBe(false)
    })
  })
})
