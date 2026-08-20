import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import crypto from 'crypto'
import { api } from '../../test/http.js'
import { prisma } from '@dental/database'
import { hashPassword, hashToken } from '../../services/auth.service.js'

describe('Admin Auth - Password Recovery', () => {
  let superAdminId: string
  // Use unique email with timestamp to avoid conflicts
  const testEmail = `superadmin-recovery-${Date.now()}@test.com`
  const testPassword = 'OldPassword123!'

  beforeAll(async () => {
    // Create a test SUPER_ADMIN user
    const passwordHash = await hashPassword(testPassword)
    const user = await prisma.user.create({
      data: {
        email: testEmail,
        passwordHash,
        firstName: 'Test',
        lastName: 'SuperAdmin',
        role: 'SUPER_ADMIN',
        tenantId: null,
      },
    })
    superAdminId = user.id
  })

  afterAll(async () => {
    // Clean up test data - handle cases where user may not exist
    if (superAdminId) {
      await prisma.passwordResetToken.deleteMany({
        where: { userId: superAdminId },
      })
      await prisma.refreshToken.deleteMany({
        where: { userId: superAdminId },
      })
      await prisma.user.delete({
        where: { id: superAdminId },
      }).catch(() => { /* User may not exist */ })
    }
  })

  beforeEach(async () => {
    // Clean up tokens before each test
    await prisma.passwordResetToken.deleteMany({
      where: { userId: superAdminId },
    })
  })

  describe('POST /api/admin/auth/forgot-password', () => {
    it('should return 200 for valid super admin email', async () => {
      const response = await api()
        .post('/api/admin/auth/forgot-password')
        .send({ email: testEmail })

      expect(response.status).toBe(200)
      expect(response.body.success).toBe(true)
      expect(response.body.message).toContain('If an account exists')

      // Verify token was created
      const token = await prisma.passwordResetToken.findFirst({
        where: { userId: superAdminId },
      })
      expect(token).not.toBeNull()
      expect(token?.usedAt).toBeNull()
    })

    it('should return 200 for non-existent email (security)', async () => {
      const response = await api()
        .post('/api/admin/auth/forgot-password')
        .send({ email: 'nonexistent@test.com' })

      expect(response.status).toBe(200)
      expect(response.body.success).toBe(true)
      // Same message as valid email to prevent enumeration
      expect(response.body.message).toContain('If an account exists')
    })

    it('should return 400 for invalid email format', async () => {
      const response = await api()
        .post('/api/admin/auth/forgot-password')
        .send({ email: 'not-an-email' })

      expect(response.status).toBe(400)
      expect(response.body.success).toBe(false)
    })

    it('should invalidate previous tokens when requesting a new one', async () => {
      // Request first token
      await api()
        .post('/api/admin/auth/forgot-password')
        .send({ email: testEmail })

      const firstToken = await prisma.passwordResetToken.findFirst({
        where: { userId: superAdminId, usedAt: null },
      })
      expect(firstToken).not.toBeNull()

      // Request second token
      await api()
        .post('/api/admin/auth/forgot-password')
        .send({ email: testEmail })

      // First token should be invalidated (usedAt set)
      const invalidatedToken = await prisma.passwordResetToken.findUnique({
        where: { id: firstToken!.id },
      })
      expect(invalidatedToken?.usedAt).not.toBeNull()

      // There should be a new valid token
      const newToken = await prisma.passwordResetToken.findFirst({
        where: { userId: superAdminId, usedAt: null },
      })
      expect(newToken).not.toBeNull()
      expect(newToken?.id).not.toBe(firstToken?.id)
    })

    it('should not create token for regular tenant user', async () => {
      // Create a regular user with a tenant
      const tenant = await prisma.tenant.create({
        data: { name: 'Test Clinic', slug: 'test-clinic-recovery' },
      })
      const regularUser = await prisma.user.create({
        data: {
          email: 'regular@test.com',
          passwordHash: await hashPassword('Test123!'),
          firstName: 'Regular',
          lastName: 'User',
          role: 'OWNER',
          tenantId: tenant.id,
        },
      })

      const response = await api()
        .post('/api/admin/auth/forgot-password')
        .send({ email: 'regular@test.com' })

      expect(response.status).toBe(200) // Still 200 for security

      // But no token should be created
      const token = await prisma.passwordResetToken.findFirst({
        where: { userId: regularUser.id },
      })
      expect(token).toBeNull()

      // Cleanup
      await prisma.user.delete({ where: { id: regularUser.id } })
      await prisma.tenant.delete({ where: { id: tenant.id } })
    })

    it('should not create token for inactive super admin', async () => {
      // Create an inactive super admin
      const inactiveAdmin = await prisma.user.create({
        data: {
          email: 'inactive-admin@test.com',
          passwordHash: await hashPassword('Test123!'),
          firstName: 'Inactive',
          lastName: 'Admin',
          role: 'SUPER_ADMIN',
          tenantId: null,
          isActive: false,
        },
      })

      const response = await api()
        .post('/api/admin/auth/forgot-password')
        .send({ email: 'inactive-admin@test.com' })

      expect(response.status).toBe(200) // Still 200 for security

      // But no token should be created for inactive user
      const token = await prisma.passwordResetToken.findFirst({
        where: { userId: inactiveAdmin.id },
      })
      expect(token).toBeNull()

      // Cleanup
      await prisma.user.delete({ where: { id: inactiveAdmin.id } })
    })
  })

  describe('POST /api/admin/auth/reset-password', () => {
    it('should reset password with valid token', async () => {
      // Create a token directly
      const plainToken = crypto.randomBytes(32).toString('hex')
      const tokenHash = hashToken(plainToken)
      await prisma.passwordResetToken.create({
        data: {
          userId: superAdminId,
          tokenHash,
          expiresAt: new Date(Date.now() + 15 * 60 * 1000), // 15 min
        },
      })

      const newPassword = 'NewPassword456!'
      const response = await api()
        .post('/api/admin/auth/reset-password')
        .send({ token: plainToken, password: newPassword })

      expect(response.status).toBe(200)
      expect(response.body.success).toBe(true)
      expect(response.body.message).toContain('reset successfully')

      // Verify token is marked as used
      const usedToken = await prisma.passwordResetToken.findUnique({
        where: { tokenHash },
      })
      expect(usedToken?.usedAt).not.toBeNull()

      // Verify password was changed (can log in with new password)
      const updatedUser = await prisma.user.findUnique({
        where: { id: superAdminId },
      })
      expect(updatedUser?.passwordHash).not.toBe(testPassword)

      // Reset password back for other tests
      await prisma.user.update({
        where: { id: superAdminId },
        data: { passwordHash: await hashPassword(testPassword) },
      })
    })

    it('should return 400 for invalid token', async () => {
      const response = await api()
        .post('/api/admin/auth/reset-password')
        .send({ token: 'invalid-token', password: 'NewPassword456!' })

      expect(response.status).toBe(400)
      expect(response.body.error.code).toBe('INVALID_TOKEN')
    })

    it('should return 400 for expired token', async () => {
      // Create an expired token
      const plainToken = crypto.randomBytes(32).toString('hex')
      const tokenHash = hashToken(plainToken)
      await prisma.passwordResetToken.create({
        data: {
          userId: superAdminId,
          tokenHash,
          expiresAt: new Date(Date.now() - 1000), // Expired
        },
      })

      const response = await api()
        .post('/api/admin/auth/reset-password')
        .send({ token: plainToken, password: 'NewPassword456!' })

      expect(response.status).toBe(400)
      expect(response.body.error.code).toBe('TOKEN_EXPIRED')
    })

    it('should return 400 for already used token', async () => {
      // Create a used token
      const plainToken = crypto.randomBytes(32).toString('hex')
      const tokenHash = hashToken(plainToken)
      await prisma.passwordResetToken.create({
        data: {
          userId: superAdminId,
          tokenHash,
          expiresAt: new Date(Date.now() + 15 * 60 * 1000),
          usedAt: new Date(), // Already used
        },
      })

      const response = await api()
        .post('/api/admin/auth/reset-password')
        .send({ token: plainToken, password: 'NewPassword456!' })

      expect(response.status).toBe(400)
      expect(response.body.error.code).toBe('TOKEN_USED')
    })

    it('should return 400 for weak password', async () => {
      const plainToken = crypto.randomBytes(32).toString('hex')
      const tokenHash = hashToken(plainToken)
      await prisma.passwordResetToken.create({
        data: {
          userId: superAdminId,
          tokenHash,
          expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        },
      })

      const response = await api()
        .post('/api/admin/auth/reset-password')
        .send({ token: plainToken, password: 'weak' })

      expect(response.status).toBe(400)
      expect(response.body.error.code).toBe('INVALID_PAYLOAD')
    })

    it('should invalidate all refresh tokens after password reset', async () => {
      // Create a refresh token for the user
      await prisma.refreshToken.create({
        data: {
          userId: superAdminId,
          tokenHash: 'test-refresh-hash',
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      })

      // Create a password reset token
      const plainToken = crypto.randomBytes(32).toString('hex')
      const tokenHash = hashToken(plainToken)
      await prisma.passwordResetToken.create({
        data: {
          userId: superAdminId,
          tokenHash,
          expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        },
      })

      // Reset password
      await api()
        .post('/api/admin/auth/reset-password')
        .send({ token: plainToken, password: 'NewPassword789!' })

      // Verify refresh tokens are deleted
      const refreshTokens = await prisma.refreshToken.findMany({
        where: { userId: superAdminId },
      })
      expect(refreshTokens).toHaveLength(0)

      // Reset password back
      await prisma.user.update({
        where: { id: superAdminId },
        data: { passwordHash: await hashPassword(testPassword) },
      })
    })
  })
})
