import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { app } from '../app.js'
import { prisma, Prisma } from '@dental/database'
import { hashPassword } from '../services/auth.service.js'
import { sign } from 'jsonwebtoken'

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret'

describe('Patient Payments Routes', () => {
  let tenantId: string
  let adminToken: string
  let staffToken: string
  let patientId: string
  let doctorId: string
  const testSlug = `test-payments-${Date.now()}`

  function generateToken(userId: string, tenantId: string, role: string) {
    return sign({ sub: userId, tenantId, role }, JWT_SECRET, { expiresIn: '1h' })
  }

  beforeAll(async () => {
    const tenant = await prisma.tenant.create({
      data: {
        name: 'Test Clinic for Payments',
        slug: testSlug,
        currency: 'USD',
        timezone: 'America/New_York',
      },
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
        tenantId: tenant.id,
        planId: freePlan.id,
        status: 'ACTIVE',
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    })

    const hashedPassword = await hashPassword('password123')

    const adminUser = await prisma.user.create({
      data: {
        tenantId,
        email: 'admin@payments-test.com',
        firstName: 'Admin',
        lastName: 'User',
        passwordHash: hashedPassword,
        role: 'ADMIN',
      },
    })
    adminToken = generateToken(adminUser.id, tenantId, 'ADMIN')

    const staffUser = await prisma.user.create({
      data: {
        tenantId,
        email: 'staff@payments-test.com',
        firstName: 'Staff',
        lastName: 'User',
        passwordHash: hashedPassword,
        role: 'STAFF',
      },
    })
    staffToken = generateToken(staffUser.id, tenantId, 'STAFF')

    const patient = await prisma.patient.create({
      data: { tenantId, firstName: 'John', lastName: 'Doe' },
    })
    patientId = patient.id

    const doctor = await prisma.doctor.create({
      data: { tenantId, firstName: 'Dr', lastName: 'Smith' },
    })
    doctorId = doctor.id
  })

  afterAll(async () => {
    await prisma.patientPayment.deleteMany({ where: { tenantId } })
    await prisma.appointment.deleteMany({ where: { tenantId } })
    await prisma.labwork.deleteMany({ where: { tenantId } })
    await prisma.patient.deleteMany({ where: { tenantId } })
    await prisma.doctor.deleteMany({ where: { tenantId } })
    await prisma.user.deleteMany({ where: { tenantId } })
    await prisma.subscription.deleteMany({ where: { tenantId } })
    await prisma.tenant.delete({ where: { id: tenantId } })
  })

  describe('GET /api/patients/:id/balance', () => {
    it('should return zero balance for patient with no billable items', async () => {
      const res = await request(app)
        .get(`/api/patients/${patientId}/balance`)
        .set('Authorization', `Bearer ${staffToken}`)

      expect(res.status).toBe(200)
      expect(res.body.data).toEqual({ totalDebt: 0, totalPaid: 0, outstanding: 0, credit: 0 })
    })

    it('should return 404 for non-existent patient', async () => {
      const res = await request(app)
        .get('/api/patients/non-existent-id/balance')
        .set('Authorization', `Bearer ${staffToken}`)

      expect(res.status).toBe(404)
    })
  })

  describe('POST /api/patients/:id/payments', () => {
    it('should deny STAFF from creating payment', async () => {
      // First create a billable item
      await prisma.appointment.create({
        data: {
          tenantId,
          patientId,
          doctorId,
          startTime: new Date('2025-01-01T10:00:00Z'),
          endTime: new Date('2025-01-01T10:30:00Z'),
          cost: 100,
          status: 'COMPLETED',
        },
      })

      const res = await request(app)
        .post(`/api/patients/${patientId}/payments`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ amount: 50, date: new Date().toISOString() })

      expect(res.status).toBe(403)
    })

    it('should allow ADMIN to create payment', async () => {
      const res = await request(app)
        .post(`/api/patients/${patientId}/payments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: 50, date: new Date().toISOString(), note: 'First payment' })

      expect(res.status).toBe(201)
      expect(res.body.data).toHaveProperty('id')
      expect(Number(res.body.data.amount)).toBe(50)
      expect(res.body.data.note).toBe('First payment')
      // POST /patients/:id/payments has no way to set kind/appointmentId —
      // every payment created through this route defaults to a freestanding advance.
      expect(res.body.data.kind).toBe('ADVANCE')
      expect(res.body.data.appointmentId).toBeNull()
    })

    it('should accept a payment exceeding the outstanding balance and record it as an advance', async () => {
      // At this point: totalDebt=100 (appointment), totalPaid=50 (prior payment),
      // outstanding=50. Paying 99999 is a deliberate overpayment/advance.
      const res = await request(app)
        .post(`/api/patients/${patientId}/payments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: 99999, date: new Date().toISOString(), note: 'Advance payment' })

      expect(res.status).toBe(201)
      expect(res.body.data).toHaveProperty('id')
      expect(Number(res.body.data.amount)).toBe(99999)

      // Persisted: fetch the payment back via the list endpoint.
      const listRes = await request(app)
        .get(`/api/patients/${patientId}/payments`)
        .set('Authorization', `Bearer ${adminToken}`)
      const persisted = listRes.body.data.find((p: { id: string }) => p.id === res.body.data.id)
      expect(persisted).toBeDefined()
      expect(Number(persisted.amount)).toBe(99999)

      // Balance now reports a credit: totalPaid (50 + 99999) - totalDebt (100) = 99949.
      const balanceRes = await request(app)
        .get(`/api/patients/${patientId}/balance`)
        .set('Authorization', `Bearer ${adminToken}`)

      expect(balanceRes.status).toBe(200)
      expect(balanceRes.body.data.totalDebt).toBe(100)
      expect(balanceRes.body.data.totalPaid).toBe(100049)
      expect(balanceRes.body.data.outstanding).toBe(0)
      expect(balanceRes.body.data.credit).toBe(99949)
    })

    it('should reject payment with invalid amount', async () => {
      const res = await request(app)
        .post(`/api/patients/${patientId}/payments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: 0, date: new Date().toISOString() })

      expect(res.status).toBe(400)
    })

    it('should reject a negative amount (the 0.01 floor is the only rejection reason left)', async () => {
      const res = await request(app)
        .post(`/api/patients/${patientId}/payments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: -10, date: new Date().toISOString() })

      expect(res.status).toBe(400)
    })

    it('should accept the smallest valid amount (0.01)', async () => {
      const res = await request(app)
        .post(`/api/patients/${patientId}/payments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: 0.01, date: new Date().toISOString() })

      expect(res.status).toBe(201)
      expect(Number(res.body.data.amount)).toBe(0.01)
    })

    it('should return 404 for non-existent patient', async () => {
      const res = await request(app)
        .post('/api/patients/non-existent-id/payments')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: 10, date: new Date().toISOString() })

      expect(res.status).toBe(404)
    })
  })

  describe('GET /api/patients/:id/payments', () => {
    it('should allow STAFF to list payments', async () => {
      const res = await request(app)
        .get(`/api/patients/${patientId}/payments`)
        .set('Authorization', `Bearer ${staffToken}`)

      expect(res.status).toBe(200)
      expect(Array.isArray(res.body.data)).toBe(true)
      expect(res.body.data.length).toBeGreaterThan(0)
      expect(res.body.pagination).toHaveProperty('total')
    })
  })

  describe('DELETE /api/patients/:patientId/payments/:paymentId', () => {
    it('should deny STAFF from deleting payment', async () => {
      // Get first payment
      const listRes = await request(app)
        .get(`/api/patients/${patientId}/payments`)
        .set('Authorization', `Bearer ${staffToken}`)

      const paymentId = listRes.body.data[0].id

      const res = await request(app)
        .delete(`/api/patients/${patientId}/payments/${paymentId}`)
        .set('Authorization', `Bearer ${staffToken}`)

      expect(res.status).toBe(403)
    })

    it('should allow ADMIN to delete payment', async () => {
      // Create a payment to delete
      const createRes = await request(app)
        .post(`/api/patients/${patientId}/payments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: 10, date: new Date().toISOString() })

      const paymentId = createRes.body.data.id

      const res = await request(app)
        .delete(`/api/patients/${patientId}/payments/${paymentId}`)
        .set('Authorization', `Bearer ${adminToken}`)

      expect(res.status).toBe(200)
    })

    it('should return 404 for non-existent payment', async () => {
      const res = await request(app)
        .delete(`/api/patients/${patientId}/payments/non-existent-id`)
        .set('Authorization', `Bearer ${adminToken}`)

      expect(res.status).toBe(404)
    })
  })

  describe('FIFO allocation logic', () => {
    let fifoPatientId: string

    beforeAll(async () => {
      // Create a fresh patient for FIFO tests
      const patient = await prisma.patient.create({
        data: { tenantId, firstName: 'FIFO', lastName: 'Test' },
      })
      fifoPatientId = patient.id

      // Create 3 appointments with costs: $100, $100, $100 (oldest first)
      await prisma.appointment.createMany({
        data: [
          {
            tenantId,
            patientId: fifoPatientId,
            doctorId,
            startTime: new Date('2025-01-01T10:00:00Z'),
            endTime: new Date('2025-01-01T10:30:00Z'),
            cost: 100,
            status: 'COMPLETED',
          },
          {
            tenantId,
            patientId: fifoPatientId,
            doctorId,
            startTime: new Date('2025-02-01T10:00:00Z'),
            endTime: new Date('2025-02-01T10:30:00Z'),
            cost: 100,
            status: 'COMPLETED',
          },
          {
            tenantId,
            patientId: fifoPatientId,
            doctorId,
            startTime: new Date('2025-03-01T10:00:00Z'),
            endTime: new Date('2025-03-01T10:30:00Z'),
            cost: 100,
            status: 'COMPLETED',
          },
        ],
      })
    })

    it('should show $300 outstanding balance', async () => {
      const res = await request(app)
        .get(`/api/patients/${fifoPatientId}/balance`)
        .set('Authorization', `Bearer ${adminToken}`)

      expect(res.status).toBe(200)
      expect(res.body.data.totalDebt).toBe(300)
      expect(res.body.data.totalPaid).toBe(0)
      expect(res.body.data.outstanding).toBe(300)
    })

    it('should not mark any appointment as paid after $50 payment', async () => {
      await request(app)
        .post(`/api/patients/${fifoPatientId}/payments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: 50, date: '2025-01-15' })

      // Check balance
      const balanceRes = await request(app)
        .get(`/api/patients/${fifoPatientId}/balance`)
        .set('Authorization', `Bearer ${adminToken}`)

      expect(balanceRes.body.data.outstanding).toBe(250)

      // Check appointments - none should be paid yet
      const appointments = await prisma.appointment.findMany({
        where: { tenantId, patientId: fifoPatientId },
        orderBy: { startTime: 'asc' },
      })

      expect(appointments[0].isPaid).toBe(false)
      expect(appointments[1].isPaid).toBe(false)
      expect(appointments[2].isPaid).toBe(false)
    })

    it('should mark first appointment as paid after additional $60 payment (cumulative $110 >= $100)', async () => {
      await request(app)
        .post(`/api/patients/${fifoPatientId}/payments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: 60, date: '2025-02-15' })

      const appointments = await prisma.appointment.findMany({
        where: { tenantId, patientId: fifoPatientId },
        orderBy: { startTime: 'asc' },
      })

      expect(appointments[0].isPaid).toBe(true)  // $110 >= $100
      expect(appointments[1].isPaid).toBe(false)  // remaining $10 < $100
      expect(appointments[2].isPaid).toBe(false)
    })

    it('should mark second appointment as paid after $100 payment (cumulative $210 >= $200)', async () => {
      await request(app)
        .post(`/api/patients/${fifoPatientId}/payments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: 100, date: '2025-03-15' })

      const appointments = await prisma.appointment.findMany({
        where: { tenantId, patientId: fifoPatientId },
        orderBy: { startTime: 'asc' },
      })

      expect(appointments[0].isPaid).toBe(true)
      expect(appointments[1].isPaid).toBe(true)   // $210 >= $200
      expect(appointments[2].isPaid).toBe(false)   // remaining $10 < $100
    })

    it('should mark all appointments as paid after final $90 payment (cumulative $300 >= $300)', async () => {
      await request(app)
        .post(`/api/patients/${fifoPatientId}/payments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: 90, date: '2025-04-15' })

      const appointments = await prisma.appointment.findMany({
        where: { tenantId, patientId: fifoPatientId },
        orderBy: { startTime: 'asc' },
      })

      expect(appointments[0].isPaid).toBe(true)
      expect(appointments[1].isPaid).toBe(true)
      expect(appointments[2].isPaid).toBe(true)

      // Balance should be 0
      const balanceRes = await request(app)
        .get(`/api/patients/${fifoPatientId}/balance`)
        .set('Authorization', `Bearer ${adminToken}`)

      expect(balanceRes.body.data.outstanding).toBe(0)
    })

    it('should recalculate FIFO when a payment is deleted', async () => {
      // Delete the last payment ($90)
      const paymentsRes = await request(app)
        .get(`/api/patients/${fifoPatientId}/payments`)
        .set('Authorization', `Bearer ${adminToken}`)

      // Payments ordered by date desc, so first is the $90 one
      const lastPayment = paymentsRes.body.data[0]

      await request(app)
        .delete(`/api/patients/${fifoPatientId}/payments/${lastPayment.id}`)
        .set('Authorization', `Bearer ${adminToken}`)

      // Third appointment should be unpaid again
      const appointments = await prisma.appointment.findMany({
        where: { tenantId, patientId: fifoPatientId },
        orderBy: { startTime: 'asc' },
      })

      expect(appointments[0].isPaid).toBe(true)   // $210 >= $100
      expect(appointments[1].isPaid).toBe(true)    // $210 >= $200
      expect(appointments[2].isPaid).toBe(false)   // $210 < $300

      // Balance should be $90
      const balanceRes = await request(app)
        .get(`/api/patients/${fifoPatientId}/balance`)
        .set('Authorization', `Bearer ${adminToken}`)

      expect(balanceRes.body.data.outstanding).toBe(90)
    })
  })

  describe('Labwork linked to appointment (price included)', () => {
    let linkedPatientId: string
    let appointmentId: string

    beforeAll(async () => {
      const patient = await prisma.patient.create({
        data: { tenantId, firstName: 'Linked', lastName: 'Test' },
      })
      linkedPatientId = patient.id

      // Create appointment with cost $200
      const appointment = await prisma.appointment.create({
        data: {
          tenantId,
          patientId: linkedPatientId,
          doctorId,
          startTime: new Date('2025-06-01T10:00:00Z'),
          endTime: new Date('2025-06-01T10:30:00Z'),
          cost: 200,
          status: 'COMPLETED',
        },
      })
      appointmentId = appointment.id
    })

    it('should NOT count labwork price in debt when priceIncludedInAppointment is true', async () => {
      // Create labwork linked to appointment with price included
      const res = await request(app)
        .post('/api/labworks')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          patientId: linkedPatientId,
          appointmentId,
          priceIncludedInAppointment: true,
          lab: 'Linked Lab',
          date: '2025-06-01',
          price: 80,
        })

      expect(res.status).toBe(201)
      expect(res.body.data.appointmentId).toBe(appointmentId)
      expect(res.body.data.priceIncludedInAppointment).toBe(true)
      expect(res.body.data.isPaid).toBe(true)

      // Balance should only include appointment cost, not labwork
      const balanceRes = await request(app)
        .get(`/api/patients/${linkedPatientId}/balance`)
        .set('Authorization', `Bearer ${adminToken}`)

      expect(balanceRes.body.data.totalDebt).toBe(200) // only appointment
      expect(balanceRes.body.data.outstanding).toBe(200)
    })

    it('should count labwork price in debt when linked but priceIncludedInAppointment is false', async () => {
      // Create another labwork linked but NOT included in price
      await request(app)
        .post('/api/labworks')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          patientId: linkedPatientId,
          appointmentId,
          priceIncludedInAppointment: false,
          lab: 'Separate Lab',
          date: '2025-06-02',
          price: 50,
        })

      const balanceRes = await request(app)
        .get(`/api/patients/${linkedPatientId}/balance`)
        .set('Authorization', `Bearer ${adminToken}`)

      // $200 (appointment) + $50 (non-included labwork) = $250
      expect(balanceRes.body.data.totalDebt).toBe(250)
    })

    it('should reject labwork with appointmentId from different patient', async () => {
      const otherPatient = await prisma.patient.create({
        data: { tenantId, firstName: 'Other', lastName: 'Patient' },
      })

      const res = await request(app)
        .post('/api/labworks')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          patientId: otherPatient.id,
          appointmentId,
          priceIncludedInAppointment: true,
          lab: 'Invalid Lab',
          date: '2025-06-03',
          price: 100,
        })

      expect(res.status).toBe(400)
      expect(res.body.error).toContain('Appointment')
    })

    it('should ignore priceIncludedInAppointment when no appointmentId is provided', async () => {
      const res = await request(app)
        .post('/api/labworks')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          patientId: linkedPatientId,
          priceIncludedInAppointment: true, // should be ignored
          lab: 'Standalone Lab',
          date: '2025-06-04',
          price: 30,
        })

      expect(res.status).toBe(201)
      expect(res.body.data.priceIncludedInAppointment).toBe(false)
    })

    it('should not allocate FIFO payments to labworks with price included in appointment', async () => {
      // Create fresh patient for clean FIFO test
      const p = await prisma.patient.create({
        data: { tenantId, firstName: 'FIFOLinked', lastName: 'Test' },
      })

      // Appointment $100
      const apt = await prisma.appointment.create({
        data: {
          tenantId,
          patientId: p.id,
          doctorId,
          startTime: new Date('2025-07-01T10:00:00Z'),
          endTime: new Date('2025-07-01T10:30:00Z'),
          cost: 100,
          status: 'COMPLETED',
        },
      })

      // Labwork $50 included in appointment (should not consume payments)
      await request(app)
        .post('/api/labworks')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          patientId: p.id,
          appointmentId: apt.id,
          priceIncludedInAppointment: true,
          lab: 'FIFO Lab',
          date: '2025-07-01',
          price: 50,
        })

      // Labwork $60 standalone
      await request(app)
        .post('/api/labworks')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          patientId: p.id,
          lab: 'Standalone FIFO Lab',
          date: '2025-07-02',
          price: 60,
        })

      // Total debt should be $100 (apt) + $60 (standalone labwork) = $160
      const balanceRes = await request(app)
        .get(`/api/patients/${p.id}/balance`)
        .set('Authorization', `Bearer ${adminToken}`)

      expect(balanceRes.body.data.totalDebt).toBe(160)

      // Pay $100 — appointment should be paid, standalone labwork not
      await request(app)
        .post(`/api/patients/${p.id}/payments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: 100, date: '2025-07-15' })

      const appointments = await prisma.appointment.findMany({
        where: { tenantId, patientId: p.id },
      })
      expect(appointments[0].isPaid).toBe(true)

      const labworks = await prisma.labwork.findMany({
        where: { tenantId, patientId: p.id },
        orderBy: { date: 'asc' },
      })

      // Included labwork should be auto-paid
      const includedLw = labworks.find((l) => l.priceIncludedInAppointment)
      expect(includedLw?.isPaid).toBe(true)

      // Standalone labwork: $100 paid - $100 appointment = $0 remaining < $60
      const standaloneLw = labworks.find((l) => !l.priceIncludedInAppointment)
      expect(standaloneLw?.isPaid).toBe(false)
    })
  })

  describe('Advance payments (credit balance)', () => {
    let creditPatientId: string

    beforeAll(async () => {
      const patient = await prisma.patient.create({
        data: { tenantId, firstName: 'Credit', lastName: 'Test' },
      })
      creditPatientId = patient.id
    })

    it('reports credit=0 when the patient is underpaid', async () => {
      await prisma.appointment.create({
        data: {
          tenantId,
          patientId: creditPatientId,
          doctorId,
          startTime: new Date('2025-08-01T10:00:00Z'),
          endTime: new Date('2025-08-01T10:30:00Z'),
          cost: 100,
          status: 'COMPLETED',
        },
      })

      const res = await request(app)
        .post(`/api/patients/${creditPatientId}/payments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: 40, date: '2025-08-02' })

      expect(res.status).toBe(201)

      const balanceRes = await request(app)
        .get(`/api/patients/${creditPatientId}/balance`)
        .set('Authorization', `Bearer ${adminToken}`)

      expect(balanceRes.body.data.totalDebt).toBe(100)
      expect(balanceRes.body.data.totalPaid).toBe(40)
      expect(balanceRes.body.data.outstanding).toBe(60)
      expect(balanceRes.body.data.credit).toBe(0)
    })

    it('reports credit=0 when totalPaid exactly equals totalDebt (boundary)', async () => {
      const res = await request(app)
        .post(`/api/patients/${creditPatientId}/payments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: 60, date: '2025-08-03' })

      expect(res.status).toBe(201)

      const balanceRes = await request(app)
        .get(`/api/patients/${creditPatientId}/balance`)
        .set('Authorization', `Bearer ${adminToken}`)

      expect(balanceRes.body.data.totalDebt).toBe(100)
      expect(balanceRes.body.data.totalPaid).toBe(100)
      expect(balanceRes.body.data.outstanding).toBe(0)
      expect(balanceRes.body.data.credit).toBe(0)
    })

    it('reports a positive credit once payments exceed debt, and outstanding stays clamped at 0', async () => {
      const res = await request(app)
        .post(`/api/patients/${creditPatientId}/payments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: 25, date: '2025-08-04', note: 'Advance for next visit' })

      expect(res.status).toBe(201)

      const balanceRes = await request(app)
        .get(`/api/patients/${creditPatientId}/balance`)
        .set('Authorization', `Bearer ${adminToken}`)

      expect(balanceRes.body.data.totalDebt).toBe(100)
      expect(balanceRes.body.data.totalPaid).toBe(125)
      expect(balanceRes.body.data.outstanding).toBe(0)
      expect(balanceRes.body.data.credit).toBe(25)
    })

    it('auto-applies standing credit (via FIFO) to a new charge added after the advance payment', async () => {
      // creditPatientId currently has a $25 credit (see previous test) and no
      // other outstanding debt. Adding a new $20 appointment should be
      // immediately reflected as paid by the existing credit, with no new
      // payment required.
      const times = { startTime: '2025-08-10T10:00:00Z', endTime: '2025-08-10T10:30:00Z' }
      const newAppointment = await prisma.appointment.create({
        data: {
          tenantId,
          patientId: creditPatientId,
          doctorId,
          startTime: new Date(times.startTime),
          endTime: new Date(times.endTime),
          cost: 20,
          status: 'COMPLETED',
        },
      })

      // The balance endpoint aggregates live (not from the stored isPaid
      // column), so it reflects the new debt against existing credit
      // immediately.
      const balanceRes = await request(app)
        .get(`/api/patients/${creditPatientId}/balance`)
        .set('Authorization', `Bearer ${adminToken}`)

      expect(balanceRes.body.data.totalDebt).toBe(120) // 100 + 20
      expect(balanceRes.body.data.totalPaid).toBe(125)
      expect(balanceRes.body.data.outstanding).toBe(0)
      expect(balanceRes.body.data.credit).toBe(5) // 125 - 120

      // The per-appointment FIFO allocation (exposed via the appointments
      // list) shows the new appointment as fully paid by the existing
      // credit without a dedicated payment for it.
      const listRes = await request(app)
        .get(`/api/appointments/by-patient/${creditPatientId}`)
        .set('Authorization', `Bearer ${adminToken}`)

      const found = listRes.body.data.find((a: { id: string }) => a.id === newAppointment.id)
      expect(found).toBeDefined()
      expect(found.isPaid).toBe(true)
      expect(found.paidAmount).toBe(20)
      expect(found.outstanding).toBe(0)
    })
  })

  describe('GET /api/patients/debts', () => {
    let debtorAId: string
    let debtorBId: string
    let paidPatientId: string
    let noBillablesPatientId: string

    beforeAll(async () => {
      // Debtor A: $200 debt, $50 paid -> $150 outstanding
      const debtorA = await prisma.patient.create({
        data: { tenantId, firstName: 'DebtorA', lastName: 'Test' },
      })
      debtorAId = debtorA.id
      await prisma.appointment.create({
        data: {
          tenantId,
          patientId: debtorAId,
          doctorId,
          startTime: new Date('2025-09-01T10:00:00Z'),
          endTime: new Date('2025-09-01T10:30:00Z'),
          cost: 200,
          status: 'COMPLETED',
        },
      })
      await request(app)
        .post(`/api/patients/${debtorAId}/payments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: 50, date: '2025-09-02' })

      // Debtor B: $500 debt, $100 paid -> $400 outstanding (bigger than A's, for sort ordering)
      const debtorB = await prisma.patient.create({
        data: { tenantId, firstName: 'DebtorB', lastName: 'Test' },
      })
      debtorBId = debtorB.id
      await prisma.appointment.create({
        data: {
          tenantId,
          patientId: debtorBId,
          doctorId,
          startTime: new Date('2025-09-03T10:00:00Z'),
          endTime: new Date('2025-09-03T10:30:00Z'),
          cost: 500,
          status: 'COMPLETED',
        },
      })
      await request(app)
        .post(`/api/patients/${debtorBId}/payments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: 100, date: '2025-09-04' })

      // Fully-paid patient: $100 debt, $100 paid -> $0 outstanding (must be excluded)
      const paidPatient = await prisma.patient.create({
        data: { tenantId, firstName: 'FullyPaid', lastName: 'Test' },
      })
      paidPatientId = paidPatient.id
      await prisma.appointment.create({
        data: {
          tenantId,
          patientId: paidPatientId,
          doctorId,
          startTime: new Date('2025-09-05T10:00:00Z'),
          endTime: new Date('2025-09-05T10:30:00Z'),
          cost: 100,
          status: 'COMPLETED',
        },
      })
      await request(app)
        .post(`/api/patients/${paidPatientId}/payments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: 100, date: '2025-09-06' })

      // Patient with no billable items at all (must be excluded)
      const noBillables = await prisma.patient.create({
        data: { tenantId, firstName: 'NoBillables', lastName: 'Test' },
      })
      noBillablesPatientId = noBillables.id
    })

    it('should return 401 without authentication', async () => {
      const res = await request(app).get('/api/patients/debts')

      expect(res.status).toBe(401)
    })

    it('should allow STAFF (PAYMENTS_VIEW) to view the debtors list, consistent with /balance', async () => {
      const res = await request(app)
        .get('/api/patients/debts')
        .set('Authorization', `Bearer ${staffToken}`)

      expect(res.status).toBe(200)
      expect(Array.isArray(res.body.data)).toBe(true)
    })

    it('should include a patient with outstanding debt with the correct totals', async () => {
      const res = await request(app)
        .get('/api/patients/debts')
        .set('Authorization', `Bearer ${adminToken}`)

      expect(res.status).toBe(200)
      const debtorA = res.body.data.find((d: { patientId: string }) => d.patientId === debtorAId)
      expect(debtorA).toEqual({
        patientId: debtorAId,
        name: 'DebtorA Test',
        totalDebt: 200,
        totalPaid: 50,
        outstanding: 150,
      })
    })

    it('should exclude a fully-paid patient (outstanding === 0)', async () => {
      const res = await request(app)
        .get('/api/patients/debts')
        .set('Authorization', `Bearer ${adminToken}`)

      expect(res.status).toBe(200)
      expect(
        res.body.data.find((d: { patientId: string }) => d.patientId === paidPatientId)
      ).toBeUndefined()
    })

    it('should exclude a patient with no billable items (no appointments/labworks)', async () => {
      const res = await request(app)
        .get('/api/patients/debts')
        .set('Authorization', `Bearer ${adminToken}`)

      expect(res.status).toBe(200)
      expect(
        res.body.data.find((d: { patientId: string }) => d.patientId === noBillablesPatientId)
      ).toBeUndefined()
    })

    it('should sort the full result set by outstanding descending', async () => {
      const res = await request(app)
        .get('/api/patients/debts')
        .set('Authorization', `Bearer ${adminToken}`)

      expect(res.status).toBe(200)

      // Debtor B ($400 outstanding) must come before Debtor A ($150 outstanding)
      const relevant = res.body.data.filter((d: { patientId: string }) =>
        [debtorAId, debtorBId].includes(d.patientId)
      )
      expect(relevant.map((d: { patientId: string }) => d.patientId)).toEqual([debtorBId, debtorAId])

      // The list as a whole (including other debtors created by earlier tests
      // in this file) must already be in descending order.
      const outstandingValues = res.body.data.map((d: { outstanding: number }) => d.outstanding)
      const sortedDesc = [...outstandingValues].sort((a: number, b: number) => b - a)
      expect(outstandingValues).toEqual(sortedDesc)
    })
  })

  describe('Payment kind filtering (regression + new filter)', () => {
    let kindPatientId: string
    let linkedAppointmentId: string
    let appointmentPaymentId: string
    let advancePaymentId: string

    beforeAll(async () => {
      const patient = await prisma.patient.create({
        data: { tenantId, firstName: 'Kind', lastName: 'Filter' },
      })
      kindPatientId = patient.id

      // Appointment-driven payment: mark an appointment as paid.
      const appointment = await prisma.appointment.create({
        data: {
          tenantId,
          patientId: kindPatientId,
          doctorId,
          startTime: new Date('2025-10-01T10:00:00Z'),
          endTime: new Date('2025-10-01T10:30:00Z'),
          cost: 80,
          status: 'COMPLETED',
        },
      })
      linkedAppointmentId = appointment.id

      const putRes = await request(app)
        .put(`/api/appointments/${appointment.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ isPaid: true })
      expect(putRes.status).toBe(200)

      // Freestanding advance for the same patient.
      const advanceRes = await request(app)
        .post(`/api/patients/${kindPatientId}/payments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: 30, date: '2025-10-02', note: 'Advance' })
      expect(advanceRes.status).toBe(201)
      advancePaymentId = advanceRes.body.data.id

      const listRes = await request(app)
        .get(`/api/patients/${kindPatientId}/payments`)
        .set('Authorization', `Bearer ${adminToken}`)
      appointmentPaymentId = listRes.body.data.find(
        (p: { kind: string; id: string }) => p.kind === 'APPOINTMENT'
      ).id
    })

    it('with no kind param, returns both kinds — regression on the pre-existing response shape/pagination', async () => {
      const res = await request(app)
        .get(`/api/patients/${kindPatientId}/payments`)
        .set('Authorization', `Bearer ${adminToken}`)

      expect(res.status).toBe(200)
      expect(res.body.data).toHaveLength(2)
      expect(res.body.pagination).toEqual({ total: 2, limit: 50, offset: 0 })

      const kinds = res.body.data.map((p: { kind: string }) => p.kind).sort()
      expect(kinds).toEqual(['ADVANCE', 'APPOINTMENT'])

      const appointmentPayment = res.body.data.find(
        (p: { id: string }) => p.id === appointmentPaymentId
      )
      expect(appointmentPayment).toMatchObject({
        id: appointmentPaymentId,
        kind: 'APPOINTMENT',
        appointmentId: linkedAppointmentId,
        note: 'Pago en consulta',
      })
      expect(Number(appointmentPayment.amount)).toBe(80)

      const advancePayment = res.body.data.find((p: { id: string }) => p.id === advancePaymentId)
      expect(advancePayment).toMatchObject({
        id: advancePaymentId,
        kind: 'ADVANCE',
        appointmentId: null,
        note: 'Advance',
      })
    })

    it('?kind=ADVANCE returns only the freestanding advance', async () => {
      const res = await request(app)
        .get(`/api/patients/${kindPatientId}/payments?kind=ADVANCE`)
        .set('Authorization', `Bearer ${adminToken}`)

      expect(res.status).toBe(200)
      expect(res.body.data).toHaveLength(1)
      expect(res.body.data[0].id).toBe(advancePaymentId)
      expect(res.body.data[0].kind).toBe('ADVANCE')
      expect(res.body.pagination.total).toBe(1)
    })

    it('?kind=APPOINTMENT returns only the appointment-driven payment', async () => {
      const res = await request(app)
        .get(`/api/patients/${kindPatientId}/payments?kind=APPOINTMENT`)
        .set('Authorization', `Bearer ${adminToken}`)

      expect(res.status).toBe(200)
      expect(res.body.data).toHaveLength(1)
      expect(res.body.data[0].id).toBe(appointmentPaymentId)
      expect(res.body.data[0].appointmentId).toBe(linkedAppointmentId)
      expect(res.body.pagination.total).toBe(1)
    })

    it('?kind=BOGUS is rejected with 400', async () => {
      const res = await request(app)
        .get(`/api/patients/${kindPatientId}/payments?kind=BOGUS`)
        .set('Authorization', `Bearer ${adminToken}`)

      expect(res.status).toBe(400)
    })
  })

  describe('Payment kind — tenant isolation', () => {
    let otherTenantId: string
    let otherAdminToken: string
    let otherPatientId: string
    let otherAppointmentId: string
    let otherAppointmentPaymentId: string

    beforeAll(async () => {
      const otherTenant = await prisma.tenant.create({
        data: { name: 'Other Payments Tenant', slug: `other-payments-${Date.now()}` },
      })
      otherTenantId = otherTenant.id

      const hashedPassword = await hashPassword('password123')
      const otherAdmin = await prisma.user.create({
        data: {
          tenantId: otherTenantId,
          email: 'admin@other-payments-test.com',
          firstName: 'Other',
          lastName: 'Admin',
          passwordHash: hashedPassword,
          role: 'ADMIN',
        },
      })
      otherAdminToken = generateToken(otherAdmin.id, otherTenantId, 'ADMIN')

      const otherPatient = await prisma.patient.create({
        data: { tenantId: otherTenantId, firstName: 'Other', lastName: 'Patient' },
      })
      otherPatientId = otherPatient.id

      const otherDoctor = await prisma.doctor.create({
        data: { tenantId: otherTenantId, firstName: 'Other', lastName: 'Doctor' },
      })

      const appointment = await prisma.appointment.create({
        data: {
          tenantId: otherTenantId,
          patientId: otherPatientId,
          doctorId: otherDoctor.id,
          startTime: new Date('2025-11-01T10:00:00Z'),
          endTime: new Date('2025-11-01T10:30:00Z'),
          cost: 40,
          status: 'COMPLETED',
        },
      })
      otherAppointmentId = appointment.id

      const putRes = await request(app)
        .put(`/api/appointments/${appointment.id}`)
        .set('Authorization', `Bearer ${otherAdminToken}`)
        .send({ isPaid: true })
      expect(putRes.status).toBe(200)

      const listRes = await request(app)
        .get(`/api/patients/${otherPatientId}/payments`)
        .set('Authorization', `Bearer ${otherAdminToken}`)
      otherAppointmentPaymentId = listRes.body.data[0].id
    })

    afterAll(async () => {
      await prisma.patientPayment.deleteMany({ where: { tenantId: otherTenantId } })
      await prisma.appointment.deleteMany({ where: { tenantId: otherTenantId } })
      await prisma.patient.deleteMany({ where: { tenantId: otherTenantId } })
      await prisma.doctor.deleteMany({ where: { tenantId: otherTenantId } })
      await prisma.user.deleteMany({ where: { tenantId: otherTenantId } })
      await prisma.tenant.delete({ where: { id: otherTenantId } }).catch(() => {})
    })

    it('the auto-generated appointmentId link always points at an appointment in the owning tenant', async () => {
      const payment = await prisma.patientPayment.findUnique({
        where: { id: otherAppointmentPaymentId },
      })
      expect(payment?.tenantId).toBe(otherTenantId)
      expect(payment?.appointmentId).toBe(otherAppointmentId)

      const linkedAppointment = await prisma.appointment.findUnique({
        where: { id: payment!.appointmentId! },
      })
      expect(linkedAppointment?.tenantId).toBe(otherTenantId)
    })

    it('?kind= filtering under the main tenant never returns another tenant payment', async () => {
      const res = await request(app)
        .get(`/api/patients/${patientId}/payments?kind=APPOINTMENT`)
        .set('Authorization', `Bearer ${adminToken}`)

      expect(res.status).toBe(200)
      expect(
        res.body.data.find((p: { id: string }) => p.id === otherAppointmentPaymentId)
      ).toBeUndefined()
    })

    it("another tenant's token querying the main tenant's patient gets an empty result, never the main tenant's payments", async () => {
      const res = await request(app)
        .get(`/api/patients/${patientId}/payments?kind=ADVANCE`)
        .set('Authorization', `Bearer ${otherAdminToken}`)

      expect(res.status).toBe(200)
      expect(res.body.data).toEqual([])
      expect(res.body.pagination.total).toBe(0)
    })
  })

  describe('FIFO unaffected by payment kind (behavior-neutral regression)', () => {
    let mixedPatientId: string
    let apt1Id: string

    beforeAll(async () => {
      const patient = await prisma.patient.create({
        data: { tenantId, firstName: 'MixedKind', lastName: 'Test' },
      })
      mixedPatientId = patient.id

      const apt1 = await prisma.appointment.create({
        data: {
          tenantId,
          patientId: mixedPatientId,
          doctorId,
          startTime: new Date('2025-12-01T10:00:00Z'),
          endTime: new Date('2025-12-01T10:30:00Z'),
          cost: 100,
          status: 'COMPLETED',
        },
      })
      apt1Id = apt1.id

      await prisma.appointment.create({
        data: {
          tenantId,
          patientId: mixedPatientId,
          doctorId,
          startTime: new Date('2025-12-05T10:00:00Z'),
          endTime: new Date('2025-12-05T10:30:00Z'),
          cost: 200,
          status: 'COMPLETED',
        },
      })
    })

    it('sums ADVANCE and APPOINTMENT-kind payments identically for balance and FIFO isPaid', async () => {
      // Step 1: freestanding advance of $50.
      const advanceRes = await request(app)
        .post(`/api/patients/${mixedPatientId}/payments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: 50, date: '2025-12-02' })
      expect(advanceRes.status).toBe(201)
      expect(advanceRes.body.data.kind).toBe('ADVANCE')

      // Step 2: mark apt1 (cost 100) as paid. Outstanding at that moment is
      // 300 - 50 = 250, so the auto-payment is the full cost ($100, kind=APPOINTMENT).
      const putRes = await request(app)
        .put(`/api/appointments/${apt1Id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ isPaid: true })
      expect(putRes.status).toBe(200)

      const balanceAfterStep2 = await request(app)
        .get(`/api/patients/${mixedPatientId}/balance`)
        .set('Authorization', `Bearer ${adminToken}`)
      expect(balanceAfterStep2.body.data).toEqual({
        totalDebt: 300,
        totalPaid: 150,
        outstanding: 150,
        credit: 0,
      })

      const aptsAfterStep2 = await prisma.appointment.findMany({
        where: { tenantId, patientId: mixedPatientId },
        orderBy: { startTime: 'asc' },
      })
      // FIFO summed $50 (ADVANCE) + $100 (APPOINTMENT) = $150 across the two
      // billable items ($100, $200): apt1 fully covered, apt2 only $50 in.
      expect(aptsAfterStep2[0].isPaid).toBe(true)
      expect(aptsAfterStep2[1].isPaid).toBe(false)

      // Step 3: a second ADVANCE of $150 brings totalPaid to exactly $300,
      // completing apt2 via FIFO — proving ADVANCE and APPOINTMENT rows are
      // summed together exactly as a same-kind set would have been before
      // this task (kind is purely a label, never a filter on these sums).
      const advance2Res = await request(app)
        .post(`/api/patients/${mixedPatientId}/payments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: 150, date: '2025-12-06' })
      expect(advance2Res.status).toBe(201)

      const balanceAfterStep3 = await request(app)
        .get(`/api/patients/${mixedPatientId}/balance`)
        .set('Authorization', `Bearer ${adminToken}`)
      expect(balanceAfterStep3.body.data).toEqual({
        totalDebt: 300,
        totalPaid: 300,
        outstanding: 0,
        credit: 0,
      })

      const aptsAfterStep3 = await prisma.appointment.findMany({
        where: { tenantId, patientId: mixedPatientId },
        orderBy: { startTime: 'asc' },
      })
      expect(aptsAfterStep3[0].isPaid).toBe(true)
      expect(aptsAfterStep3[1].isPaid).toBe(true)

      // Fully paid: the debtors dashboard must exclude this patient too.
      const debtsRes = await request(app)
        .get('/api/patients/debts')
        .set('Authorization', `Bearer ${adminToken}`)
      expect(
        debtsRes.body.data.find((d: { patientId: string }) => d.patientId === mixedPatientId)
      ).toBeUndefined()

      // Sanity check on the underlying rows' kinds and the link.
      const paymentsInDb = await prisma.patientPayment.findMany({
        where: { tenantId, patientId: mixedPatientId },
        orderBy: { createdAt: 'asc' },
      })
      expect(paymentsInDb.map((p) => p.kind)).toEqual(['ADVANCE', 'APPOINTMENT', 'ADVANCE'])
      expect(paymentsInDb[1].appointmentId).toBe(apt1Id)
    })
  })

  describe('Appointment deletion nulls the payment link (onDelete: SetNull)', () => {
    it('a hard-deleted linked appointment nulls appointmentId but the payment row survives', async () => {
      const patient = await prisma.patient.create({
        data: { tenantId, firstName: 'SetNull', lastName: 'Test' },
      })

      const appointment = await prisma.appointment.create({
        data: {
          tenantId,
          patientId: patient.id,
          doctorId,
          startTime: new Date('2026-01-01T10:00:00Z'),
          endTime: new Date('2026-01-01T10:30:00Z'),
          cost: 45,
          status: 'COMPLETED',
        },
      })

      const putRes = await request(app)
        .put(`/api/appointments/${appointment.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ isPaid: true })
      expect(putRes.status).toBe(200)

      const paymentsBefore = await prisma.patientPayment.findMany({
        where: { tenantId, patientId: patient.id },
      })
      expect(paymentsBefore).toHaveLength(1)
      expect(paymentsBefore[0].kind).toBe('APPOINTMENT')
      expect(paymentsBefore[0].appointmentId).toBe(appointment.id)
      const paymentId = paymentsBefore[0].id

      // The app only ever soft-deletes appointments (isActive=false), so this
      // exercises the FK's onDelete: SetNull directly, the way a hard row
      // deletion (e.g. a future admin cleanup script) would.
      await prisma.appointment.delete({ where: { id: appointment.id } })

      const paymentAfter = await prisma.patientPayment.findUnique({ where: { id: paymentId } })
      expect(paymentAfter).not.toBeNull()
      expect(paymentAfter?.isActive).toBe(true)
      expect(paymentAfter?.appointmentId).toBeNull()
      expect(paymentAfter?.kind).toBe('APPOINTMENT') // the classification label survives; only the FK link is cleared
      expect(Number(paymentAfter?.amount)).toBe(45)
    })
  })

  describe('Backfill migration (20260810200705_add_payment_kind_discriminator)', () => {
    // These two statements are a byte-for-byte copy of the DML block in
    // packages/database/prisma/migrations/20260810200705_add_payment_kind_discriminator/migration.sql,
    // with one addition: an `"id" IN (...)` filter restricting each statement
    // to the rows created by this test. Running the literal, unscoped
    // migration SQL against the shared dental_test database inside a test
    // would also rewrite every 'Pago en consulta' row created by other
    // concurrently-run test files (e.g. the auto-payment fixtures elsewhere
    // in this very file), which is both non-deterministic for this test and
    // destructive to theirs. The predicates and join conditions below are
    // otherwise unmodified.
    let backfillPatientId: string
    let singleCandidateAppointmentId: string
    let paymentIds: {
      unambiguous: string
      ambiguous: string
      noCandidate: string
      otherNote: string
      noNote: string
    }

    beforeAll(async () => {
      const patient = await prisma.patient.create({
        data: { tenantId, firstName: 'Backfill', lastName: 'Test' },
      })
      backfillPatientId = patient.id

      // Day 1: exactly one same-day, same-tenant, same-patient, isPaid appointment -> unambiguous link.
      const singleCandidate = await prisma.appointment.create({
        data: {
          tenantId,
          patientId: backfillPatientId,
          doctorId,
          startTime: new Date('2025-05-01T09:00:00Z'),
          endTime: new Date('2025-05-01T09:30:00Z'),
          cost: 100,
          isPaid: true,
          status: 'COMPLETED',
        },
      })
      singleCandidateAppointmentId = singleCandidate.id

      // Day 2: two same-day isPaid candidates -> ambiguous, must NOT be linked.
      await prisma.appointment.createMany({
        data: [
          {
            tenantId,
            patientId: backfillPatientId,
            doctorId,
            startTime: new Date('2025-05-02T09:00:00Z'),
            endTime: new Date('2025-05-02T09:30:00Z'),
            cost: 50,
            isPaid: true,
            status: 'COMPLETED',
          },
          {
            tenantId,
            patientId: backfillPatientId,
            doctorId,
            startTime: new Date('2025-05-02T15:00:00Z'),
            endTime: new Date('2025-05-02T15:30:00Z'),
            cost: 50,
            isPaid: true,
            status: 'COMPLETED',
          },
        ],
      })

      // Day 3: a same-day appointment exists but isPaid=false -> zero eligible candidates.
      await prisma.appointment.create({
        data: {
          tenantId,
          patientId: backfillPatientId,
          doctorId,
          startTime: new Date('2025-05-03T09:00:00Z'),
          endTime: new Date('2025-05-03T09:30:00Z'),
          cost: 75,
          isPaid: false,
          status: 'COMPLETED',
        },
      })

      // Pre-migration-shaped payment rows: kind/appointmentId are omitted so
      // they get the column defaults (ADVANCE / null) — exactly the shape
      // every existing row had right before the migration's DML ran.
      const unambiguous = await prisma.patientPayment.create({
        data: {
          tenantId,
          patientId: backfillPatientId,
          amount: 100,
          date: new Date('2025-05-01T09:15:00Z'),
          note: 'Pago en consulta',
        },
      })
      const ambiguous = await prisma.patientPayment.create({
        data: {
          tenantId,
          patientId: backfillPatientId,
          amount: 50,
          date: new Date('2025-05-02T10:00:00Z'),
          note: 'Pago en consulta',
        },
      })
      const noCandidate = await prisma.patientPayment.create({
        data: {
          tenantId,
          patientId: backfillPatientId,
          amount: 75,
          date: new Date('2025-05-03T09:15:00Z'),
          note: 'Pago en consulta',
        },
      })
      const otherNote = await prisma.patientPayment.create({
        data: {
          tenantId,
          patientId: backfillPatientId,
          amount: 30,
          date: new Date('2025-05-04T09:00:00Z'),
          note: 'Regular advance',
        },
      })
      const noNote = await prisma.patientPayment.create({
        data: {
          tenantId,
          patientId: backfillPatientId,
          amount: 20,
          date: new Date('2025-05-05T09:00:00Z'),
          note: null,
        },
      })

      paymentIds = {
        unambiguous: unambiguous.id,
        ambiguous: ambiguous.id,
        noCandidate: noCandidate.id,
        otherNote: otherNote.id,
        noNote: noNote.id,
      }
      const allIds = Object.values(paymentIds)

      // Statement 1 (verbatim): note-string classification.
      await prisma.$executeRaw`
        UPDATE "patient_payments"
        SET "kind" = 'APPOINTMENT'
        WHERE "note" = 'Pago en consulta' AND "id" IN (${Prisma.join(allIds)})
      `

      // Statement 2 (verbatim): unambiguous-single-candidate-only linking.
      await prisma.$executeRaw`
        WITH candidates AS (
          SELECT
            pp."id" AS payment_id,
            a."id" AS appointment_id,
            COUNT(*) OVER (PARTITION BY pp."id") AS candidate_count
          FROM "patient_payments" pp
          JOIN "appointments" a
            ON a."tenantId" = pp."tenantId"
            AND a."patientId" = pp."patientId"
            AND a."isPaid" = true
            AND DATE(a."startTime") = DATE(pp."date")
          WHERE pp."kind" = 'APPOINTMENT' AND pp."id" IN (${Prisma.join(allIds)})
        )
        UPDATE "patient_payments" pp
        SET "appointmentId" = c.appointment_id
        FROM candidates c
        WHERE pp."id" = c.payment_id
          AND c.candidate_count = 1
      `
    })

    it('classifies note-matching rows as APPOINTMENT and leaves every other row ADVANCE', async () => {
      const rows = await prisma.patientPayment.findMany({
        where: { id: { in: Object.values(paymentIds) } },
      })
      const kindById = new Map(rows.map((r) => [r.id, r.kind]))

      expect(kindById.get(paymentIds.unambiguous)).toBe('APPOINTMENT')
      expect(kindById.get(paymentIds.ambiguous)).toBe('APPOINTMENT')
      expect(kindById.get(paymentIds.noCandidate)).toBe('APPOINTMENT')
      expect(kindById.get(paymentIds.otherNote)).toBe('ADVANCE')
      expect(kindById.get(paymentIds.noNote)).toBe('ADVANCE')
    })

    it('links only the single-candidate row; ambiguous (2+) and zero-candidate rows stay unlinked, never mis-linked', async () => {
      const rows = await prisma.patientPayment.findMany({
        where: { id: { in: Object.values(paymentIds) } },
      })
      const linkById = new Map(rows.map((r) => [r.id, r.appointmentId]))

      expect(linkById.get(paymentIds.unambiguous)).toBe(singleCandidateAppointmentId)
      expect(linkById.get(paymentIds.ambiguous)).toBeNull()
      expect(linkById.get(paymentIds.noCandidate)).toBeNull()
      expect(linkById.get(paymentIds.otherNote)).toBeNull()
      expect(linkById.get(paymentIds.noNote)).toBeNull()
    })
  })
})
