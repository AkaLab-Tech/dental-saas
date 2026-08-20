import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { sign } from 'jsonwebtoken'
import { api } from '../test/http.js'
import { prisma } from '@dental/database'
import { hashPassword } from '../services/auth.service.js'

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret'

function generateToken(userId: string, tenantId: string, role: string) {
  return sign({ sub: userId, tenantId, role }, JWT_SECRET, { expiresIn: '1h' })
}

describe('Budgets routes', () => {
  let tenantId: string
  let otherTenantId: string
  let adminToken: string
  let doctorToken: string
  let staffToken: string
  let otherAdminToken: string
  let patientId: string
  let otherPatientId: string
  const suffix = Date.now()

  beforeAll(async () => {
    const hashedPassword = await hashPassword('password123')

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
      data: {
        name: 'Test Clinic for Budgets',
        slug: `test-budgets-${suffix}`,
        currency: 'USD',
        timezone: 'America/New_York',
      },
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

    const adminUser = await prisma.user.create({
      data: {
        tenantId,
        email: `admin-${suffix}@budgets-test.com`,
        firstName: 'Admin',
        lastName: 'User',
        passwordHash: hashedPassword,
        role: 'ADMIN',
      },
    })
    adminToken = generateToken(adminUser.id, tenantId, 'ADMIN')

    const doctorUser = await prisma.user.create({
      data: {
        tenantId,
        email: `doctor-${suffix}@budgets-test.com`,
        firstName: 'Doctor',
        lastName: 'User',
        passwordHash: hashedPassword,
        role: 'DOCTOR',
      },
    })
    doctorToken = generateToken(doctorUser.id, tenantId, 'DOCTOR')

    const staffUser = await prisma.user.create({
      data: {
        tenantId,
        email: `staff-${suffix}@budgets-test.com`,
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

    // Second tenant for isolation checks
    const otherTenant = await prisma.tenant.create({
      data: {
        name: 'Other Clinic',
        slug: `other-budgets-${suffix}`,
        currency: 'USD',
        timezone: 'America/New_York',
      },
    })
    otherTenantId = otherTenant.id

    await prisma.subscription.create({
      data: {
        tenantId: otherTenantId,
        planId: freePlan.id,
        status: 'ACTIVE',
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    })

    const otherAdmin = await prisma.user.create({
      data: {
        tenantId: otherTenantId,
        email: `other-admin-${suffix}@budgets-test.com`,
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
  })

  afterAll(async () => {
    await prisma.budget.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } })
    await prisma.patient.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } })
    await prisma.user.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } })
    await prisma.subscription.deleteMany({
      where: { tenantId: { in: [tenantId, otherTenantId] } },
    })
    await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, otherTenantId] } } })
  })

  beforeEach(async () => {
    await prisma.budget.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } })
  })

  // --------------------------------------------------------------------------
  // POST /api/patients/:id/budgets
  // --------------------------------------------------------------------------
  describe('POST /api/patients/:id/budgets', () => {
    const validBody = {
      notes: 'Full-mouth rehab',
      items: [
        { description: 'Cleaning', quantity: 1, unitPrice: 80 },
        { description: 'Filling 16', toothNumber: '16', quantity: 2, unitPrice: 50 },
      ],
    }

    it('creates a budget with items and recalculates totalAmount', async () => {
      const res = await api()
        .post(`/api/patients/${patientId}/budgets`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send(validBody)

      expect(res.status).toBe(201)
      expect(res.body.success).toBe(true)
      expect(res.body.data.patientId).toBe(patientId)
      expect(res.body.data.status).toBe('DRAFT')
      expect(Number(res.body.data.totalAmount)).toBe(180) // 80 + 2*50
      expect(res.body.data.items).toHaveLength(2)
      expect(Number(res.body.data.items[0].totalPrice)).toBe(80)
      expect(Number(res.body.data.items[1].totalPrice)).toBe(100)
      expect(res.body.data.items[0].order).toBe(0)
      expect(res.body.data.items[1].order).toBe(1)
    })

    it('allows DOCTOR role to create a budget', async () => {
      const res = await api()
        .post(`/api/patients/${patientId}/budgets`)
        .set('Authorization', `Bearer ${doctorToken}`)
        .send(validBody)

      expect(res.status).toBe(201)
    })

    it('rejects STAFF role with 403', async () => {
      const res = await api()
        .post(`/api/patients/${patientId}/budgets`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send(validBody)

      expect(res.status).toBe(403)
    })

    it('returns 400 when items array is empty', async () => {
      const res = await api()
        .post(`/api/patients/${patientId}/budgets`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ items: [] })

      expect(res.status).toBe(400)
      expect(res.body.error).toBe('Validation error')
    })

    it('returns 400 when quantity is less than 1', async () => {
      const res = await api()
        .post(`/api/patients/${patientId}/budgets`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          items: [{ description: 'X', quantity: 0, unitPrice: 10 }],
        })

      expect(res.status).toBe(400)
    })

    it('returns 400 when unitPrice is negative', async () => {
      const res = await api()
        .post(`/api/patients/${patientId}/budgets`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          items: [{ description: 'X', quantity: 1, unitPrice: -5 }],
        })

      expect(res.status).toBe(400)
    })

    it('returns 404 when patient does not exist', async () => {
      const res = await api()
        .post(`/api/patients/non-existent-id/budgets`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send(validBody)

      expect(res.status).toBe(404)
    })

    it('cannot create budget for a patient from another tenant', async () => {
      const res = await api()
        .post(`/api/patients/${otherPatientId}/budgets`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send(validBody)

      expect(res.status).toBe(404)
    })

    it('accepts validUntil as an ISO date string', async () => {
      const res = await api()
        .post(`/api/patients/${patientId}/budgets`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ ...validBody, validUntil: '2027-01-15' })

      expect(res.status).toBe(201)
      expect(new Date(res.body.data.validUntil).toISOString().slice(0, 10)).toBe('2027-01-15')
    })
  })

  // --------------------------------------------------------------------------
  // GET /api/patients/:id/budgets
  // --------------------------------------------------------------------------
  describe('GET /api/patients/:id/budgets', () => {
    it('returns empty list when patient has no budgets', async () => {
      const res = await api()
        .get(`/api/patients/${patientId}/budgets`)
        .set('Authorization', `Bearer ${staffToken}`)

      expect(res.status).toBe(200)
      expect(res.body.data).toEqual([])
      expect(res.body.pagination.total).toBe(0)
    })

    it('returns budgets ordered by createdAt DESC', async () => {
      await prisma.budget.create({
        data: { tenantId, patientId, notes: 'old', totalAmount: 100 },
      })
      await new Promise((r) => setTimeout(r, 10))
      await prisma.budget.create({
        data: { tenantId, patientId, notes: 'new', totalAmount: 200 },
      })

      const res = await api()
        .get(`/api/patients/${patientId}/budgets`)
        .set('Authorization', `Bearer ${staffToken}`)

      expect(res.status).toBe(200)
      expect(res.body.data).toHaveLength(2)
      expect(res.body.data[0].notes).toBe('new')
      expect(res.body.data[1].notes).toBe('old')
    })

    it('excludes soft-deleted budgets unless includeInactive=true', async () => {
      await prisma.budget.create({ data: { tenantId, patientId, notes: 'active' } })
      await prisma.budget.create({ data: { tenantId, patientId, notes: 'deleted', isActive: false } })

      const defaultRes = await api()
        .get(`/api/patients/${patientId}/budgets`)
        .set('Authorization', `Bearer ${staffToken}`)
      expect(defaultRes.body.data).toHaveLength(1)

      const allRes = await api()
        .get(`/api/patients/${patientId}/budgets?includeInactive=true`)
        .set('Authorization', `Bearer ${staffToken}`)
      expect(allRes.body.data).toHaveLength(2)
    })

    it('does not leak budgets across tenants', async () => {
      await prisma.budget.create({ data: { tenantId, patientId, notes: 'mine' } })
      await prisma.budget.create({
        data: { tenantId: otherTenantId, patientId: otherPatientId, notes: 'theirs' },
      })

      const res = await api()
        .get(`/api/patients/${patientId}/budgets`)
        .set('Authorization', `Bearer ${adminToken}`)

      expect(res.body.data).toHaveLength(1)
      expect(res.body.data[0].notes).toBe('mine')
    })
  })

  // --------------------------------------------------------------------------
  // GET /api/budgets/:id
  // --------------------------------------------------------------------------
  describe('GET /api/budgets/:id', () => {
    it('returns the budget with its items in ascending order', async () => {
      const created = await prisma.budget.create({
        data: {
          tenantId,
          patientId,
          items: {
            create: [
              { description: 'second', quantity: 1, unitPrice: 10, totalPrice: 10, order: 1 },
              { description: 'first', quantity: 1, unitPrice: 10, totalPrice: 10, order: 0 },
            ],
          },
        },
      })

      const res = await api()
        .get(`/api/budgets/${created.id}`)
        .set('Authorization', `Bearer ${staffToken}`)

      expect(res.status).toBe(200)
      expect(res.body.data.items.map((i: { description: string }) => i.description)).toEqual([
        'first',
        'second',
      ])
    })

    it('returns 404 for other-tenant budget', async () => {
      const other = await prisma.budget.create({
        data: { tenantId: otherTenantId, patientId: otherPatientId, notes: 'theirs' },
      })
      const res = await api()
        .get(`/api/budgets/${other.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
      expect(res.status).toBe(404)
    })

    it('returns 404 for non-existent id', async () => {
      const res = await api()
        .get('/api/budgets/non-existent-id')
        .set('Authorization', `Bearer ${adminToken}`)
      expect(res.status).toBe(404)
    })
  })

  // --------------------------------------------------------------------------
  // PATCH /api/budgets/:id
  // --------------------------------------------------------------------------
  describe('PATCH /api/budgets/:id', () => {
    it('updates notes and validUntil', async () => {
      const budget = await prisma.budget.create({ data: { tenantId, patientId } })
      const res = await api()
        .patch(`/api/budgets/${budget.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ notes: 'updated', validUntil: '2027-06-30' })

      expect(res.status).toBe(200)
      expect(res.body.data.notes).toBe('updated')
      expect(new Date(res.body.data.validUntil).toISOString().slice(0, 10)).toBe('2027-06-30')
    })

    it('can transition DRAFT -> APPROVED', async () => {
      const budget = await prisma.budget.create({ data: { tenantId, patientId } })
      const res = await api()
        .patch(`/api/budgets/${budget.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'APPROVED' })

      expect(res.status).toBe(200)
      expect(res.body.data.status).toBe('APPROVED')
    })

    it('returns 404 for other-tenant budget', async () => {
      const budget = await prisma.budget.create({
        data: { tenantId: otherTenantId, patientId: otherPatientId },
      })
      const res = await api()
        .patch(`/api/budgets/${budget.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ notes: 'x' })
      expect(res.status).toBe(404)
    })
  })

  // --------------------------------------------------------------------------
  // DELETE /api/budgets/:id
  // --------------------------------------------------------------------------
  describe('DELETE /api/budgets/:id', () => {
    it('soft-deletes the budget (isActive=false)', async () => {
      const budget = await prisma.budget.create({ data: { tenantId, patientId } })
      const res = await api()
        .delete(`/api/budgets/${budget.id}`)
        .set('Authorization', `Bearer ${adminToken}`)

      expect(res.status).toBe(200)
      expect(res.body.data.isActive).toBe(false)

      const after = await prisma.budget.findUnique({ where: { id: budget.id } })
      expect(after?.isActive).toBe(false)
    })

    it('returns 400 if already soft-deleted', async () => {
      const budget = await prisma.budget.create({ data: { tenantId, patientId, isActive: false } })
      const res = await api()
        .delete(`/api/budgets/${budget.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
      expect(res.status).toBe(400)
    })

    it('rejects DOCTOR from deleting (only CLINIC_ADMIN+ has BUDGETS_DELETE)', async () => {
      const budget = await prisma.budget.create({ data: { tenantId, patientId } })
      const res = await api()
        .delete(`/api/budgets/${budget.id}`)
        .set('Authorization', `Bearer ${doctorToken}`)
      expect(res.status).toBe(403)
    })
  })

  // --------------------------------------------------------------------------
  // POST /api/budgets/:id/items
  // --------------------------------------------------------------------------
  describe('POST /api/budgets/:id/items', () => {
    it('adds an item, recalculates total and auto-assigns next order', async () => {
      const createRes = await api()
        .post(`/api/patients/${patientId}/budgets`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ items: [{ description: 'A', quantity: 1, unitPrice: 50 }] })
      const budgetId = createRes.body.data.id

      const addRes = await api()
        .post(`/api/budgets/${budgetId}/items`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ description: 'B', quantity: 3, unitPrice: 20 })

      expect(addRes.status).toBe(201)
      expect(addRes.body.data.items).toHaveLength(2)
      expect(Number(addRes.body.data.totalAmount)).toBe(110) // 50 + 3*20
      const addedItem = addRes.body.data.items.find((i: { description: string }) => i.description === 'B')
      expect(addedItem.order).toBe(1)
      expect(Number(addedItem.totalPrice)).toBe(60)
    })

    it('returns 404 for a budget from another tenant', async () => {
      const other = await prisma.budget.create({
        data: { tenantId: otherTenantId, patientId: otherPatientId },
      })
      const res = await api()
        .post(`/api/budgets/${other.id}/items`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ description: 'X', quantity: 1, unitPrice: 10 })
      expect(res.status).toBe(404)
    })
  })

  // --------------------------------------------------------------------------
  // PATCH /api/budgets/:id/items/:itemId
  // --------------------------------------------------------------------------
  describe('PATCH /api/budgets/:id/items/:itemId', () => {
    async function createBudgetWithTwoItems() {
      const res = await api()
        .post(`/api/patients/${patientId}/budgets`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          status: 'APPROVED',
          items: [
            { description: 'A', quantity: 1, unitPrice: 100 },
            { description: 'B', quantity: 1, unitPrice: 100 },
          ],
        })
      return res.body.data as {
        id: string
        items: { id: string; description: string }[]
      }
    }

    it('recalculates item totalPrice and budget totalAmount when quantity changes', async () => {
      const budget = await createBudgetWithTwoItems()
      const itemA = budget.items.find((i) => i.description === 'A')!

      const res = await api()
        .patch(`/api/budgets/${budget.id}/items/${itemA.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ quantity: 4 })

      expect(res.status).toBe(200)
      const updatedItem = res.body.data.items.find(
        (i: { id: string }) => i.id === itemA.id
      )
      expect(Number(updatedItem.totalPrice)).toBe(400)
      expect(Number(res.body.data.totalAmount)).toBe(500) // 400 + 100
    })

    it('transitions APPROVED -> PARTIAL when one item becomes EXECUTED', async () => {
      const budget = await createBudgetWithTwoItems()
      const itemA = budget.items.find((i) => i.description === 'A')!

      const res = await api()
        .patch(`/api/budgets/${budget.id}/items/${itemA.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'EXECUTED' })

      expect(res.status).toBe(200)
      expect(res.body.data.status).toBe('PARTIAL')
    })

    it('transitions APPROVED -> COMPLETED when all items are EXECUTED', async () => {
      const budget = await createBudgetWithTwoItems()

      for (const item of budget.items) {
        await api()
          .patch(`/api/budgets/${budget.id}/items/${item.id}`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ status: 'EXECUTED' })
      }

      const res = await api()
        .get(`/api/budgets/${budget.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
      expect(res.body.data.status).toBe('COMPLETED')
    })

    it('reverts PARTIAL -> APPROVED when the executed item goes back to PENDING', async () => {
      const budget = await createBudgetWithTwoItems()
      const itemA = budget.items.find((i) => i.description === 'A')!

      await api()
        .patch(`/api/budgets/${budget.id}/items/${itemA.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'EXECUTED' })

      const res = await api()
        .patch(`/api/budgets/${budget.id}/items/${itemA.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'PENDING' })

      expect(res.body.data.status).toBe('APPROVED')
    })

    it('does not auto-transition DRAFT budgets', async () => {
      const created = await api()
        .post(`/api/patients/${patientId}/budgets`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          items: [{ description: 'A', quantity: 1, unitPrice: 100 }],
        })
      expect(created.body.data.status).toBe('DRAFT')

      const itemA = created.body.data.items[0]
      const res = await api()
        .patch(`/api/budgets/${created.body.data.id}/items/${itemA.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'EXECUTED' })

      expect(res.body.data.status).toBe('DRAFT')
    })

    it('does not change CANCELLED budget status', async () => {
      const budget = await prisma.budget.create({
        data: {
          tenantId,
          patientId,
          status: 'CANCELLED',
          items: {
            create: [{ description: 'A', quantity: 1, unitPrice: 100, totalPrice: 100 }],
          },
        },
        include: { items: true },
      })

      const res = await api()
        .patch(`/api/budgets/${budget.id}/items/${budget.items[0].id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'EXECUTED' })

      expect(res.body.data.status).toBe('CANCELLED')
    })

    it('returns 404 for a non-existent item', async () => {
      const budget = await createBudgetWithTwoItems()
      const res = await api()
        .patch(`/api/budgets/${budget.id}/items/non-existent-item`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ quantity: 2 })

      expect(res.status).toBe(404)
    })
  })

  // --------------------------------------------------------------------------
  // DELETE /api/budgets/:id/items/:itemId
  // --------------------------------------------------------------------------
  describe('DELETE /api/budgets/:id/items/:itemId', () => {
    it('removes the item and recalculates totalAmount', async () => {
      const created = await api()
        .post(`/api/patients/${patientId}/budgets`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          items: [
            { description: 'A', quantity: 1, unitPrice: 100 },
            { description: 'B', quantity: 1, unitPrice: 50 },
          ],
        })
      const itemB = created.body.data.items.find(
        (i: { description: string }) => i.description === 'B'
      )

      const res = await api()
        .delete(`/api/budgets/${created.body.data.id}/items/${itemB.id}`)
        .set('Authorization', `Bearer ${adminToken}`)

      expect(res.status).toBe(200)
      expect(res.body.data.items).toHaveLength(1)
      expect(Number(res.body.data.totalAmount)).toBe(100)
    })

    it('returns 404 when item does not belong to the budget', async () => {
      const created = await api()
        .post(`/api/patients/${patientId}/budgets`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ items: [{ description: 'A', quantity: 1, unitPrice: 10 }] })

      const res = await api()
        .delete(`/api/budgets/${created.body.data.id}/items/not-there`)
        .set('Authorization', `Bearer ${adminToken}`)
      expect(res.status).toBe(404)
    })
  })

  // --------------------------------------------------------------------------
  // GET /api/budgets/:id/pdf
  // --------------------------------------------------------------------------
  describe('GET /api/budgets/:id/pdf', () => {
    it('returns a PDF buffer with the correct headers', async () => {
      const budget = await prisma.budget.create({
        data: {
          tenantId,
          patientId,
          items: {
            create: [{ description: 'Cleaning', quantity: 1, unitPrice: 80, totalPrice: 80 }],
          },
        },
      })

      const res = await api()
        .get(`/api/budgets/${budget.id}/pdf`)
        .set('Authorization', `Bearer ${adminToken}`)

      expect(res.status).toBe(200)
      expect(res.headers['content-type']).toBe('application/pdf')
      expect(res.headers['content-disposition']).toBe(
        `attachment; filename="budget-${budget.id}.pdf"`
      )
      const body = res.body as Buffer
      expect(Buffer.isBuffer(body)).toBe(true)
      expect(body.toString('utf8', 0, 5)).toBe('%PDF-')
    })

    it('allows STAFF (view-only) to download the PDF', async () => {
      const budget = await prisma.budget.create({ data: { tenantId, patientId } })
      const res = await api()
        .get(`/api/budgets/${budget.id}/pdf`)
        .set('Authorization', `Bearer ${staffToken}`)
      expect(res.status).toBe(200)
    })

    it('returns 401 without a token', async () => {
      const budget = await prisma.budget.create({ data: { tenantId, patientId } })
      const res = await api().get(`/api/budgets/${budget.id}/pdf`)
      expect(res.status).toBe(401)
    })

    it('returns 404 for a budget from another tenant', async () => {
      const other = await prisma.budget.create({
        data: { tenantId: otherTenantId, patientId: otherPatientId },
      })
      const res = await api()
        .get(`/api/budgets/${other.id}/pdf`)
        .set('Authorization', `Bearer ${adminToken}`)
      expect(res.status).toBe(404)
    })

    it('returns 404 for a non-existent budget id', async () => {
      const res = await api()
        .get('/api/budgets/non-existent-id/pdf')
        .set('Authorization', `Bearer ${adminToken}`)
      expect(res.status).toBe(404)
    })
  })

  // --------------------------------------------------------------------------
  // POST /api/budgets/:id/share
  // --------------------------------------------------------------------------
  describe('POST /api/budgets/:id/share', () => {
    it('generates a share link and returns token/url/expiresAt', async () => {
      const budget = await prisma.budget.create({ data: { tenantId, patientId } })

      const res = await api()
        .post(`/api/budgets/${budget.id}/share`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({})

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data.token).toMatch(/^[0-9a-f]{64}$/)
      expect(res.body.data.expiresAt).toBeNull()
      expect(res.body.data.url).toBe(`${process.env.PUBLIC_WEB_URL || 'http://localhost:5003'}/budget/${res.body.data.token}`)
    })

    it('accepts an optional expiresInDays and returns a non-null expiresAt', async () => {
      const budget = await prisma.budget.create({ data: { tenantId, patientId } })

      const res = await api()
        .post(`/api/budgets/${budget.id}/share`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ expiresInDays: 14 })

      expect(res.status).toBe(200)
      expect(res.body.data.expiresAt).not.toBeNull()
    })

    it('rejects STAFF (viewer) role with 403', async () => {
      const budget = await prisma.budget.create({ data: { tenantId, patientId } })
      const res = await api()
        .post(`/api/budgets/${budget.id}/share`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({})
      expect(res.status).toBe(403)
    })

    it('rejects DOCTOR role with 403 (no BUDGETS_SHARE permission)', async () => {
      const budget = await prisma.budget.create({ data: { tenantId, patientId } })
      const res = await api()
        .post(`/api/budgets/${budget.id}/share`)
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({})
      expect(res.status).toBe(403)
    })

    it('returns 400 when expiresInDays is out of range', async () => {
      const budget = await prisma.budget.create({ data: { tenantId, patientId } })
      const res = await api()
        .post(`/api/budgets/${budget.id}/share`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ expiresInDays: 0 })
      expect(res.status).toBe(400)
    })

    it('returns 404 for a budget from another tenant', async () => {
      const other = await prisma.budget.create({
        data: { tenantId: otherTenantId, patientId: otherPatientId },
      })
      const res = await api()
        .post(`/api/budgets/${other.id}/share`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({})
      expect(res.status).toBe(404)
    })

    it('the generated public URL resolves via the unauthenticated public endpoint', async () => {
      const budget = await prisma.budget.create({
        data: {
          tenantId,
          patientId,
          items: { create: [{ description: 'X', quantity: 1, unitPrice: 10, totalPrice: 10 }] },
        },
      })
      const shareRes = await api()
        .post(`/api/budgets/${budget.id}/share`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({})

      const publicRes = await api().get(`/api/public/budgets/${shareRes.body.data.token}`)
      expect(publicRes.status).toBe(200)
      expect(publicRes.body.data.id).toBe(budget.id)
    })
  })

  // --------------------------------------------------------------------------
  // Auth
  // --------------------------------------------------------------------------
  describe('Auth', () => {
    it('returns 401 without a token', async () => {
      const res = await api().get(`/api/patients/${patientId}/budgets`)
      expect(res.status).toBe(401)
    })

    it('does not allow using another tenant admin to access a budget', async () => {
      const budget = await prisma.budget.create({ data: { tenantId, patientId } })
      const res = await api()
        .get(`/api/budgets/${budget.id}`)
        .set('Authorization', `Bearer ${otherAdminToken}`)
      expect(res.status).toBe(404)
    })
  })
})
