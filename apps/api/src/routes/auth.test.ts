import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'

// Task #221: assert the welcome email is sent in the persisted (resolved)
// language, without making a real network call. `vi.hoisted` is required
// because the `vi.mock` factory below is hoisted above this file's imports,
// so it cannot close over an ordinary top-level `const`.
const { sendWelcomeEmailMock } = vi.hoisted(() => ({
  sendWelcomeEmailMock: vi.fn().mockResolvedValue(true),
}))
vi.mock('../services/email.service.js', () => ({
  sendWelcomeEmail: sendWelcomeEmailMock,
  sendPasswordResetEmail: vi.fn().mockResolvedValue(true),
}))

import { api } from '../test/http.js'
import { prisma } from '@dental/database'
import bcrypt from 'bcrypt'
import { sign } from 'jsonwebtoken'
import {
  hashPassword,
  hashToken,
  generateProfileToken,
} from '../services/auth.service.js'
import { sendPasswordResetEmail } from '../services/email.service.js'
import {
  RESET_SEND_COOLDOWN_MS,
  RESET_SEND_MAX_PER_WINDOW,
} from '../services/password-reset.service.js'
import {
  forgotPasswordRateLimitStore,
  resetPasswordRateLimitStore,
  loginIpRateLimitStore,
  loginAccountRateLimitStore,
  pinLoginTargetRateLimitStore,
  pinLoginSessionRateLimitStore,
} from './auth.js'

describe('POST /api/auth/register', () => {
  let n = 0
  const uniqueSlug = () => `register-lang-${Date.now()}-${n++}`
  const createdTenantIds: string[] = []

  beforeAll(async () => {
    // Task #221: registration 500s with PLAN_NOT_FOUND if this is absent.
    await prisma.plan.upsert({
      where: { name: 'enterprise' },
      update: {},
      create: {
        name: 'enterprise',
        displayName: 'Enterprise',
        price: 0,
        maxAdmins: 5,
        maxDoctors: 10,
        maxPatients: 60,
        features: [],
      },
    })
  })

  beforeEach(() => {
    sendWelcomeEmailMock.mockClear()
  })

  afterAll(async () => {
    for (const tenantId of createdTenantIds) {
      await prisma.tenantSettings.deleteMany({ where: { tenantId } })
      await prisma.refreshToken.deleteMany({ where: { user: { tenantId } } })
      await prisma.user.deleteMany({ where: { tenantId } })
      await prisma.subscription.deleteMany({ where: { tenantId } })
      await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {
        // Tenant may have already been removed by another cleanup path.
      })
    }
  })

  async function registerNewClinic(extra: Record<string, unknown>) {
    const clinicSlug = uniqueSlug()
    const res = await api()
      .post('/api/auth/register')
      .send({
        email: `owner-${clinicSlug}@test.com`,
        password: 'Password1!',
        firstName: 'Ana',
        lastName: 'Owner',
        clinicName: 'Lang Test Clinic',
        clinicSlug,
        ...extra,
      })
    if (res.status === 201) {
      createdTenantIds.push(res.body.user.tenantId)
    }
    return res
  }

  it('persists language "en" for a newly registered clinic', async () => {
    const res = await registerNewClinic({ language: 'en' })

    expect(res.status).toBe(201)
    const settings = await prisma.tenantSettings.findUnique({
      where: { tenantId: res.body.user.tenantId },
    })
    expect(settings?.language).toBe('en')
  })

  it('persists language "ar" for a newly registered clinic', async () => {
    const res = await registerNewClinic({ language: 'ar' })

    expect(res.status).toBe(201)
    const settings = await prisma.tenantSettings.findUnique({
      where: { tenantId: res.body.user.tenantId },
    })
    expect(settings?.language).toBe('ar')
  })

  it('defaults to "es" when no language field is sent (back-compat with older clients)', async () => {
    const res = await registerNewClinic({})

    expect(res.status).toBe(201)
    const settings = await prisma.tenantSettings.findUnique({
      where: { tenantId: res.body.user.tenantId },
    })
    expect(settings?.language).toBe('es')
  })

  it('does NOT change an existing tenant\'s language when a second user registers into it', async () => {
    const clinicSlug = uniqueSlug()

    const firstRes = await api().post('/api/auth/register').send({
      email: `first-${clinicSlug}@test.com`,
      password: 'Password1!',
      firstName: 'First',
      lastName: 'Owner',
      clinicName: 'Existing Clinic',
      clinicSlug,
      language: 'es',
    })
    expect(firstRes.status).toBe(201)
    const tenantId = firstRes.body.user.tenantId
    createdTenantIds.push(tenantId)

    const before = await prisma.tenantSettings.findUnique({ where: { tenantId } })
    expect(before?.language).toBe('es')

    const secondRes = await api().post('/api/auth/register').send({
      email: `second-${clinicSlug}@test.com`,
      password: 'Password1!',
      firstName: 'Second',
      lastName: 'Staff',
      clinicSlug,
      language: 'en',
    })
    expect(secondRes.status).toBe(201)

    const after = await prisma.tenantSettings.findUnique({ where: { tenantId } })
    expect(after?.language).toBe('es')
  })

  describe('malformed/unsupported language values always fall back to "es" and never 400', () => {
    const cases: Array<[string, unknown]> = [
      ['unsupported language code "pt"', 'pt'],
      ['region-tagged locale "en-GB"', 'en-GB'],
      ['garbage string "zzz"', 'zzz'],
      ['empty string', ''],
      ['a number', 123],
    ]

    it.each(cases)('%s', async (_label, value) => {
      const res = await registerNewClinic({ language: value })

      expect(res.status).toBe(201)
      const settings = await prisma.tenantSettings.findUnique({
        where: { tenantId: res.body.user.tenantId },
      })
      expect(settings?.language).toBe('es')
    })
  })

  it('sends the welcome email in the persisted language, verified via the handler\'s own read-back', async () => {
    const res = await registerNewClinic({ language: 'ar' })
    expect(res.status).toBe(201)
    const tenantId = res.body.user.tenantId

    await vi.waitFor(() => {
      expect(sendWelcomeEmailMock).toHaveBeenCalled()
    })

    // The persisted value (what the handler re-reads via findUnique) is what
    // must match, not a local variable computed before the write.
    const settings = await prisma.tenantSettings.findUnique({ where: { tenantId } })
    expect(settings?.language).toBe('ar')
    expect(sendWelcomeEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({ language: 'ar' })
    )
  })
})

// Task #378: the fixtures below use deterministic emails and token strings, and
// PasswordResetToken.tokenHash is globally @unique. An aborted run therefore
// strands rows that make the NEXT run fail at create() — a failure that
// re-strands them, so it never self-clears. Delete-then-insert makes the suite
// recover from any prior state.
const FIXTURE_EMAILS = [
  'inactive@test.com',
  'superadmin-wrong@test.com',
  'inactive-reset@test.com',
  'superadmin-reset-test@test.com',
]

const FIXTURE_RESET_TOKENS = [
  'valid-test-token-for-reset',
  'expired-test-token',
  'used-test-token',
  'weak-password-token',
  'token-for-invalidation-test',
  'inactive-user-token',
  'superadmin-tenant-reset-token',
  // Task #415 seeds deterministic tokens too, so they belong in the same
  // delete-then-insert net — an aborted run otherwise strands them against
  // the globally @unique tokenHash and the next run fails at create().
  'token-415-survives-suppression',
  'token-415-ceiling-0',
  'token-415-ceiling-1',
  'token-415-ceiling-2',
  'token-415-ceiling-3',
  'token-415-ceiling-4',
  'token-415-oracle-0',
  'token-415-oracle-1',
  'token-415-oracle-2',
  'token-415-oracle-3',
  'token-415-oracle-4',
]

async function clearAuthFixtures() {
  // A token stranded after its owning user was already removed is invisible to
  // any user-scoped delete, and on its own is enough to keep the loop alive —
  // so clearing by hash is the essential half, not an extra.
  await prisma.passwordResetToken.deleteMany({
    where: { tokenHash: { in: FIXTURE_RESET_TOKENS.map(hashToken) } },
  })

  const users = await prisma.user.findMany({
    where: { email: { in: FIXTURE_EMAILS } },
    select: { id: true },
  })
  const userIds = users.map((u) => u.id)
  if (userIds.length > 0) {
    await prisma.passwordResetToken.deleteMany({ where: { userId: { in: userIds } } })
    await prisma.user.deleteMany({ where: { id: { in: userIds } } })
  }
}

describe('Auth - Tenant User Password Recovery', () => {
  let tenantId: string
  let userId: string
  const testEmail = 'tenant-user-recovery@test.com'
  const testPassword = 'OldPassword123!'
  // Use unique slug with random suffix to avoid conflicts with parallel tests
  const testClinicSlug = `test-clinic-recovery-${Date.now()}`

  beforeAll(async () => {
    // Create a test tenant
    const tenant = await prisma.tenant.create({
      data: {
        name: 'Test Clinic for Recovery',
        slug: testClinicSlug,
      },
    })
    tenantId = tenant.id

    // Create a test user in this tenant
    const passwordHash = await hashPassword(testPassword)
    const user = await prisma.user.create({
      data: {
        email: testEmail,
        passwordHash,
        firstName: 'Test',
        lastName: 'TenantUser',
        role: 'OWNER',
        tenantId: tenant.id,
      },
    })
    userId = user.id
  })

  afterAll(async () => {
    // Clean up test data - handle cases where creation may have failed
    if (userId) {
      await prisma.passwordResetToken.deleteMany({
        where: { userId },
      })
      await prisma.refreshToken.deleteMany({
        where: { userId },
      })
      await prisma.user.delete({
        where: { id: userId },
      }).catch(() => { /* User may not exist */ })
    }
    if (tenantId) {
      await prisma.tenant.delete({
        where: { id: tenantId },
      }).catch(() => { /* Tenant may not exist */ })
    }
  })

  beforeEach(async () => {
    // Clean up tokens before each test
    await prisma.passwordResetToken.deleteMany({
      where: { userId },
    })
    // Task #378: wired here rather than per-test so a future fixture cannot
    // forget it — every test in this file starts from a known state.
    await clearAuthFixtures()
    // Task #254: forgot-password and reset-password each carry their own
    // rate-limit bucket, keyed by IP. All requests in this suite come from
    // the same loopback address, so without this reset later tests in each
    // describe block would start getting 429s from earlier tests' hits.
    await forgotPasswordRateLimitStore.resetAll()
    await resetPasswordRateLimitStore.resetAll()
  })

  describe('POST /api/auth/forgot-password', () => {
    it('should return 200 for valid tenant user email and clinicSlug', async () => {
      const response = await api()
        .post('/api/auth/forgot-password')
        .send({ email: testEmail, clinicSlug: testClinicSlug })

      expect(response.status).toBe(200)
      expect(response.body.success).toBe(true)
      expect(response.body.message).toContain('If an account exists')

      // Verify token was created
      const token = await prisma.passwordResetToken.findFirst({
        where: { userId },
      })
      expect(token).not.toBeNull()
      expect(token?.usedAt).toBeNull()
    })

    it('should return 200 for non-existent email (security)', async () => {
      const response = await api()
        .post('/api/auth/forgot-password')
        .send({ email: 'nonexistent@test.com', clinicSlug: testClinicSlug })

      expect(response.status).toBe(200)
      expect(response.body.success).toBe(true)
      expect(response.body.message).toContain('If an account exists')
    })

    it('should return 200 for non-existent clinic (security)', async () => {
      const response = await api()
        .post('/api/auth/forgot-password')
        .send({ email: testEmail, clinicSlug: 'non-existent-clinic' })

      expect(response.status).toBe(200)
      expect(response.body.success).toBe(true)
      expect(response.body.message).toContain('If an account exists')
    })

    it('should return 400 for invalid email format', async () => {
      const response = await api()
        .post('/api/auth/forgot-password')
        .send({ email: 'not-an-email', clinicSlug: testClinicSlug })

      expect(response.status).toBe(400)
      expect(response.body.success).toBe(false)
    })

    it('should return 400 for missing clinicSlug', async () => {
      const response = await api()
        .post('/api/auth/forgot-password')
        .send({ email: testEmail })

      expect(response.status).toBe(400)
      expect(response.body.success).toBe(false)
    })

    it('should invalidate previous tokens when requesting a new one', async () => {
      // Request first token
      await api()
        .post('/api/auth/forgot-password')
        .send({ email: testEmail, clinicSlug: testClinicSlug })

      const firstToken = await prisma.passwordResetToken.findFirst({
        where: { userId, usedAt: null },
      })
      expect(firstToken).not.toBeNull()

      // Task #415: back-to-back requests no longer both issue — the second
      // would be suppressed by the per-account cooldown and this test would
      // be asserting the cooldown rather than the invalidation. Age the first
      // send past the window so the request below actually reaches the
      // invalidate-then-issue path this test is about.
      await prisma.passwordResetToken.update({
        where: { id: firstToken!.id },
        data: { createdAt: new Date(Date.now() - RESET_SEND_COOLDOWN_MS - 1000) },
      })

      // Request second token
      await api()
        .post('/api/auth/forgot-password')
        .send({ email: testEmail, clinicSlug: testClinicSlug })

      // First token should be invalidated (usedAt set)
      const invalidatedToken = await prisma.passwordResetToken.findUnique({
        where: { id: firstToken!.id },
      })
      expect(invalidatedToken?.usedAt).not.toBeNull()

      // There should be a new valid token
      const newToken = await prisma.passwordResetToken.findFirst({
        where: { userId, usedAt: null },
      })
      expect(newToken).not.toBeNull()
      expect(newToken?.id).not.toBe(firstToken?.id)
    })

    it('should not create token for inactive user', async () => {
      // Create inactive user
      const inactiveUser = await prisma.user.create({
        data: {
          email: 'inactive@test.com',
          passwordHash: await hashPassword('Test123!'),
          firstName: 'Inactive',
          lastName: 'User',
          role: 'STAFF',
          tenantId,
          isActive: false,
        },
      })

      const response = await api()
        .post('/api/auth/forgot-password')
        .send({ email: 'inactive@test.com', clinicSlug: testClinicSlug })

      expect(response.status).toBe(200) // Still 200 for security

      // But no token should be created
      const token = await prisma.passwordResetToken.findFirst({
        where: { userId: inactiveUser.id },
      })
      expect(token).toBeNull()

      // Cleanup
      await prisma.user.delete({ where: { id: inactiveUser.id } })
    })

    it('should not create token for SUPER_ADMIN (wrong endpoint)', async () => {
      // Create a super admin
      const superAdmin = await prisma.user.create({
        data: {
          email: 'superadmin-wrong@test.com',
          passwordHash: await hashPassword('Test123!'),
          firstName: 'Super',
          lastName: 'Admin',
          role: 'SUPER_ADMIN',
          tenantId: null,
        },
      })

      const response = await api()
        .post('/api/auth/forgot-password')
        .send({ email: 'superadmin-wrong@test.com', clinicSlug: testClinicSlug })

      expect(response.status).toBe(200) // Still 200 for security

      // But no token should be created
      const token = await prisma.passwordResetToken.findFirst({
        where: { userId: superAdmin.id },
      })
      expect(token).toBeNull()

      // Cleanup
      await prisma.user.delete({ where: { id: superAdmin.id } })
    })
  })

  describe('POST /api/auth/reset-password', () => {
    it('should reset password with valid token', async () => {
      // Create a valid token
      const plainToken = 'valid-test-token-for-reset'
      const tokenHash = hashToken(plainToken)
      await prisma.passwordResetToken.create({
        data: {
          userId,
          tokenHash,
          expiresAt: new Date(Date.now() + 15 * 60 * 1000), // 15 min
        },
      })

      const newPassword = 'NewPassword123!'
      const response = await api()
        .post('/api/auth/reset-password')
        .send({ token: plainToken, password: newPassword })

      expect(response.status).toBe(200)
      expect(response.body.success).toBe(true)
      expect(response.body.message).toContain('Password has been reset')

      // Verify token was marked as used
      const usedToken = await prisma.passwordResetToken.findUnique({
        where: { tokenHash },
      })
      expect(usedToken?.usedAt).not.toBeNull()

      // Verify we can login with new password
      const loginResponse = await api()
        .post('/api/auth/login')
        .send({ email: testEmail, password: newPassword, clinicSlug: testClinicSlug })

      expect(loginResponse.status).toBe(200)
    })

    it('should return 400 for invalid token', async () => {
      const response = await api()
        .post('/api/auth/reset-password')
        .send({ token: 'invalid-token', password: 'NewPassword123!' })

      expect(response.status).toBe(400)
      expect(response.body.success).toBe(false)
      expect(response.body.error.code).toBe('INVALID_TOKEN')
    })

    it('should return 400 for expired token', async () => {
      const plainToken = 'expired-test-token'
      const tokenHash = hashToken(plainToken)
      await prisma.passwordResetToken.create({
        data: {
          userId,
          tokenHash,
          expiresAt: new Date(Date.now() - 1000), // Already expired
        },
      })

      const response = await api()
        .post('/api/auth/reset-password')
        .send({ token: plainToken, password: 'NewPassword123!' })

      expect(response.status).toBe(400)
      expect(response.body.success).toBe(false)
      expect(response.body.error.code).toBe('TOKEN_EXPIRED')
    })

    it('should return 400 for already used token', async () => {
      const plainToken = 'used-test-token'
      const tokenHash = hashToken(plainToken)
      await prisma.passwordResetToken.create({
        data: {
          userId,
          tokenHash,
          expiresAt: new Date(Date.now() + 15 * 60 * 1000),
          usedAt: new Date(), // Already used
        },
      })

      const response = await api()
        .post('/api/auth/reset-password')
        .send({ token: plainToken, password: 'NewPassword123!' })

      expect(response.status).toBe(400)
      expect(response.body.success).toBe(false)
      expect(response.body.error.code).toBe('TOKEN_USED')
    })

    it('should return 400 for weak password', async () => {
      const plainToken = 'weak-password-token'
      const tokenHash = hashToken(plainToken)
      await prisma.passwordResetToken.create({
        data: {
          userId,
          tokenHash,
          expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        },
      })

      const response = await api()
        .post('/api/auth/reset-password')
        .send({ token: plainToken, password: 'weak' })

      expect(response.status).toBe(400)
      expect(response.body.success).toBe(false)
    })

    it('should invalidate all refresh tokens on password reset', async () => {
      // Create some refresh tokens
      await prisma.refreshToken.create({
        data: {
          userId,
          tokenHash: 'old-refresh-token-hash-1',
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      })
      await prisma.refreshToken.create({
        data: {
          userId,
          tokenHash: 'old-refresh-token-hash-2',
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      })

      // Create a valid reset token
      const plainToken = 'token-for-invalidation-test'
      const tokenHash = hashToken(plainToken)
      await prisma.passwordResetToken.create({
        data: {
          userId,
          tokenHash,
          expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        },
      })

      const response = await api()
        .post('/api/auth/reset-password')
        .send({ token: plainToken, password: 'NewPassword123!' })

      expect(response.status).toBe(200)

      // Verify all refresh tokens were deleted
      const remainingTokens = await prisma.refreshToken.findMany({
        where: { userId },
      })
      expect(remainingTokens).toHaveLength(0)
    })

    it('should return 400 for inactive user', async () => {
      // Create inactive user
      const inactiveUser = await prisma.user.create({
        data: {
          email: 'inactive-reset@test.com',
          passwordHash: await hashPassword('Test123!'),
          firstName: 'Inactive',
          lastName: 'User',
          role: 'STAFF',
          tenantId,
          isActive: false,
        },
      })

      const plainToken = 'inactive-user-token'
      const tokenHash = hashToken(plainToken)
      await prisma.passwordResetToken.create({
        data: {
          userId: inactiveUser.id,
          tokenHash,
          expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        },
      })

      const response = await api()
        .post('/api/auth/reset-password')
        .send({ token: plainToken, password: 'NewPassword123!' })

      expect(response.status).toBe(400)
      expect(response.body.success).toBe(false)
      expect(response.body.error.code).toBe('ACCOUNT_INACTIVE')

      // Cleanup
      await prisma.passwordResetToken.deleteMany({ where: { userId: inactiveUser.id } })
      await prisma.user.delete({ where: { id: inactiveUser.id } })
    })

    it('should return 400 for SUPER_ADMIN attempting to use tenant reset endpoint', async () => {
      // Create a SUPER_ADMIN user (no tenantId)
      const superAdmin = await prisma.user.create({
        data: {
          email: 'superadmin-reset-test@test.com',
          passwordHash: await hashPassword('Test123!'),
          firstName: 'Super',
          lastName: 'Admin',
          role: 'SUPER_ADMIN',
          tenantId: null,
        },
      })

      // Create a valid token for the SUPER_ADMIN
      const plainToken = 'superadmin-tenant-reset-token'
      const tokenHash = hashToken(plainToken)
      await prisma.passwordResetToken.create({
        data: {
          userId: superAdmin.id,
          tokenHash,
          expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        },
      })

      // Attempt to use tenant reset-password endpoint
      const response = await api()
        .post('/api/auth/reset-password')
        .send({ token: plainToken, password: 'NewPassword123!' })

      // Should fail because SUPER_ADMIN has no tenantId
      expect(response.status).toBe(400)
      expect(response.body.success).toBe(false)
      expect(response.body.error.code).toBe('INVALID_TOKEN')

      // Cleanup
      await prisma.passwordResetToken.deleteMany({ where: { userId: superAdmin.id } })
      await prisma.user.delete({ where: { id: superAdmin.id } })
    })
  })

  describe('Task #254: password recovery rate limiting', () => {
    it('does not 429 forgot-password before the 11th request, and 429s on the 11th', async () => {
      for (let i = 0; i < 10; i++) {
        const response = await api()
          .post('/api/auth/forgot-password')
          .send({ email: testEmail, clinicSlug: testClinicSlug })
        expect(response.status).toBe(200)
      }

      const eleventh = await api()
        .post('/api/auth/forgot-password')
        .send({ email: testEmail, clinicSlug: testClinicSlug })

      expect(eleventh.status).toBe(429)
      expect(eleventh.body).toEqual({
        success: false,
        error: {
          message: expect.any(String),
          code: 'RATE_LIMITED',
          retryAfter: expect.any(Number),
        },
      })
      // `expect.any(Number)` above only proves it's numeric, not that it's in
      // the right unit. The window is 15 minutes (900s); if the handler ever
      // regressed to emitting milliseconds (900000) instead of seconds, this
      // bound is what would catch it.
      expect(eleventh.body.error.retryAfter).toBeGreaterThan(0)
      expect(eleventh.body.error.retryAfter).toBeLessThanOrEqual(15 * 60)
    })

    it('does not 429 reset-password before the 11th request, and 429s on the 11th', async () => {
      for (let i = 0; i < 10; i++) {
        const response = await api()
          .post('/api/auth/reset-password')
          .send({ token: 'nonexistent-token', password: 'NewPassword123!' })
        expect(response.status).toBe(400)
      }

      const eleventh = await api()
        .post('/api/auth/reset-password')
        .send({ token: 'nonexistent-token', password: 'NewPassword123!' })

      expect(eleventh.status).toBe(429)
      expect(eleventh.body.error.code).toBe('RATE_LIMITED')
    })

    it('exhausting forgot-password does NOT rate-limit reset-password from the same IP (separate buckets, anti-starvation)', async () => {
      for (let i = 0; i < 11; i++) {
        await api()
          .post('/api/auth/forgot-password')
          .send({ email: testEmail, clinicSlug: testClinicSlug })
      }

      const resetResponse = await api()
        .post('/api/auth/reset-password')
        .send({ token: 'nonexistent-token', password: 'NewPassword123!' })

      expect(resetResponse.status).not.toBe(429)
      expect(resetResponse.status).toBe(400)
    })

    it('exhausting reset-password does NOT rate-limit forgot-password from the same IP (independence holds in both directions)', async () => {
      for (let i = 0; i < 11; i++) {
        await api()
          .post('/api/auth/reset-password')
          .send({ token: 'nonexistent-token', password: 'NewPassword123!' })
      }

      const forgotResponse = await api()
        .post('/api/auth/forgot-password')
        .send({ email: testEmail, clinicSlug: testClinicSlug })

      expect(forgotResponse.status).not.toBe(429)
      expect(forgotResponse.status).toBe(200)
    })

    it('returns an identical 429 shape for a known and an unknown email (no enumeration signal)', async () => {
      for (let i = 0; i < 10; i++) {
        await api()
          .post('/api/auth/forgot-password')
          .send({ email: testEmail, clinicSlug: testClinicSlug })
      }
      const knownEmailResponse = await api()
        .post('/api/auth/forgot-password')
        .send({ email: testEmail, clinicSlug: testClinicSlug })

      await forgotPasswordRateLimitStore.resetAll()

      for (let i = 0; i < 10; i++) {
        await api()
          .post('/api/auth/forgot-password')
          .send({ email: 'does-not-exist@test.com', clinicSlug: testClinicSlug })
      }
      const unknownEmailResponse = await api()
        .post('/api/auth/forgot-password')
        .send({ email: 'does-not-exist@test.com', clinicSlug: testClinicSlug })

      expect(knownEmailResponse.status).toBe(429)
      expect(unknownEmailResponse.status).toBe(429)
      expect(knownEmailResponse.body.success).toBe(false)
      expect(unknownEmailResponse.body.success).toBe(false)
      expect(knownEmailResponse.body.error.message).toBe(unknownEmailResponse.body.error.message)
      expect(knownEmailResponse.body.error.code).toBe(unknownEmailResponse.body.error.code)
      expect(knownEmailResponse.body.error.code).toBe('RATE_LIMITED')
    })

    it('gives two different X-Forwarded-For clients independent buckets (proves trust proxy took effect)', async () => {
      for (let i = 0; i < 10; i++) {
        const response = await api()
          .post('/api/auth/forgot-password')
          .set('X-Forwarded-For', '203.0.113.10')
          .send({ email: testEmail, clinicSlug: testClinicSlug })
        expect(response.status).toBe(200)
      }
      const tenthClientOneNextRequest = await api()
        .post('/api/auth/forgot-password')
        .set('X-Forwarded-For', '203.0.113.10')
        .send({ email: testEmail, clinicSlug: testClinicSlug })
      expect(tenthClientOneNextRequest.status).toBe(429)

      const firstRequestFromSecondClient = await api()
        .post('/api/auth/forgot-password')
        .set('X-Forwarded-For', '203.0.113.20')
        .send({ email: testEmail, clinicSlug: testClinicSlug })
      expect(firstRequestFromSecondClient.status).toBe(200)
    })
  })
  // Task #415: the per-account send cooldown. Distinct from #254's limiter in
  // both axis and primitive: #254 caps one IP via express-rate-limit, this
  // caps one ACCOUNT via PasswordResetToken.createdAt. Every request below
  // varies X-Forwarded-For precisely so that a pass cannot be #254's doing.
  describe('Task #415: per-account recovery send cooldown', () => {
    let ip = 200
    const freshIp = () => `203.0.113.${ip++}`
    const inFifteenMinutes = () => new Date(Date.now() + 15 * 60 * 1000)

    beforeEach(async () => {
      vi.mocked(sendPasswordResetEmail).mockClear()
    })

    it('sends once per cooldown window for one account, even from different IPs', async () => {
      // The distinct X-Forwarded-For on each request is load-bearing, not
      // over-specification: with one shared origin, #254's per-IP limiter
      // would be a second explanation for a single send, and this test could
      // not tell the two controls apart. Two origins leave one hit in each of
      // those buckets, so the suppression can only be the account's.
      const first = await api()
        .post('/api/auth/forgot-password')
        .set('X-Forwarded-For', freshIp())
        .send({ email: testEmail, clinicSlug: testClinicSlug })
      expect(first.status).toBe(200)

      const second = await api()
        .post('/api/auth/forgot-password')
        .set('X-Forwarded-For', freshIp())
        .send({ email: testEmail, clinicSlug: testClinicSlug })
      expect(second.status).toBe(200)

      // Two different origins, so #254's per-IP limiter never fired — each of
      // those buckets has exactly one hit. The suppression is the account's.
      expect(vi.mocked(sendPasswordResetEmail)).toHaveBeenCalledTimes(1)
      expect(await prisma.passwordResetToken.count({ where: { userId } })).toBe(1)
    })

    it('leaves a token already delivered to the user redeemable when a later request is suppressed', async () => {
      // THE ordering test. The cooldown has to return BEFORE the handler
      // invalidates outstanding tokens. Checked next to the send instead —
      // the intuitive place — it would suppress the email while still killing
      // this token, i.e. complete the lockout it exists to prevent.
      const plainToken = 'token-415-survives-suppression'
      await prisma.passwordResetToken.create({
        data: { userId, tokenHash: hashToken(plainToken), expiresAt: inFifteenMinutes() },
      })

      const suppressed = await api()
        .post('/api/auth/forgot-password')
        .set('X-Forwarded-For', freshIp())
        .send({ email: testEmail, clinicSlug: testClinicSlug })
      expect(suppressed.status).toBe(200)
      expect(vi.mocked(sendPasswordResetEmail)).not.toHaveBeenCalled()

      // Drive the REAL token through the REAL endpoint. Asserting instead
      // that some row exists with usedAt: null would be a weaker claim that a
      // freshly issued token also satisfies — so it would pass against the
      // broken ordering, which is the one thing this test must not do.
      const redeemed = await api()
        .post('/api/auth/reset-password')
        .send({ token: plainToken, password: 'NewPassword415!' })
      expect(redeemed.status).toBe(200)

      // Put the fixture password back; later describes are independent, but a
      // test that leaves a changed credential behind is a trap for the next one.
      await prisma.user.update({
        where: { id: userId },
        data: { passwordHash: await hashPassword(testPassword) },
      })
    })

    it('suppresses the 6th send within the hour even when every send is outside the 2-minute cooldown', async () => {
      // Spread the seeded sends 5 minutes apart. The most recent is well
      // outside RESET_SEND_COOLDOWN_MS, so a pass here cannot be the cooldown
      // doing the work — only the hourly ceiling can produce it.
      const spacingMs = 5 * 60 * 1000
      // Guards the test's own premise, not the code: if the cooldown were
      // ever raised past this spacing, the seeded sends would fall inside it
      // and this case would quietly start proving the cooldown instead.
      expect(spacingMs).toBeGreaterThan(RESET_SEND_COOLDOWN_MS)

      const now = Date.now()
      for (let i = 0; i < RESET_SEND_MAX_PER_WINDOW; i++) {
        await prisma.passwordResetToken.create({
          data: {
            userId,
            tokenHash: hashToken(`token-415-ceiling-${i}`),
            expiresAt: inFifteenMinutes(),
            createdAt: new Date(now - (i + 1) * spacingMs),
            usedAt: new Date(),
          },
        })
      }

      const blocked = await api()
        .post('/api/auth/forgot-password')
        .set('X-Forwarded-For', freshIp())
        .send({ email: testEmail, clinicSlug: testClinicSlug })
      expect(blocked.status).toBe(200)
      expect(vi.mocked(sendPasswordResetEmail)).not.toHaveBeenCalled()
      expect(await prisma.passwordResetToken.count({ where: { userId } })).toBe(
        RESET_SEND_MAX_PER_WINDOW
      )
    })

    it('returns a byte-identical response whether the account exists, is unknown, is in cooldown, or is over the ceiling', async () => {
      const post = (email: string) =>
        api()
          .post('/api/auth/forgot-password')
          .set('X-Forwarded-For', freshIp())
          .send({ email, clinicSlug: testClinicSlug })

      // 1. exists, allowed — also arms the cooldown for 2.
      const allowed = await post(testEmail)
      // 2. exists, in cooldown.
      const cooled = await post(testEmail)
      // 3. does not exist.
      const unknown = await post('no-such-user-415@test.com')
      // 4. exists, over the hourly ceiling.
      const now = Date.now()
      for (let i = 0; i < RESET_SEND_MAX_PER_WINDOW; i++) {
        await prisma.passwordResetToken.create({
          data: {
            userId,
            tokenHash: hashToken(`token-415-oracle-${i}`),
            expiresAt: inFifteenMinutes(),
            createdAt: new Date(now - (i + 1) * 6 * 60 * 1000),
            usedAt: new Date(),
          },
        })
      }
      const overCeiling = await post(testEmail)

      for (const res of [allowed, cooled, unknown, overCeiling]) {
        expect(res.status).toBe(200)
        expect(res.body).toEqual(allowed.body)
      }
    })

    it('budgets the same email address in two tenants independently', async () => {
      // @@unique([tenantId, email]) means one address in two clinics is two
      // users. The cooldown is keyed on userId, so the budgets must not
      // couple — asserted explicitly so a future refactor to email-keying
      // cannot introduce cross-tenant denial of recovery silently.
      const otherTenant = await prisma.tenant.create({
        data: { name: 'Other Clinic 415', slug: `test-clinic-415-other-${Date.now()}` },
      })
      const otherUser = await prisma.user.create({
        data: {
          email: testEmail,
          passwordHash: await hashPassword(testPassword),
          firstName: 'Other',
          lastName: 'TenantUser',
          role: 'OWNER',
          tenantId: otherTenant.id,
        },
      })

      try {
        await api()
          .post('/api/auth/forgot-password')
          .set('X-Forwarded-For', freshIp())
          .send({ email: testEmail, clinicSlug: testClinicSlug })
        await api()
          .post('/api/auth/forgot-password')
          .set('X-Forwarded-For', freshIp())
          .send({ email: testEmail, clinicSlug: testClinicSlug })
        expect(await prisma.passwordResetToken.count({ where: { userId } })).toBe(1)

        // The other tenant's user is untouched by that spent budget.
        await api()
          .post('/api/auth/forgot-password')
          .set('X-Forwarded-For', freshIp())
          .send({ email: testEmail, clinicSlug: otherTenant.slug })
        expect(await prisma.passwordResetToken.count({ where: { userId: otherUser.id } })).toBe(1)
      } finally {
        await prisma.passwordResetToken.deleteMany({ where: { userId: otherUser.id } })
        await prisma.user.delete({ where: { id: otherUser.id } })
        await prisma.tenant.delete({ where: { id: otherTenant.id } })
      }
    })
  })
})

// Task #418: login rate limiting (tenant). Two independent limiters guard
// POST /api/auth/login — IP (limit 20) then account (limit 10), keyed on
// (email, clinicSlug) so the same address in two clinics gets two buckets.
// Only a 401 spends budget; a fresh MemoryStore is used under test (no Redis
// client is configured), so every store here supports resetAll().
describe('Task #418: tenant login rate limiting', () => {
  let tenantId: string
  let userId: string
  const testEmail = 'login-ratelimit-tenant@test.com'
  const testPassword = 'CorrectPassword1!'
  const wrongPassword = 'WrongPassword1!'
  const testClinicSlug = `login-rl-tenant-${Date.now()}`

  beforeAll(async () => {
    const tenant = await prisma.tenant.create({
      data: { name: 'Login Rate Limit Tenant', slug: testClinicSlug },
    })
    tenantId = tenant.id

    const user = await prisma.user.create({
      data: {
        email: testEmail,
        passwordHash: await hashPassword(testPassword),
        firstName: 'Login',
        lastName: 'RateLimit',
        role: 'OWNER',
        tenantId: tenant.id,
      },
    })
    userId = user.id
  })

  afterAll(async () => {
    if (userId) {
      await prisma.refreshToken.deleteMany({ where: { userId } })
      await prisma.user.delete({ where: { id: userId } }).catch(() => {
        // User may already be gone.
      })
    }
    if (tenantId) {
      await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {
        // Tenant may already be gone.
      })
    }
  })

  beforeEach(async () => {
    // These four buckets share one MemoryStore-backed module instance for the
    // whole file: without a reset here, hits from earlier describe blocks (and
    // from earlier tests in THIS block) would carry over and produce a 429 at
    // an unexpected request count. Resetting the #416 recovery stores too
    // keeps the independence tests below honest about their starting state.
    await loginIpRateLimitStore.resetAll()
    await loginAccountRateLimitStore.resetAll()
    await forgotPasswordRateLimitStore.resetAll()
    await resetPasswordRateLimitStore.resetAll()
  })

  it('throttles repeated failed logins from one IP once 20 distinct-account attempts are exceeded', async () => {
    const ip = '198.51.100.1'
    for (let i = 0; i < 20; i++) {
      const response = await api()
        .post('/api/auth/login')
        .set('X-Forwarded-For', ip)
        .send({ email: `no-such-user-${i}@test.com`, password: wrongPassword, clinicSlug: testClinicSlug })
      expect(response.status).toBe(401)
    }

    const twentyFirst = await api()
      .post('/api/auth/login')
      .set('X-Forwarded-For', ip)
      .send({ email: 'no-such-user-20@test.com', password: wrongPassword, clinicSlug: testClinicSlug })
    expect(twentyFirst.status).toBe(429)
    expect(twentyFirst.body.error.code).toBe('RATE_LIMITED')

    // A fresh account from a DIFFERENT IP is not blocked: the bucket above is
    // scoped to the IP, not global (IP/account independence).
    const freshIpFreshAccount = await api()
      .post('/api/auth/login')
      .set('X-Forwarded-For', '198.51.100.2')
      .send({ email: 'no-such-user-fresh@test.com', password: wrongPassword, clinicSlug: testClinicSlug })
    expect(freshIpFreshAccount.status).toBe(401)
  })

  it('throttles repeated failed logins against one account from many different IPs — X-Forwarded-For varies every request', async () => {
    for (let i = 0; i < 10; i++) {
      const response = await api()
        .post('/api/auth/login')
        .set('X-Forwarded-For', `198.51.100.${10 + i}`)
        .send({ email: testEmail, password: wrongPassword, clinicSlug: testClinicSlug })
      expect(response.status).toBe(401)
    }

    // A brand-new IP, never used above: still blocked, because it is the
    // ACCOUNT bucket that is exhausted, not any one IP's bucket.
    const eleventh = await api()
      .post('/api/auth/login')
      .set('X-Forwarded-For', '198.51.100.99')
      .send({ email: testEmail, password: wrongPassword, clinicSlug: testClinicSlug })
    expect(eleventh.status).toBe(429)
    expect(eleventh.body.error.code).toBe('RATE_LIMITED')
  })

  it('a successful login does not consume the account failure budget', async () => {
    const ip = '198.51.100.50'
    for (let i = 0; i < 9; i++) {
      const response = await api()
        .post('/api/auth/login')
        .set('X-Forwarded-For', ip)
        .send({ email: testEmail, password: wrongPassword, clinicSlug: testClinicSlug })
      expect(response.status).toBe(401)
    }

    // One failure of budget remains. Spend it on a SUCCESS instead.
    const success = await api()
      .post('/api/auth/login')
      .set('X-Forwarded-For', ip)
      .send({ email: testEmail, password: testPassword, clinicSlug: testClinicSlug })
    expect(success.status).toBe(200)

    // If the success had been counted as a failure, the budget would already
    // be at zero and this next failure would 429. It must still be allowed.
    const stillAllowed = await api()
      .post('/api/auth/login')
      .set('X-Forwarded-For', ip)
      .send({ email: testEmail, password: wrongPassword, clinicSlug: testClinicSlug })
    expect(stillAllowed.status).toBe(401)

    // Only NOW is the 10-failure budget spent.
    const nowBlocked = await api()
      .post('/api/auth/login')
      .set('X-Forwarded-For', ip)
      .send({ email: testEmail, password: wrongPassword, clinicSlug: testClinicSlug })
    expect(nowBlocked.status).toBe(429)
  })

  it('returns an identical 429 body whether the account exists (wrong password), does not exist, or the clinic does not exist', async () => {
    async function exhaustAccountBudget(ip: string, body: Record<string, string>) {
      for (let i = 0; i < 10; i++) {
        const response = await api().post('/api/auth/login').set('X-Forwarded-For', ip).send(body)
        expect(response.status).toBe(401)
      }
      const eleventh = await api().post('/api/auth/login').set('X-Forwarded-For', ip).send(body)
      expect(eleventh.status).toBe(429)
      return eleventh.body
    }

    const wrongPasswordResponse = await exhaustAccountBudget('198.51.100.60', {
      email: testEmail,
      password: wrongPassword,
      clinicSlug: testClinicSlug,
    })
    const unknownEmailResponse = await exhaustAccountBudget('198.51.100.61', {
      email: 'no-such-account-418@test.com',
      password: wrongPassword,
      clinicSlug: testClinicSlug,
    })
    const unknownClinicResponse = await exhaustAccountBudget('198.51.100.62', {
      email: testEmail,
      password: wrongPassword,
      clinicSlug: 'no-such-clinic-418',
    })

    for (const body of [wrongPasswordResponse, unknownEmailResponse, unknownClinicResponse]) {
      expect(body.success).toBe(false)
      expect(body.error.code).toBe('RATE_LIMITED')
    }
    expect(wrongPasswordResponse.error.message).toBe(unknownEmailResponse.error.message)
    expect(wrongPasswordResponse.error.message).toBe(unknownClinicResponse.error.message)
  })

  it('a malformed payload with no usable email never trips (or spends) the account bucket', async () => {
    const ip = '198.51.100.70'
    // 12 requests: two more than the account limit of 10, all missing `email`.
    for (let i = 0; i < 12; i++) {
      const response = await api()
        .post('/api/auth/login')
        .set('X-Forwarded-For', ip)
        .send({ password: wrongPassword, clinicSlug: testClinicSlug })
      expect(response.status).toBe(400)
      expect(response.body.error.code).toBe('INVALID_PAYLOAD')
    }

    // A real (wrong-password) attempt from the SAME IP right after still gets
    // its full budget: the malformed traffic above spent nothing.
    const firstRealFailure = await api()
      .post('/api/auth/login')
      .set('X-Forwarded-For', ip)
      .send({ email: testEmail, password: wrongPassword, clinicSlug: testClinicSlug })
    expect(firstRealFailure.status).toBe(401)
  })

  it('treats different-case emails as the same account bucket', async () => {
    const ip = '198.51.100.80'
    const upperCaseEmail = 'CaseUser418@Test.com'
    const lowerCaseEmail = 'caseuser418@test.com'

    for (let i = 0; i < 5; i++) {
      const response = await api()
        .post('/api/auth/login')
        .set('X-Forwarded-For', ip)
        .send({ email: upperCaseEmail, password: wrongPassword, clinicSlug: testClinicSlug })
      expect(response.status).toBe(401)
    }
    for (let i = 0; i < 5; i++) {
      const response = await api()
        .post('/api/auth/login')
        .set('X-Forwarded-For', ip)
        .send({ email: lowerCaseEmail, password: wrongPassword, clinicSlug: testClinicSlug })
      expect(response.status).toBe(401)
    }

    // 10 combined failures (5 + 5) have already spent the whole budget: an
    // 11th attempt, in either case, must be blocked — proving the two case
    // variants share one bucket rather than getting 10 each.
    const eleventh = await api()
      .post('/api/auth/login')
      .set('X-Forwarded-For', ip)
      .send({ email: upperCaseEmail, password: wrongPassword, clinicSlug: testClinicSlug })
    expect(eleventh.status).toBe(429)
  })

  it('is independent of the #416 forgot-password / reset-password buckets, in both directions', async () => {
    const loginBody = { email: testEmail, password: wrongPassword, clinicSlug: testClinicSlug }
    for (let i = 0; i < 10; i++) {
      await api().post('/api/auth/login').send(loginBody)
    }
    const eleventhLogin = await api().post('/api/auth/login').send(loginBody)
    expect(eleventhLogin.status).toBe(429)

    // forgot-password for the very same email + clinicSlug is unaffected.
    const forgotAfterLoginExhausted = await api()
      .post('/api/auth/forgot-password')
      .send({ email: testEmail, clinicSlug: testClinicSlug })
    expect(forgotAfterLoginExhausted.status).toBe(200)

    // And the reverse: exhausting forgot-password must not touch login.
    await forgotPasswordRateLimitStore.resetAll()
    for (let i = 0; i < 10; i++) {
      await api().post('/api/auth/forgot-password').send({ email: testEmail, clinicSlug: testClinicSlug })
    }
    const eleventhForgot = await api()
      .post('/api/auth/forgot-password')
      .send({ email: testEmail, clinicSlug: testClinicSlug })
    expect(eleventhForgot.status).toBe(429)

    await loginAccountRateLimitStore.resetAll()
    await loginIpRateLimitStore.resetAll()
    const loginAfterForgotExhausted = await api()
      .post('/api/auth/login')
      .send({ email: testEmail, password: testPassword, clinicSlug: testClinicSlug })
    expect(loginAfterForgotExhausted.status).toBe(200)
  })
})

// Task #425: pin-login rate limiting. POST /api/auth/pin-login guards a
// 4-digit secret whose success mints a profile token carrying the TARGET's
// role, so an unlimited endpoint let any authenticated kiosk session escalate
// by guessing. Two chained limiters run after requireAuth (both keys read
// req.user): a TARGET bucket keyed `${tenantId}:${body.userId}` (limit 10) and
// a CALLER bucket keyed `${tenantId}:${req.user.userId}` (limit 30). Only a 401
// spends budget. MemoryStore backs both under test, so resetAll() works.
describe('Task #425: pin-login rate limiting', () => {
  let tenantId: string
  let callerUserId: string
  let callerToken: string
  let secondCallerUserId: string
  let secondCallerToken: string
  let targetAId: string
  let targetBId: string
  const correctPin = '9999'
  const wrongPin = '0000'
  const testClinicSlug = `pin-login-rl-${Date.now()}`
  const createdUserIds: string[] = []

  // These cases spend 10-30 failures each; at the production cost factor (12)
  // every wrong-PIN attempt costs a full bcrypt compare (~1s on a loaded dev
  // host), which would push a single case past vitest's 30s timeout. The cost
  // factor is a property of the stored hash, not of the code under test:
  // verifyPassword still runs a real bcrypt.compare against a real hash here,
  // only cheaply. Nothing about the limiter's behaviour depends on it.
  const hashPinCheaply = (pin: string) => bcrypt.hash(pin, 4)

  type TenantRole = 'OWNER' | 'ADMIN' | 'CLINIC_ADMIN' | 'DOCTOR' | 'STAFF'

  function accessToken(userId: string, email: string, role: TenantRole) {
    // This codebase reads req.user.userId (not `sub`), and the caller-dimension
    // rate limit key is built from it.
    return sign({ userId, tenantId, email, role }, process.env.JWT_SECRET as string, {
      expiresIn: '1h',
    })
  }

  async function createUser(email: string, role: TenantRole, pin?: string) {
    const user = await prisma.user.create({
      data: {
        tenantId,
        email,
        firstName: 'Pin',
        lastName: 'RateLimit',
        passwordHash: await hashPassword('Password1!'),
        role,
        ...(pin ? { pinHash: await hashPinCheaply(pin) } : {}),
      },
    })
    createdUserIds.push(user.id)
    return user.id
  }

  function pinAttempt(
    userId: unknown,
    pin: string,
    opts: { token?: string; profileToken?: string } = {}
  ) {
    const req = api()
      .post('/api/auth/pin-login')
      .set('Authorization', `Bearer ${opts.token ?? callerToken}`)
    if (opts.profileToken) req.set('X-Profile-Token', opts.profileToken)
    return req.send({ userId, pin })
  }

  beforeAll(async () => {
    const tenant = await prisma.tenant.create({
      data: { name: 'Pin Login Rate Limit Clinic', slug: testClinicSlug },
    })
    tenantId = tenant.id

    callerUserId = await createUser('pin-rl-caller@test.com', 'STAFF')
    callerToken = accessToken(callerUserId, 'pin-rl-caller@test.com', 'STAFF')

    secondCallerUserId = await createUser('pin-rl-caller-2@test.com', 'STAFF')
    secondCallerToken = accessToken(secondCallerUserId, 'pin-rl-caller-2@test.com', 'STAFF')

    targetAId = await createUser('pin-rl-target-a@test.com', 'OWNER', correctPin)
    targetBId = await createUser('pin-rl-target-b@test.com', 'ADMIN', correctPin)
  })

  afterAll(async () => {
    await prisma.refreshToken.deleteMany({ where: { userId: { in: createdUserIds } } })
    await prisma.user.deleteMany({ where: { tenantId } })
    await prisma.tenantSettings.deleteMany({ where: { tenantId } })
    await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {
      // Tenant may already be gone.
    })
  })

  beforeEach(async () => {
    // Both buckets live in one MemoryStore-backed module instance for the whole
    // file, so hits from an earlier case would otherwise carry over and 429 at
    // an unexpected request count. Resetting here — rather than disabling the
    // limiter under NODE_ENV === 'test', which #254 ruled out — is what keeps
    // every other test in this file (and pin.test.ts) unaffected.
    await pinLoginTargetRateLimitStore.resetAll()
    await pinLoginSessionRateLimitStore.resetAll()
  })

  it(
    'returns 401 for the first 10 failed PIN attempts against one profile and 429 on the 11th',
    async () => {
      for (let i = 0; i < 10; i++) {
        const response = await pinAttempt(targetAId, wrongPin)
        expect(response.status).toBe(401)
        expect(response.body.error.code).toBe('INVALID_CREDENTIALS')
      }

      const eleventh = await pinAttempt(targetAId, wrongPin)
      expect(eleventh.status).toBe(429)
      expect(eleventh.body.error.code).toBe('RATE_LIMITED')
    },
    60_000
  )

  it(
    'does not spend budget on a successful PIN entry (10 successes then a failure is still 401)',
    async () => {
      for (let i = 0; i < 10; i++) {
        const response = await pinAttempt(targetAId, correctPin)
        expect(response.status).toBe(200)
        expect(response.body).toHaveProperty('profileToken')
      }

      // If successes had been counted, the target bucket (limit 10) would be
      // empty and this would 429. Only failures spend budget.
      const failureAfterSuccesses = await pinAttempt(targetAId, wrongPin)
      expect(failureAfterSuccesses.status).toBe(401)
      expect(failureAfterSuccesses.body.error.code).toBe('INVALID_CREDENTIALS')
    },
    60_000
  )

  it(
    'gives each target its own budget: exhausting one profile does not throttle another from the same session',
    async () => {
      for (let i = 0; i < 10; i++) {
        expect((await pinAttempt(targetAId, wrongPin)).status).toBe(401)
      }
      expect((await pinAttempt(targetAId, wrongPin)).status).toBe(429)

      // Target B, same caller session, same tenant: a full, untouched budget of
      // 10 failures. This is what proves the target key is the TARGET and not a
      // composite (caller, target) — under a composite key B would inherit
      // nothing either, but under a CALLER-only target key B's first attempt
      // would already be 429.
      for (let i = 0; i < 10; i++) {
        const response = await pinAttempt(targetBId, wrongPin)
        expect(response.status).toBe(401)
        expect(response.body.error.code).toBe('INVALID_CREDENTIALS')
      }
      // ...and B is then exhausted on its own account, independently of A.
      expect((await pinAttempt(targetBId, wrongPin)).status).toBe(429)
    },
    120_000
  )

  it('429s the 31st failure from one session even when every attempt targets a different profile', async () => {
    // 30 distinct targets, one failure each: no single target bucket gets past
    // 1 of its 10, so only the caller-dimension limiter can catch this.
    for (let i = 0; i < 30; i++) {
      const response = await pinAttempt(`no-such-profile-${i}`, wrongPin)
      expect(response.status).toBe(401)
      expect(response.body.error.code).toBe('INVALID_CREDENTIALS')
    }

    const thirtyFirst = await pinAttempt('no-such-profile-30', wrongPin)
    expect(thirtyFirst.status).toBe(429)
    expect(thirtyFirst.body.error.code).toBe('RATE_LIMITED')

    // A different session in the SAME tenant is untouched: the key is the base
    // session user, not the tenant (one exhausted kiosk must not lock the clinic).
    const otherSession = await pinAttempt('no-such-profile-31', wrongPin, {
      token: secondCallerToken,
    })
    expect(otherSession.status).toBe(401)
  })

  it('does not let a caller reset the caller-dimension budget by presenting a different X-Profile-Token', async () => {
    const profileToken = generateProfileToken({
      profileUserId: targetAId,
      role: 'OWNER',
      tenantId,
    })

    for (let i = 0; i < 30; i++) {
      expect((await pinAttempt(`rotate-${i}`, wrongPin)).status).toBe(401)
    }

    // middleware/auth.ts overwrites only role and profileUserId from a profile
    // token, so req.user.userId — and therefore the caller key — is still the
    // base session's. The same request that would be a fresh bucket under a
    // profileUserId-based key must stay blocked.
    const withProfileToken = await pinAttempt('rotate-30', wrongPin, { profileToken })
    expect(withProfileToken.status).toBe(429)
    expect(withProfileToken.body.error.code).toBe('RATE_LIMITED')

    // Control: the very same request is a plain 401 once the buckets are
    // cleared, which proves the 429 above came from the limiter and not from
    // the profile token being rejected (that path is a 403 PROFILE_TOKEN_EXPIRED).
    await pinLoginTargetRateLimitStore.resetAll()
    await pinLoginSessionRateLimitStore.resetAll()
    const afterReset = await pinAttempt('rotate-30', wrongPin, { profileToken })
    expect(afterReset.status).toBe(401)
    expect(afterReset.body.error.code).toBe('INVALID_CREDENTIALS')
  })

  it('answers with the project-standard RATE_LIMITED body from both the target and the caller limiter', async () => {
    for (let i = 0; i < 10; i++) {
      expect((await pinAttempt('body-shape-target', wrongPin)).status).toBe(401)
    }
    const targetLimited = await pinAttempt('body-shape-target', wrongPin)

    // Free the target bucket, then rotate targets until the caller ceiling
    // (30) trips instead. 10 failures are already on the caller bucket above —
    // a request blocked by the target limiter never reaches the caller one.
    await pinLoginTargetRateLimitStore.resetAll()
    for (let i = 0; i < 20; i++) {
      expect((await pinAttempt(`body-shape-rotate-${i}`, wrongPin)).status).toBe(401)
    }
    const callerLimited = await pinAttempt('body-shape-rotate-20', wrongPin)

    for (const response of [targetLimited, callerLimited]) {
      expect(response.status).toBe(429)
      expect(response.body).toEqual({
        success: false,
        error: {
          message: expect.any(String),
          code: 'RATE_LIMITED',
          retryAfter: expect.any(Number),
        },
      })
      // retryAfter is seconds, not milliseconds: the window is 15 minutes.
      expect(response.body.error.retryAfter).toBeGreaterThan(0)
      expect(response.body.error.retryAfter).toBeLessThanOrEqual(15 * 60)
    }
    expect(targetLimited.body.error.message).toBe(callerLimited.body.error.message)
  })

  it(
    'keeps a wrong PIN and an unknown userId indistinguishable, and charges budget for both',
    async () => {
      const wrongPinFirst = await pinAttempt(targetAId, wrongPin)
      const unknownUserFirst = await pinAttempt('no-such-profile-enumeration', wrongPin)

      expect(wrongPinFirst.status).toBe(401)
      expect(unknownUserFirst.status).toBe(401)
      expect(wrongPinFirst.body).toEqual(unknownUserFirst.body)
      expect(wrongPinFirst.body.error.code).toBe('INVALID_CREDENTIALS')

      // Both spent one hit of their own target bucket: 9 more each exhausts it.
      for (let i = 0; i < 9; i++) {
        expect((await pinAttempt(targetAId, wrongPin)).status).toBe(401)
        expect((await pinAttempt('no-such-profile-enumeration', wrongPin)).status).toBe(401)
      }

      const wrongPinBlocked = await pinAttempt(targetAId, wrongPin)
      const unknownUserBlocked = await pinAttempt('no-such-profile-enumeration', wrongPin)
      expect(wrongPinBlocked.status).toBe(429)
      expect(unknownUserBlocked.status).toBe(429)
      expect(wrongPinBlocked.body).toEqual(unknownUserBlocked.body)
    },
    60_000
  )

  it('never spends target budget on a payload with no usable userId', async () => {
    // 12 requests: two past the target limit, none of them a PIN guess. The
    // limiter skips them entirely rather than keying on a fallback constant.
    for (let i = 0; i < 12; i++) {
      const response = await pinAttempt(undefined, wrongPin)
      expect(response.status).toBe(400)
      expect(response.body.error.code).toBe('INVALID_PAYLOAD')
    }

    // A real target still gets its full 10 failures afterwards.
    for (let i = 0; i < 10; i++) {
      expect((await pinAttempt('after-malformed-target', wrongPin)).status).toBe(401)
    }
    expect((await pinAttempt('after-malformed-target', wrongPin)).status).toBe(429)
  })

  it('does not spend pin-login budget on the #418 login buckets, or vice versa', async () => {
    for (let i = 0; i < 10; i++) {
      expect((await pinAttempt('independence-target', wrongPin)).status).toBe(401)
    }
    expect((await pinAttempt('independence-target', wrongPin)).status).toBe(429)

    await loginIpRateLimitStore.resetAll()
    await loginAccountRateLimitStore.resetAll()
    const login = await api()
      .post('/api/auth/login')
      .send({
        email: 'pin-rl-caller@test.com',
        password: 'Password1!',
        clinicSlug: testClinicSlug,
      })
    expect(login.status).toBe(200)
  })
})
