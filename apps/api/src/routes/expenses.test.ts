import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { api } from '../test/http.js'
import { prisma } from '@dental/database'
import { hashPassword } from '../services/auth.service.js'
import { sign } from 'jsonwebtoken'

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret'

describe('Expenses Routes - Permission Tests', () => {
  let tenantId: string
  let adminToken: string
  let staffToken: string
  let testExpenseId: string
  const testSlug = `test-expenses-${Date.now()}`

  // Helper to generate JWT token
  function generateToken(userId: string, tenantId: string, role: string) {
    return sign(
      { sub: userId, tenantId, role },
      JWT_SECRET,
      { expiresIn: '1h' }
    )
  }

  beforeAll(async () => {
    // Create test tenant
    const tenant = await prisma.tenant.create({
      data: {
        name: 'Test Clinic for Expenses',
        slug: testSlug,
        currency: 'USD',
        timezone: 'America/New_York',
      },
    })
    tenantId = tenant.id

    // Get or create free plan
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

    // Create subscription
    await prisma.subscription.create({
      data: {
        tenantId: tenant.id,
        planId: freePlan.id,
        status: 'ACTIVE',
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    })

    // Create ADMIN user
    const hashedPassword = await hashPassword('password123')
    const adminUser = await prisma.user.create({
      data: {
        tenantId,
        email: 'admin@expenses-test.com',
        firstName: 'Admin',
        lastName: 'User',
        passwordHash: hashedPassword,
        role: 'ADMIN',
      },
    })
    adminToken = generateToken(adminUser.id, tenantId, 'ADMIN')

    // Create STAFF user
    const staffUser = await prisma.user.create({
      data: {
        tenantId,
        email: 'staff@expenses-test.com',
        firstName: 'Staff',
        lastName: 'User',
        passwordHash: hashedPassword,
        role: 'STAFF',
      },
    })
    staffToken = generateToken(staffUser.id, tenantId, 'STAFF')

    // Create an expense as ADMIN for testing
    const expenseData = {
      note: 'Test Expense',
      amount: 150.00,
      issuer: 'Test Supplier',
      date: new Date().toISOString(),
    }

    const response = await api()
      .post('/api/expenses')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(expenseData)

    testExpenseId = response.body.data?.id
  })

  afterAll(async () => {
    // Clean up test data
    await prisma.expense.deleteMany({ where: { tenantId } })
    await prisma.user.deleteMany({ where: { tenantId } })
    await prisma.subscription.deleteMany({ where: { tenantId } })
    await prisma.tenant.delete({ where: { id: tenantId } })
  })

  describe('POST /api/expenses (Create)', () => {
    it('should allow ADMIN to create expense', async () => {
      const expenseData = {
        note: 'Office supplies',
        amount: 250.50,
        issuer: 'Office Supplier',
        date: new Date().toISOString(),
      }

      const response = await api()
        .post('/api/expenses')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(expenseData)

      expect(response.status).toBe(201)
      expect(response.body.data).toHaveProperty('id')
      expect(response.body.data.note).toBe(expenseData.note)
      expect(Number(response.body.data.amount)).toBe(expenseData.amount)
    })

    it('should deny STAFF from creating expense', async () => {
      const expenseData = {
        note: 'Unauthorized expense',
        amount: 100.00,
        issuer: 'Test',
        date: new Date().toISOString(),
      }

      const response = await api()
        .post('/api/expenses')
        .set('Authorization', `Bearer ${staffToken}`)
        .send(expenseData)

      expect(response.status).toBe(403)
      expect(response.body).toHaveProperty('error')
    })
  })

  describe('PUT /api/expenses/:id (Update)', () => {
    it('should allow ADMIN to update expense', async () => {
      const updateData = {
        amount: 175.00,
        note: 'Updated expense note',
      }

      const response = await api()
        .put(`/api/expenses/${testExpenseId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send(updateData)

      expect(response.status).toBe(200)
      expect(Number(response.body.data.amount)).toBe(175.00)
      expect(response.body.data.note).toBe(updateData.note)
    })

    it('should deny STAFF from updating expense', async () => {
      const updateData = {
        amount: 200.00,
      }

      const response = await api()
        .put(`/api/expenses/${testExpenseId}`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send(updateData)

      expect(response.status).toBe(403)
      expect(response.body).toHaveProperty('error')
    })
  })

  describe('DELETE /api/expenses/:id (Delete)', () => {
    it('should deny STAFF from deleting expense', async () => {
      const response = await api()
        .delete(`/api/expenses/${testExpenseId}`)
        .set('Authorization', `Bearer ${staffToken}`)

      expect(response.status).toBe(403)
      expect(response.body).toHaveProperty('error')
    })

    it('should allow ADMIN to delete expense', async () => {
      // Create a new expense to delete
      const expenseData = {
        note: 'Expense to delete',
        amount: 50.00,
        issuer: 'Test',
        date: new Date().toISOString(),
      }

      const createResponse = await api()
        .post('/api/expenses')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(expenseData)

      const expenseId = createResponse.body.data.id

      const deleteResponse = await api()
        .delete(`/api/expenses/${expenseId}`)
        .set('Authorization', `Bearer ${adminToken}`)

      expect(deleteResponse.status).toBe(200)
    })
  })

  describe('GET /api/expenses (View)', () => {
    it('should allow STAFF to view expenses', async () => {
      const response = await api()
        .get('/api/expenses')
        .set('Authorization', `Bearer ${staffToken}`)

      expect(response.status).toBe(200)
      expect(Array.isArray(response.body.data)).toBe(true)
    })

    it('should allow ADMIN to view expenses', async () => {
      const response = await api()
        .get('/api/expenses')
        .set('Authorization', `Bearer ${adminToken}`)

      expect(response.status).toBe(200)
      expect(Array.isArray(response.body.data)).toBe(true)
    })
  })
})
