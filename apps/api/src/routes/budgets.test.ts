import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { api } from '../test/http.js'
import { prisma } from '@dental/database'
import { hashPassword } from '../services/auth.service.js'
import { generateToken, generateProfileToken } from '../test/tokens.js'


describe('Budgets routes', () => {
  let tenantId: string
  let otherTenantId: string
  let adminUserId: string
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
    adminUserId = adminUser.id
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

    // Task #468: createdById must record the real actor. It is not exposed
    // on the API response (see safe-select shapes in budget.service.ts), so
    // these read the row directly from Prisma.
    describe('Task #468: the budget records the real actor', () => {
      it('records createdById as the authenticated user, not null', async () => {
        const res = await api()
          .post(`/api/patients/${patientId}/budgets`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send(validBody)

        expect(res.status).toBe(201)
        const row = await prisma.budget.findUniqueOrThrow({ where: { id: res.body.data.id } })
        expect(row.createdById).toBe(adminUserId)
      })

      it('records createdById as the active PIN profile, not the shared login', async () => {
        const res = await api()
          .post(`/api/patients/${patientId}/budgets`)
          .set('Authorization', `Bearer ${adminToken}`)
          .set('X-Profile-Token', generateProfileToken('profile-468-budget', tenantId, 'ADMIN'))
          .send(validBody)

        expect(res.status).toBe(201)
        const row = await prisma.budget.findUniqueOrThrow({ where: { id: res.body.data.id } })
        expect(row.createdById).toBe('profile-468-budget')
        expect(row.createdById).not.toBe(adminUserId)
      })
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
  // Task #612: every route that returns a budget carries `money`
  // One test per route, each with its own assertion, so a route that drops
  // `money` is named by the failing test and never hidden behind another.
  // --------------------------------------------------------------------------
  describe('Task #612: money on every route that returns a budget', () => {
    let doctorId: string

    // Item A (80) is executed and billed; item B (2 x 50 = 100) is not. A 30 advance
    // covers part of A. The four buckets are mutually different on purpose:
    // total 180, billed 80, covered 30, remaining 50, notBilled 100.
    const PARTIAL_MONEY = { total: 180, billed: 80, covered: 30, remaining: 50, notBilled: 100 }
    const MONEY_KEYS = ['billed', 'covered', 'notBilled', 'remaining', 'total']

    beforeAll(async () => {
      doctorId = (
        await prisma.doctor.create({
          data: {
            tenantId,
            firstName: 'Dr. Money',
            lastName: 'Route',
            email: `doctor-money-${suffix}@budgets-test.com`,
            specialty: 'General Dentistry',
          },
        })
      ).id
    })

    afterEach(async () => {
      await prisma.patientPayment.deleteMany({ where: { tenantId } })
      await prisma.appointment.deleteMany({ where: { tenantId } })
    })

    afterAll(async () => {
      await prisma.patientPayment.deleteMany({ where: { tenantId } })
      await prisma.appointment.deleteMany({ where: { tenantId } })
      await prisma.doctor.deleteMany({ where: { tenantId } })
    })

    async function seedPartiallyCoveredBudget() {
      const budget = await prisma.budget.create({
        data: {
          tenantId,
          patientId,
          status: 'APPROVED',
          totalAmount: 180,
          items: {
            create: [
              { description: 'A', quantity: 1, unitPrice: 80, totalPrice: 80, order: 0 },
              { description: 'B', quantity: 2, unitPrice: 50, totalPrice: 100, order: 1 },
            ],
          },
        },
        include: { items: { orderBy: { order: 'asc' } } },
      })
      const start = new Date('2026-01-10T10:00:00Z')
      const appointment = await prisma.appointment.create({
        data: {
          tenantId,
          patientId,
          doctorId,
          startTime: start,
          endTime: new Date(start.getTime() + 30 * 60_000),
          duration: 30,
          cost: null,
        },
      })
      await prisma.budgetItemAppointment.create({
        data: { budgetItemId: budget.items[0].id, appointmentId: appointment.id, role: 'EXECUTED' },
      })
      await prisma.patientPayment.create({
        data: { tenantId, patientId, amount: 30, date: new Date('2026-01-05T10:00:00Z'), kind: 'ADVANCE' },
      })
      return budget
    }

    it('GET /api/budgets/:id carries money', async () => {
      const budget = await seedPartiallyCoveredBudget()
      const res = await api()
        .get(`/api/budgets/${budget.id}`)
        .set('Authorization', `Bearer ${staffToken}`)
      expect(res.body.data.money).toEqual(PARTIAL_MONEY)
    })

    it('GET /api/patients/:id/budgets carries money on each entry', async () => {
      const budget = await seedPartiallyCoveredBudget()
      const res = await api()
        .get(`/api/patients/${patientId}/budgets`)
        .set('Authorization', `Bearer ${staffToken}`)
      const entry = res.body.data.find((b: { id: string }) => b.id === budget.id)
      expect(entry.money).toEqual(PARTIAL_MONEY)
    })

    it('PATCH /api/budgets/:id carries money', async () => {
      const budget = await seedPartiallyCoveredBudget()
      const res = await api()
        .patch(`/api/budgets/${budget.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ notes: 'touched' })
      expect(res.status).toBe(200)
      expect(res.body.data.money).toEqual(PARTIAL_MONEY)
    })

    it('POST /api/budgets/:id/items carries money, with the new item moving total and notBilled', async () => {
      const budget = await seedPartiallyCoveredBudget()
      const res = await api()
        .post(`/api/budgets/${budget.id}/items`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ description: 'C', quantity: 1, unitPrice: 20 })
      expect(res.status).toBe(201)
      expect(res.body.data.money).toEqual({ total: 200, billed: 80, covered: 30, remaining: 50, notBilled: 120 })
    })

    it('PATCH /api/budgets/:id/items/:itemId carries money, with the edited price moving total and notBilled', async () => {
      const budget = await seedPartiallyCoveredBudget()
      const res = await api()
        .patch(`/api/budgets/${budget.id}/items/${budget.items[1].id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ unitPrice: 30 })
      expect(res.status).toBe(200)
      expect(res.body.data.money).toEqual({ total: 140, billed: 80, covered: 30, remaining: 50, notBilled: 60 })
    })

    it('DELETE /api/budgets/:id/items/:itemId carries money, with the removed item moving total and notBilled', async () => {
      const budget = await seedPartiallyCoveredBudget()
      const res = await api()
        .delete(`/api/budgets/${budget.id}/items/${budget.items[1].id}`)
        .set('Authorization', `Bearer ${adminToken}`)
      expect(res.status).toBe(200)
      expect(res.body.data.money).toEqual({ total: 80, billed: 80, covered: 30, remaining: 50, notBilled: 0 })
    })

    it('DELETE /api/budgets/:id carries money (full shape, total as stored)', async () => {
      const budget = await seedPartiallyCoveredBudget()
      const res = await api()
        .delete(`/api/budgets/${budget.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
      expect(res.status).toBe(200)
      expect(Object.keys(res.body.data.money ?? {}).sort()).toEqual(MONEY_KEYS)
      expect(res.body.data.money?.total).toBe(180)
    })

    it('POST /api/patients/:id/budgets carries money (nothing billed yet: whole total is notBilled)', async () => {
      const res = await api()
        .post(`/api/patients/${patientId}/budgets`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          items: [
            { description: 'Cleaning', quantity: 1, unitPrice: 80 },
            { description: 'Filling 16', toothNumber: '16', quantity: 2, unitPrice: 50 },
          ],
        })
      expect(res.status).toBe(201)
      expect(res.body.data.money).toEqual({ total: 180, billed: 0, covered: 0, remaining: 0, notBilled: 180 })
    })
  })

  describe('Task #613: visits (payments table rows) on every route that returns ONE budget', () => {
    let doctorId: string
    let firstApptId: string
    let secondApptId: string

    // Two executed visits of different amounts on different dates; the 30 advance
    // covers part of the first. Line B (2 x 50 = 100) is executed on the 2nd visit.
    const EXPECTED_VISITS = (descriptionOfFirst = 'A') => [
      {
        appointmentId: expect.any(String),
        date: '2026-01-10T10:00:00.000Z',
        lines: [{ budgetItemId: expect.any(String), description: descriptionOfFirst, notes: 'LINK-A' }],
        charged: 80,
        covered: 30,
      },
      {
        appointmentId: expect.any(String),
        date: '2026-02-20T10:00:00.000Z',
        lines: [{ budgetItemId: expect.any(String), description: 'B', notes: 'LINK-B' }],
        charged: 100,
        covered: 0,
      },
    ]

    beforeAll(async () => {
      doctorId = (
        await prisma.doctor.create({
          data: {
            tenantId,
            firstName: 'Dr. Visits',
            lastName: 'Route',
            email: `doctor-visits-${suffix}@budgets-test.com`,
            specialty: 'General Dentistry',
          },
        })
      ).id
    })

    afterEach(async () => {
      await prisma.patientPayment.deleteMany({ where: { tenantId } })
      await prisma.appointment.deleteMany({ where: { tenantId } })
    })

    afterAll(async () => {
      await prisma.patientPayment.deleteMany({ where: { tenantId } })
      await prisma.appointment.deleteMany({ where: { tenantId } })
      await prisma.doctor.deleteMany({ where: { tenantId } })
    })

    async function seedTwoVisitBudget() {
      const budget = await prisma.budget.create({
        data: {
          tenantId,
          patientId,
          status: 'APPROVED',
          totalAmount: 180,
          items: {
            create: [
              { description: 'A', quantity: 1, unitPrice: 80, totalPrice: 80, order: 0, notes: 'ITEM-A' },
              { description: 'B', quantity: 2, unitPrice: 50, totalPrice: 100, order: 1, notes: 'ITEM-B' },
            ],
          },
        },
        include: { items: { orderBy: { order: 'asc' } } },
      })
      const mk = (iso: string) => {
        const start = new Date(iso)
        return prisma.appointment.create({
          data: {
            tenantId,
            patientId,
            doctorId,
            startTime: start,
            endTime: new Date(start.getTime() + 30 * 60_000),
            duration: 30,
            cost: null,
          },
        })
      }
      const first = await mk('2026-01-10T10:00:00Z')
      const second = await mk('2026-02-20T10:00:00Z')
      firstApptId = first.id
      secondApptId = second.id
      await prisma.budgetItemAppointment.create({
        data: { budgetItemId: budget.items[0].id, appointmentId: first.id, role: 'EXECUTED', notes: 'LINK-A' },
      })
      await prisma.budgetItemAppointment.create({
        data: { budgetItemId: budget.items[1].id, appointmentId: second.id, role: 'EXECUTED', notes: 'LINK-B' },
      })
      await prisma.patientPayment.create({
        data: { tenantId, patientId, amount: 30, date: new Date('2026-01-05T10:00:00Z'), kind: 'ADVANCE' },
      })
      return budget
    }

    it('GET /api/budgets/:id carries visits', async () => {
      const budget = await seedTwoVisitBudget()
      const res = await api()
        .get(`/api/budgets/${budget.id}`)
        .set('Authorization', `Bearer ${staffToken}`)
      expect(res.status).toBe(200)
      expect(res.body.data.visits).toEqual(EXPECTED_VISITS())
      expect(res.body.data.visits.map((v: { appointmentId: string }) => v.appointmentId)).toEqual([
        firstApptId,
        secondApptId,
      ])
    })

    it('PATCH /api/budgets/:id carries visits', async () => {
      const budget = await seedTwoVisitBudget()
      const res = await api()
        .patch(`/api/budgets/${budget.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ notes: 'touched' })
      expect(res.status).toBe(200)
      expect(res.body.data.visits).toEqual(EXPECTED_VISITS())
    })

    it('DELETE /api/budgets/:id carries visits', async () => {
      const budget = await seedTwoVisitBudget()
      const res = await api()
        .delete(`/api/budgets/${budget.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
      expect(res.status).toBe(200)
      expect(res.body.data.visits).toBeInstanceOf(Array)
    })

    it('POST /api/budgets/:id/items carries visits', async () => {
      const budget = await seedTwoVisitBudget()
      const res = await api()
        .post(`/api/budgets/${budget.id}/items`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ description: 'C', quantity: 1, unitPrice: 20 })
      expect(res.status).toBe(201)
      expect(res.body.data.visits).toEqual(EXPECTED_VISITS())
    })

    it('PATCH /api/budgets/:id/items/:itemId carries visits', async () => {
      const budget = await seedTwoVisitBudget()
      const res = await api()
        .patch(`/api/budgets/${budget.id}/items/${budget.items[0].id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ description: 'A renamed' })
      expect(res.status).toBe(200)
      expect(res.body.data.visits).toEqual(EXPECTED_VISITS('A renamed'))
    })

    it('DELETE /api/budgets/:id/items/:itemId carries visits (the removed line leaves no row)', async () => {
      const budget = await seedTwoVisitBudget()
      const res = await api()
        .delete(`/api/budgets/${budget.id}/items/${budget.items[1].id}`)
        .set('Authorization', `Bearer ${adminToken}`)
      expect(res.status).toBe(200)
      expect(res.body.data.visits).toEqual([EXPECTED_VISITS()[0]])
    })

    it('POST /api/patients/:id/budgets carries visits (a new budget has none: an empty array, not absent)', async () => {
      const res = await api()
        .post(`/api/patients/${patientId}/budgets`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ items: [{ description: 'Cleaning', quantity: 1, unitPrice: 80 }] })
      expect(res.status).toBe(201)
      expect(res.body.data.visits).toEqual([])
    })

    it('GET /api/patients/:id/budgets does NOT carry visits on its entries', async () => {
      const budget = await seedTwoVisitBudget()
      const res = await api()
        .get(`/api/patients/${patientId}/budgets`)
        .set('Authorization', `Bearer ${staffToken}`)
      const entry = res.body.data.find((b: { id: string }) => b.id === budget.id)
      expect(entry).toBeDefined()
      expect(entry).not.toHaveProperty('visits')
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
