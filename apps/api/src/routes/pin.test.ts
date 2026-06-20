import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { app } from '../app.js'
import { prisma } from '@dental/database'
import { hashPassword } from '../services/auth.service.js'
import { sign } from 'jsonwebtoken'

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret'

describe('PIN Authentication Routes', () => {
  let tenantId: string
  let adminUserId: string
  let staffUserId: string
  let adminToken: string
  let staffToken: string
  const testSlug = `test-pin-${Date.now()}`

  function generateToken(userId: string, tenantId: string, role: string) {
    return sign({ userId, tenantId, email: 'test@test.com', role }, JWT_SECRET, { expiresIn: '1h' })
  }

  beforeAll(async () => {
    const tenant = await prisma.tenant.create({
      data: {
        name: 'Test Clinic for PIN',
        slug: testSlug,
        currency: 'USD',
        timezone: 'America/New_York',
      },
    })
    tenantId = tenant.id

    const hashedPassword = await hashPassword('Password123!')

    const adminUser = await prisma.user.create({
      data: {
        tenantId,
        email: 'admin@pin-test.com',
        firstName: 'Admin',
        lastName: 'User',
        passwordHash: hashedPassword,
        role: 'ADMIN',
      },
    })
    adminUserId = adminUser.id
    adminToken = generateToken(adminUser.id, tenantId, 'ADMIN')

    const staffUser = await prisma.user.create({
      data: {
        tenantId,
        email: 'staff@pin-test.com',
        firstName: 'Staff',
        lastName: 'User',
        passwordHash: hashedPassword,
        role: 'STAFF',
      },
    })
    staffUserId = staffUser.id
    staffToken = generateToken(staffUser.id, tenantId, 'STAFF')
  })

  afterAll(async () => {
    await prisma.refreshToken.deleteMany({ where: { userId: { in: [adminUserId, staffUserId] } } })
    await prisma.user.deleteMany({ where: { tenantId } })
    await prisma.tenantSettings.deleteMany({ where: { tenantId } })
    await prisma.tenant.delete({ where: { id: tenantId } })
  })

  // ==========================================
  // GET /api/auth/profiles (requires JWT)
  // ==========================================

  describe('GET /api/auth/profiles', () => {
    it('should return profiles when authenticated', async () => {
      const res = await request(app)
        .get('/api/auth/profiles')
        .set('Authorization', `Bearer ${adminToken}`)

      expect(res.status).toBe(200)
      expect(res.body).toBeInstanceOf(Array)
      expect(res.body.length).toBe(2)
      expect(res.body[0]).toHaveProperty('id')
      expect(res.body[0]).toHaveProperty('firstName')
      expect(res.body[0]).toHaveProperty('lastName')
      expect(res.body[0]).toHaveProperty('role')
      expect(res.body[0]).toHaveProperty('hasPinSet')
      expect(res.body[0]).not.toHaveProperty('email')
      expect(res.body[0]).not.toHaveProperty('pinHash')
    })

    it('should return 401 without JWT', async () => {
      const res = await request(app).get('/api/auth/profiles')

      expect(res.status).toBe(401)
    })

    it('should exclude inactive users', async () => {
      const inactiveUser = await prisma.user.create({
        data: {
          tenantId,
          email: 'inactive@pin-test.com',
          firstName: 'Inactive',
          lastName: 'User',
          passwordHash: await hashPassword('Password123!'),
          role: 'STAFF',
          isActive: false,
        },
      })

      const res = await request(app)
        .get('/api/auth/profiles')
        .set('Authorization', `Bearer ${adminToken}`)

      expect(res.status).toBe(200)
      const ids = res.body.map((p: any) => p.id)
      expect(ids).not.toContain(inactiveUser.id)

      await prisma.user.delete({ where: { id: inactiveUser.id } })
    })
  })

  // ==========================================
  // PUT /api/users/:id/pin
  // ==========================================

  describe('PUT /api/users/:id/pin', () => {
    it('should allow user to set their own PIN', async () => {
      const res = await request(app)
        .put(`/api/users/${staffUserId}/pin`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ pin: '1234' })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
    })

    it('should allow ADMIN to set PIN for another user', async () => {
      const res = await request(app)
        .put(`/api/users/${staffUserId}/pin`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ pin: '5678' })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
    })

    it('should reject non-ADMIN setting PIN for another user', async () => {
      const res = await request(app)
        .put(`/api/users/${adminUserId}/pin`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ pin: '1234' })

      expect(res.status).toBe(403)
    })

    it('should reject invalid PIN format', async () => {
      const res = await request(app)
        .put(`/api/users/${staffUserId}/pin`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ pin: '12' })

      expect(res.status).toBe(400)
    })

    it('should reject non-numeric PIN', async () => {
      const res = await request(app)
        .put(`/api/users/${staffUserId}/pin`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ pin: 'abcd' })

      expect(res.status).toBe(400)
    })
  })

  // ==========================================
  // POST /api/auth/pin-login (requires JWT)
  // ==========================================

  describe('POST /api/auth/pin-login', () => {
    beforeAll(async () => {
      // Ensure admin has a PIN set
      const pinHash = await hashPassword('9999')
      await prisma.user.update({
        where: { id: adminUserId },
        data: { pinHash },
      })
    })

    it('should return profileToken with correct PIN', async () => {
      const res = await request(app)
        .post('/api/auth/pin-login')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ userId: adminUserId, pin: '9999' })

      expect(res.status).toBe(200)
      expect(res.body).toHaveProperty('profileToken')
      expect(res.body).not.toHaveProperty('accessToken')
      expect(res.body).not.toHaveProperty('refreshToken')
      expect(res.body.user).toHaveProperty('id', adminUserId)
      expect(res.body.user).toHaveProperty('hasPinSet', true)
      expect(res.body.user).not.toHaveProperty('pinHash')
    })

    it('should reject incorrect PIN', async () => {
      const res = await request(app)
        .post('/api/auth/pin-login')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ userId: adminUserId, pin: '0000' })

      expect(res.status).toBe(401)
      expect(res.body.error.code).toBe('INVALID_CREDENTIALS')
    })

    it('should return PIN_NOT_SET when user has no PIN', async () => {
      // Remove staff PIN
      await prisma.user.update({
        where: { id: staffUserId },
        data: { pinHash: null },
      })

      const res = await request(app)
        .post('/api/auth/pin-login')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ userId: staffUserId, pin: '1234' })

      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('PIN_NOT_SET')
    })

    it('should reject unknown user', async () => {
      const res = await request(app)
        .post('/api/auth/pin-login')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ userId: 'nonexistent-user', pin: '1234' })

      expect(res.status).toBe(401)
      expect(res.body.error.code).toBe('INVALID_CREDENTIALS')
    })

    it('should return 401 without JWT', async () => {
      const res = await request(app)
        .post('/api/auth/pin-login')
        .send({ userId: adminUserId, pin: '9999' })

      expect(res.status).toBe(401)
    })

    it('should reject invalid PIN format', async () => {
      const res = await request(app)
        .post('/api/auth/pin-login')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ userId: adminUserId, pin: '12' })

      expect(res.status).toBe(400)
    })
  })

  // ==========================================
  // POST /api/auth/setup-pin (requires JWT)
  // ==========================================

  describe('POST /api/auth/setup-pin', () => {
    it('should set PIN and return profileToken when no PIN exists', async () => {
      // Ensure staff has no PIN
      await prisma.user.update({
        where: { id: staffUserId },
        data: { pinHash: null },
      })

      const res = await request(app)
        .post('/api/auth/setup-pin')
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ userId: staffUserId, pin: '4321' })

      expect(res.status).toBe(200)
      expect(res.body).toHaveProperty('profileToken')
      expect(res.body.user).toHaveProperty('id', staffUserId)
      expect(res.body.user).toHaveProperty('hasPinSet', true)
    })

    it('should reject if PIN already set', async () => {
      const res = await request(app)
        .post('/api/auth/setup-pin')
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ userId: staffUserId, pin: '1111' })

      expect(res.status).toBe(409)
      expect(res.body.error.code).toBe('PIN_ALREADY_SET')
    })

    it('should return 401 without JWT', async () => {
      const res = await request(app)
        .post('/api/auth/setup-pin')
        .send({ userId: staffUserId, pin: '1234' })

      expect(res.status).toBe(401)
    })

    it('should reject invalid PIN format', async () => {
      const res = await request(app)
        .post('/api/auth/setup-pin')
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ userId: staffUserId, pin: 'ab' })

      expect(res.status).toBe(400)
    })
  })

  // ==========================================
  // GET /api/auth/me (hasPinSet)
  // ==========================================

  describe('GET /api/auth/me (hasPinSet)', () => {
    it('should include hasPinSet in response', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${adminToken}`)

      expect(res.status).toBe(200)
      expect(res.body).toHaveProperty('hasPinSet')
    })

    it('should not include pinHash in response', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${adminToken}`)

      expect(res.status).toBe(200)
      expect(res.body).not.toHaveProperty('pinHash')
    })
  })

  // ==========================================
  // Profile token in middleware
  // ==========================================

  describe('X-Profile-Token middleware', () => {
    it('should override role when valid profile token is sent', async () => {
      // First get a profile token by PIN login
      const loginRes = await request(app)
        .post('/api/auth/pin-login')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ userId: adminUserId, pin: '9999' })

      expect(loginRes.status).toBe(200)
      const { profileToken } = loginRes.body

      // Use profile token on an endpoint that uses requireAuth
      const res = await request(app)
        .get('/api/auth/profiles')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Profile-Token', profileToken)

      expect(res.status).toBe(200)
      expect(res.body).toBeInstanceOf(Array)
    })

    it('should return 403 with expired/invalid profile token', async () => {
      const invalidToken = sign(
        { profileUserId: adminUserId, role: 'ADMIN', tenantId, type: 'profile' },
        JWT_SECRET,
        { expiresIn: '1s' }
      )

      // Wait for token to expire
      await new Promise((r) => setTimeout(r, 1500))

      const res = await request(app)
        .get('/api/auth/profiles')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Profile-Token', invalidToken)

      expect(res.status).toBe(403)
      expect(res.body.error.code).toBe('PROFILE_TOKEN_EXPIRED')
    })
  })
})
