import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import crypto from 'crypto'
import { api } from '../../test/http.js'
import { prisma } from '@dental/database'
import { hashPassword, hashToken } from '../../services/auth.service.js'
import { RESET_SEND_COOLDOWN_MS } from '../../services/password-reset.service.js'
import {
  loginIpRateLimitStore,
  loginAccountRateLimitStore,
  adminForgotPasswordRateLimitStore,
  adminResetPasswordRateLimitStore,
} from './auth.js'
import {
  loginIpRateLimitStore as tenantLoginIpRateLimitStore,
  loginAccountRateLimitStore as tenantLoginAccountRateLimitStore,
  forgotPasswordRateLimitStore as tenantForgotPasswordRateLimitStore,
  resetPasswordRateLimitStore as tenantResetPasswordRateLimitStore,
} from '../auth.js'

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
    // #417: these endpoints are now rate limited (10 per 15 min). Without a
    // reset the cases below share one budget and the later ones would 429 —
    // note they currently total 7 and 6 requests, i.e. they would pass by
    // luck today and break on the next test anyone adds. Reset, rather than
    // bypassing the limiter under NODE_ENV === 'test' (#254's ruling).
    await adminForgotPasswordRateLimitStore.resetAll()
    await adminResetPasswordRateLimitStore.resetAll()
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

      // Task #415: back-to-back requests no longer both issue — the second is
      // suppressed by the per-account cooldown, so without this the test would
      // be asserting the cooldown rather than the invalidation it is named for.
      // Age the first send past the window to reach the invalidate-then-issue
      // path again. The timestamp is moved in the DB rather than by shifting
      // the clock: a global shift would also move JWT expiry and every other
      // time-dependent assertion in this file.
      await prisma.passwordResetToken.update({
        where: { id: firstToken!.id },
        data: { createdAt: new Date(Date.now() - RESET_SEND_COOLDOWN_MS - 1000) },
      })

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

// Task #418: login rate limiting (super admin). Same shape as the tenant
// limiters in routes/auth.ts — IP (limit 20) then account (limit 10) — but
// keyed on email alone: super admins have no tenantId/clinicSlug dimension.
describe('Task #418: admin login rate limiting', () => {
  let superAdminId: string
  const testEmail = 'login-ratelimit-admin@test.com'
  const testPassword = 'CorrectPassword1!'
  const wrongPassword = 'WrongPassword1!'

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        email: testEmail,
        passwordHash: await hashPassword(testPassword),
        firstName: 'Login',
        lastName: 'RateLimitAdmin',
        role: 'SUPER_ADMIN',
        tenantId: null,
      },
    })
    superAdminId = user.id
  })

  afterAll(async () => {
    if (superAdminId) {
      await prisma.refreshToken.deleteMany({ where: { userId: superAdminId } })
      await prisma.user.delete({ where: { id: superAdminId } }).catch(() => {
        // User may already be gone.
      })
    }
  })

  beforeEach(async () => {
    // Four buckets share one MemoryStore-backed module instance across this
    // file's tests: without a reset here, earlier hits (including from this
    // block's own previous tests) would carry over. The tenant stores are
    // reset too so the cross-route independence test starts from a known
    // state regardless of run order.
    await loginIpRateLimitStore.resetAll()
    await loginAccountRateLimitStore.resetAll()
    await tenantLoginIpRateLimitStore.resetAll()
    await tenantLoginAccountRateLimitStore.resetAll()
  })

  it('throttles repeated failed logins from one IP once 20 distinct-account attempts are exceeded', async () => {
    const ip = '198.51.100.101'
    for (let i = 0; i < 20; i++) {
      const response = await api()
        .post('/api/admin/auth/login')
        .set('X-Forwarded-For', ip)
        .send({ email: `no-such-admin-${i}@test.com`, password: wrongPassword })
      expect(response.status).toBe(401)
    }

    const twentyFirst = await api()
      .post('/api/admin/auth/login')
      .set('X-Forwarded-For', ip)
      .send({ email: 'no-such-admin-20@test.com', password: wrongPassword })
    expect(twentyFirst.status).toBe(429)
    expect(twentyFirst.body.error.code).toBe('RATE_LIMITED')

    // A fresh account from a DIFFERENT IP is not blocked (IP/account
    // independence).
    const freshIpFreshAccount = await api()
      .post('/api/admin/auth/login')
      .set('X-Forwarded-For', '198.51.100.102')
      .send({ email: 'no-such-admin-fresh@test.com', password: wrongPassword })
    expect(freshIpFreshAccount.status).toBe(401)
  })

  it('throttles repeated failed logins against one account from many different IPs — X-Forwarded-For varies every request', async () => {
    for (let i = 0; i < 10; i++) {
      const response = await api()
        .post('/api/admin/auth/login')
        .set('X-Forwarded-For', `198.51.100.${110 + i}`)
        .send({ email: testEmail, password: wrongPassword })
      expect(response.status).toBe(401)
    }

    // A brand-new IP, never used above: still blocked, because it is the
    // ACCOUNT bucket that is exhausted.
    const eleventh = await api()
      .post('/api/admin/auth/login')
      .set('X-Forwarded-For', '198.51.100.199')
      .send({ email: testEmail, password: wrongPassword })
    expect(eleventh.status).toBe(429)
    expect(eleventh.body.error.code).toBe('RATE_LIMITED')
  })

  it('a successful login does not consume the account failure budget', async () => {
    const ip = '198.51.100.150'
    for (let i = 0; i < 9; i++) {
      const response = await api()
        .post('/api/admin/auth/login')
        .set('X-Forwarded-For', ip)
        .send({ email: testEmail, password: wrongPassword })
      expect(response.status).toBe(401)
    }

    const success = await api()
      .post('/api/admin/auth/login')
      .set('X-Forwarded-For', ip)
      .send({ email: testEmail, password: testPassword })
    expect(success.status).toBe(200)

    // If the success had been counted as a failure, the budget would already
    // be at zero and this next failure would 429. It must still be allowed.
    const stillAllowed = await api()
      .post('/api/admin/auth/login')
      .set('X-Forwarded-For', ip)
      .send({ email: testEmail, password: wrongPassword })
    expect(stillAllowed.status).toBe(401)

    // Only NOW is the 10-failure budget spent.
    const nowBlocked = await api()
      .post('/api/admin/auth/login')
      .set('X-Forwarded-For', ip)
      .send({ email: testEmail, password: wrongPassword })
    expect(nowBlocked.status).toBe(429)
  })

  it('returns an identical 429 body whether the account exists (wrong password) or does not exist', async () => {
    async function exhaustAccountBudget(ip: string, body: Record<string, string>) {
      for (let i = 0; i < 10; i++) {
        const response = await api().post('/api/admin/auth/login').set('X-Forwarded-For', ip).send(body)
        expect(response.status).toBe(401)
      }
      const eleventh = await api().post('/api/admin/auth/login').set('X-Forwarded-For', ip).send(body)
      expect(eleventh.status).toBe(429)
      return eleventh.body
    }

    const wrongPasswordResponse = await exhaustAccountBudget('198.51.100.160', {
      email: testEmail,
      password: wrongPassword,
    })
    const unknownEmailResponse = await exhaustAccountBudget('198.51.100.161', {
      email: 'no-such-admin-account-418@test.com',
      password: wrongPassword,
    })

    for (const body of [wrongPasswordResponse, unknownEmailResponse]) {
      expect(body.success).toBe(false)
      expect(body.error.code).toBe('RATE_LIMITED')
    }
    expect(wrongPasswordResponse.error.message).toBe(unknownEmailResponse.error.message)
  })

  it('a malformed payload with no usable email never trips (or spends) the account bucket', async () => {
    const ip = '198.51.100.170'
    // 12 requests: two more than the account limit of 10, all missing `email`.
    for (let i = 0; i < 12; i++) {
      const response = await api()
        .post('/api/admin/auth/login')
        .set('X-Forwarded-For', ip)
        .send({ password: wrongPassword })
      expect(response.status).toBe(400)
    }

    // A real (wrong-password) attempt from the SAME IP right after still gets
    // its full budget: the malformed traffic above spent nothing.
    const firstRealFailure = await api()
      .post('/api/admin/auth/login')
      .set('X-Forwarded-For', ip)
      .send({ email: testEmail, password: wrongPassword })
    expect(firstRealFailure.status).toBe(401)
  })

  it('treats different-case emails as the same account bucket', async () => {
    const ip = '198.51.100.180'
    const upperCaseEmail = 'CaseAdmin418@Test.com'
    const lowerCaseEmail = 'caseadmin418@test.com'

    for (let i = 0; i < 5; i++) {
      const response = await api()
        .post('/api/admin/auth/login')
        .set('X-Forwarded-For', ip)
        .send({ email: upperCaseEmail, password: wrongPassword })
      expect(response.status).toBe(401)
    }
    for (let i = 0; i < 5; i++) {
      const response = await api()
        .post('/api/admin/auth/login')
        .set('X-Forwarded-For', ip)
        .send({ email: lowerCaseEmail, password: wrongPassword })
      expect(response.status).toBe(401)
    }

    // 10 combined failures (5 + 5) have already spent the whole budget: an
    // 11th attempt, in either case, must be blocked.
    const eleventh = await api()
      .post('/api/admin/auth/login')
      .set('X-Forwarded-For', ip)
      .send({ email: upperCaseEmail, password: wrongPassword })
    expect(eleventh.status).toBe(429)
  })

  it('admin login buckets are independent of tenant login buckets, in both directions', async () => {
    const ip = '198.51.100.190'

    // Exhaust BOTH admin buckets: IP (20) via distinct accounts, then account
    // (10) for one fixed identity.
    for (let i = 0; i < 20; i++) {
      await api()
        .post('/api/admin/auth/login')
        .set('X-Forwarded-For', ip)
        .send({ email: `admin-indep-${i}@test.com`, password: wrongPassword })
    }
    const adminBlocked = await api()
      .post('/api/admin/auth/login')
      .set('X-Forwarded-For', ip)
      .send({ email: 'admin-indep-20@test.com', password: wrongPassword })
    expect(adminBlocked.status).toBe(429)

    // Tenant login, same IP, is completely unaffected.
    const tenantLoginUnaffected = await api()
      .post('/api/auth/login')
      .set('X-Forwarded-For', ip)
      .send({ email: 'tenant-indep@test.com', password: wrongPassword, clinicSlug: 'no-such-clinic-418-indep' })
    expect(tenantLoginUnaffected.status).toBe(401)

    // And the reverse: exhaust tenant login's IP bucket on a fresh IP, then
    // confirm admin login from that same IP is unaffected.
    const ip2 = '198.51.100.191'
    for (let i = 0; i < 20; i++) {
      await api()
        .post('/api/auth/login')
        .set('X-Forwarded-For', ip2)
        .send({ email: `tenant-indep-${i}@test.com`, password: wrongPassword, clinicSlug: 'no-such-clinic-418-indep' })
    }
    const tenantBlocked = await api()
      .post('/api/auth/login')
      .set('X-Forwarded-For', ip2)
      .send({ email: 'tenant-indep-20@test.com', password: wrongPassword, clinicSlug: 'no-such-clinic-418-indep' })
    expect(tenantBlocked.status).toBe(429)

    const adminLoginUnaffected = await api()
      .post('/api/admin/auth/login')
      .set('X-Forwarded-For', ip2)
      .send({ email: 'admin-unaffected@test.com', password: wrongPassword })
    expect(adminLoginUnaffected.status).toBe(401)
  })
})

describe('Task #417: admin password-recovery rate limiting', () => {
  const unknownEmail = 'no-such-superadmin-417@test.com'
  // A REAL super admin, scoped to this describe. The enumeration case below
  // is worthless without one: the describes above delete their own fixtures
  // in afterAll, so by the time this block runs there is no super admin in
  // the database and a test comparing "exists" against "does not exist"
  // would be comparing "does not exist" against itself — true by
  // construction, and still true if an oracle appeared.
  const existingEmail = `superadmin-417-${Date.now()}@test.com`
  let existingId: string | undefined

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        email: existingEmail,
        passwordHash: await hashPassword('OldPassword123!'),
        firstName: 'Test',
        lastName: 'SuperAdmin417',
        role: 'SUPER_ADMIN',
        tenantId: null,
      },
    })
    existingId = user.id
  })

  afterAll(async () => {
    if (existingId) {
      await prisma.passwordResetToken.deleteMany({ where: { userId: existingId } })
      await prisma.user.delete({ where: { id: existingId } }).catch(() => {
        // User may already be gone.
      })
    }
  })

  beforeEach(async () => {
    // All four recovery buckets, both routers: the independence tests below
    // assert across routers, so a leftover hit in either would make them
    // pass or fail for the wrong reason.
    await adminForgotPasswordRateLimitStore.resetAll()
    await adminResetPasswordRateLimitStore.resetAll()
    await tenantForgotPasswordRateLimitStore.resetAll()
    await tenantResetPasswordRateLimitStore.resetAll()
  })

  it('allows 10 forgot-password requests per IP and 429s the 11th', async () => {
    const ip = '198.51.100.211'
    for (let i = 0; i < 10; i++) {
      const response = await api()
        .post('/api/admin/auth/forgot-password')
        .set('X-Forwarded-For', ip)
        .send({ email: unknownEmail })
      expect(response.status).toBe(200)
    }

    const eleventh = await api()
      .post('/api/admin/auth/forgot-password')
      .set('X-Forwarded-For', ip)
      .send({ email: unknownEmail })
    expect(eleventh.status).toBe(429)
    expect(eleventh.body).toEqual({
      success: false,
      error: {
        message: 'Too many password recovery attempts. Please try again later.',
        code: 'RATE_LIMITED',
        retryAfter: expect.any(Number),
      },
    })
  })

  it('allows 10 reset-password requests per IP and 429s the 11th', async () => {
    const ip = '198.51.100.212'
    for (let i = 0; i < 10; i++) {
      const response = await api()
        .post('/api/admin/auth/reset-password')
        .set('X-Forwarded-For', ip)
        .send({ token: 'not-a-real-token', password: 'NewPassword123!' })
      // The limiter counts REQUESTS, not failures, so the rejected token
      // status here is irrelevant to the budget — only that it is not 429.
      expect(response.status).not.toBe(429)
    }

    const eleventh = await api()
      .post('/api/admin/auth/reset-password')
      .set('X-Forwarded-For', ip)
      .send({ token: 'not-a-real-token', password: 'NewPassword123!' })
    expect(eleventh.status).toBe(429)
    expect(eleventh.body.error.code).toBe('RATE_LIMITED')
  })

  it('gives the two admin recovery endpoints independent buckets', async () => {
    const ip = '198.51.100.213'
    for (let i = 0; i < 10; i++) {
      await api()
        .post('/api/admin/auth/forgot-password')
        .set('X-Forwarded-For', ip)
        .send({ email: unknownEmail })
    }
    const forgotBlocked = await api()
      .post('/api/admin/auth/forgot-password')
      .set('X-Forwarded-For', ip)
      .send({ email: unknownEmail })
    expect(forgotBlocked.status).toBe(429)

    // Separate buckets exist so a cheap, unauthenticated forgot-password
    // flood cannot starve reset-password for everyone behind one office NAT.
    const resetUnaffected = await api()
      .post('/api/admin/auth/reset-password')
      .set('X-Forwarded-For', ip)
      .send({ token: 'not-a-real-token', password: 'NewPassword123!' })
    expect(resetUnaffected.status).not.toBe(429)
  })

  it('keeps admin recovery buckets independent of the tenant ones, in both directions', async () => {
    // Asserts the PROPERTY (admin and tenant recovery are separately
    // budgeted), not the mechanism. It is worth being precise about what
    // does and does not catch a copy-pasted keyPrefix here, because it is
    // tempting to credit this test with more than it does:
    //
    //   - Under MemoryStore every limiter is a distinct instance, so a
    //     duplicated prefix would NOT change this test's outcome. No
    //     assertion in this file could catch it.
    //   - What catches it is the prefix registry in middleware/rate-limit.ts,
    //     which throws at module evaluation. Verified by setting this
    //     limiter's prefix to 'forgot-password': the file fails to load with
    //     "keyPrefix ... is already registered" and reports "no tests" —
    //     the boot fails before any assertion runs.
    //
    // This test still earns its place, and it is worth naming exactly what
    // it does guarantee:
    //
    //   - the buckets being merged some OTHER way — a shared limiter
    //     instance, or one middleware attached to both routers;
    //   - that `X-Forwarded-For` is actually honoured as the key. If it were
    //     not, every request here would key on the same socket address, and
    //     the final assertion would fail: `adminUnaffected` on ip2 would
    //     inherit the 11 hits already spent on the admin bucket at ip.
    const ip = '198.51.100.214'
    for (let i = 0; i < 10; i++) {
      await api()
        .post('/api/admin/auth/forgot-password')
        .set('X-Forwarded-For', ip)
        .send({ email: unknownEmail })
    }
    const adminBlocked = await api()
      .post('/api/admin/auth/forgot-password')
      .set('X-Forwarded-For', ip)
      .send({ email: unknownEmail })
    expect(adminBlocked.status).toBe(429)

    const tenantUnaffected = await api()
      .post('/api/auth/forgot-password')
      .set('X-Forwarded-For', ip)
      .send({ email: unknownEmail, clinicSlug: 'no-such-clinic-417' })
    expect(tenantUnaffected.status).not.toBe(429)

    // And the reverse, on a fresh IP.
    const ip2 = '198.51.100.215'
    for (let i = 0; i < 10; i++) {
      await api()
        .post('/api/auth/forgot-password')
        .set('X-Forwarded-For', ip2)
        .send({ email: unknownEmail, clinicSlug: 'no-such-clinic-417' })
    }
    const tenantBlocked = await api()
      .post('/api/auth/forgot-password')
      .set('X-Forwarded-For', ip2)
      .send({ email: unknownEmail, clinicSlug: 'no-such-clinic-417' })
    expect(tenantBlocked.status).toBe(429)

    const adminUnaffected = await api()
      .post('/api/admin/auth/forgot-password')
      .set('X-Forwarded-For', ip2)
      .send({ email: unknownEmail })
    expect(adminUnaffected.status).not.toBe(429)
  })

  it('returns an identical 429 whether the super-admin email exists or not', async () => {
    // Anti-enumeration: the 200 responses are already indistinguishable, and
    // the throttled response must not become the side channel that undoes
    // that.
    //
    // The two branches must genuinely differ, which is why this uses the
    // describe-scoped fixture rather than a made-up address: `existingEmail`
    // resolves to a real SUPER_ADMIN row, `unknownEmail` resolves to nothing.
    //
    // The property does also hold structurally today — the limiter's handler
    // replies before the route handler ever looks the email up, so the lookup
    // cannot influence the body. That is an argument for the property, not a
    // substitute for checking it: it stops holding the moment the limiter
    // moves after anything email-dependent, or the message becomes dynamic.
    const bodies: unknown[] = []
    for (const [email, shouldExist] of [
      [unknownEmail, false],
      [existingEmail, true],
    ] as const) {
      // Assert the premise about the address ACTUALLY being sent, using the
      // handler's own predicate (the findFirst in admin/auth.ts's
      // forgot-password). Checking the fixture instead would not do: the
      // fixture can be perfectly real while the loop sends something else,
      // which is exactly how this case was wrong before — both branches used
      // non-existent addresses, so it compared "does not exist" against
      // itself and would have stayed green if an oracle appeared.
      const found = await prisma.user.findFirst({
        where: { email, tenantId: null, role: 'SUPER_ADMIN', isActive: true },
        select: { id: true },
      })
      expect(Boolean(found)).toBe(shouldExist)

      await adminForgotPasswordRateLimitStore.resetAll()
      const ip = `198.51.100.${shouldExist ? '217' : '216'}`
      for (let i = 0; i < 10; i++) {
        await api()
          .post('/api/admin/auth/forgot-password')
          .set('X-Forwarded-For', ip)
          .send({ email })
      }
      const eleventh = await api()
        .post('/api/admin/auth/forgot-password')
        .set('X-Forwarded-For', ip)
        .send({ email })
      expect(eleventh.status).toBe(429)
      bodies.push({ ...eleventh.body, error: { ...eleventh.body.error, retryAfter: 0 } })
    }
    expect(bodies[0]).toEqual(bodies[1])
  })
})

// Task #415: the per-account send cooldown, super-admin half. The two
// recovery handlers carry the identical invalidate-then-issue shape, so they
// carry the identical lockout and get the identical control. The tenant half
// of these assertions — the hourly ceiling, the anti-enumeration comparison
// across all four branches, cross-tenant independence — lives in
// routes/auth.test.ts against the shared service; what is checked here is
// that this router is wired to it, and wired in the right ORDER.
describe('Task #415: super-admin recovery send cooldown', () => {
  let superAdminId: string | undefined
  const testEmail = `superadmin-415-${Date.now()}@test.com`

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        email: testEmail,
        passwordHash: await hashPassword('OldPassword123!'),
        firstName: 'Test',
        lastName: 'SuperAdmin415',
        role: 'SUPER_ADMIN',
        tenantId: null,
      },
    })
    superAdminId = user.id
  })

  afterAll(async () => {
    if (superAdminId) {
      await prisma.passwordResetToken.deleteMany({ where: { userId: superAdminId } })
      await prisma.user.delete({ where: { id: superAdminId } }).catch(() => {
        // User may already be gone.
      })
    }
  })

  beforeEach(async () => {
    if (superAdminId) {
      await prisma.passwordResetToken.deleteMany({ where: { userId: superAdminId } })
    }
    // Task #417 put a per-IP limiter on this endpoint. Every request below
    // comes from the same loopback address, so without this reset the cases
    // would inherit each other's hits.
    await adminForgotPasswordRateLimitStore.resetAll()
  })

  it('issues one token per cooldown window for one super admin', async () => {
    const first = await api().post('/api/admin/auth/forgot-password').send({ email: testEmail })
    expect(first.status).toBe(200)
    const second = await api().post('/api/admin/auth/forgot-password').send({ email: testEmail })
    expect(second.status).toBe(200)
    expect(await prisma.passwordResetToken.count({ where: { userId: superAdminId } })).toBe(1)
  })

  it('leaves an already-issued super-admin token redeemable when a later request is suppressed', async () => {
    // The ordering assertion. If the cooldown were checked next to the send —
    // i.e. after the updateMany — this token would already be marked used and
    // reset-password would reject it, while the suppressed request still
    // looked like a success from the outside.
    const plainToken = 'token-415-admin-survives-suppression'
    await prisma.passwordResetToken.create({
      data: {
        userId: superAdminId!,
        tokenHash: hashToken(plainToken),
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      },
    })

    const suppressed = await api()
      .post('/api/admin/auth/forgot-password')
      .send({ email: testEmail })
    expect(suppressed.status).toBe(200)

    const redeemed = await api()
      .post('/api/admin/auth/reset-password')
      .send({ token: plainToken, password: 'NewPassword415!' })
    expect(redeemed.status).toBe(200)
  })
})
