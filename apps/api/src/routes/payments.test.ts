import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { app } from '../app.js'
import { prisma } from '@dental/database'
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
})
