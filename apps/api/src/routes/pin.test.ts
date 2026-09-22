import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { api } from '../test/http.js'
import { prisma } from '@dental/database'
import { hashPassword } from '../services/auth.service.js'
import { sign } from 'jsonwebtoken'
import { generateToken, generateProfileToken } from '../test/tokens.js'

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret'

/** Shape of a single row of GET /api/auth/profiles. */
interface ProfileRow {
  id: string
  firstName: string
  lastName: string
  role: string
  avatar: string | null
  hasPinSet: boolean
  canSetupPin: boolean
}

describe('PIN Authentication Routes', () => {
  let tenantId: string
  let adminUserId: string
  let staffUserId: string
  let ownerUserId: string
  let adminToken: string
  let staffToken: string
  const testSlug = `test-pin-${Date.now()}`


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

    // Task #427: OWNER user with no PIN set yet, used to prove the
    // setup-pin escalation gate — a STAFF session must not be able to set
    // (or read anything about) an OWNER's PIN.
    const ownerUser = await prisma.user.create({
      data: {
        tenantId,
        email: 'owner@pin-test.com',
        firstName: 'Owner',
        lastName: 'User',
        passwordHash: hashedPassword,
        role: 'OWNER',
      },
    })
    ownerUserId = ownerUser.id
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
      const res = await api()
        .get('/api/auth/profiles')
        .set('Authorization', `Bearer ${adminToken}`)

      expect(res.status).toBe(200)
      expect(res.body).toBeInstanceOf(Array)
      // Scoped to this suite's own fixture ids rather than asserting a raw
      // count: the endpoint returns every active tenant user, so a count is
      // order- and neighbour-dependent — any later describe that adds a
      // fixture user (task #431's agreement matrix does) would break it for
      // reasons that have nothing to do with what this test checks.
      const ids = (res.body as ProfileRow[]).map((p) => p.id)
      expect(ids).toEqual(expect.arrayContaining([adminUserId, staffUserId, ownerUserId]))
      for (const id of [adminUserId, staffUserId, ownerUserId]) {
        expect(ids.filter((candidate) => candidate === id).length, `duplicate row for ${id}`).toBe(1)
      }

      const adminRow = (res.body as ProfileRow[]).find((p) => p.id === adminUserId)
      expect(adminRow).toHaveProperty('firstName')
      expect(adminRow).toHaveProperty('lastName')
      expect(adminRow).toHaveProperty('role')
      expect(adminRow).toHaveProperty('hasPinSet')
      expect(adminRow).not.toHaveProperty('email')
      expect(adminRow).not.toHaveProperty('pinHash')
    })

    it('should return 401 without JWT', async () => {
      const res = await api().get('/api/auth/profiles')

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

      const res = await api()
        .get('/api/auth/profiles')
        .set('Authorization', `Bearer ${adminToken}`)

      expect(res.status).toBe(200)
      const ids = (res.body as ProfileRow[]).map((p) => p.id)
      expect(ids).not.toContain(inactiveUser.id)

      await prisma.user.delete({ where: { id: inactiveUser.id } })
    })
  })

  // ==========================================
  // PUT /api/users/:id/pin
  // ==========================================

  describe('PUT /api/users/:id/pin', () => {
    it('should allow user to set their own PIN', async () => {
      const res = await api()
        .put(`/api/users/${staffUserId}/pin`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ pin: '1234' })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
    })

    it('should allow ADMIN to set PIN for another user', async () => {
      const res = await api()
        .put(`/api/users/${staffUserId}/pin`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ pin: '5678' })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
    })

    it('should reject non-ADMIN setting PIN for another user', async () => {
      const res = await api()
        .put(`/api/users/${adminUserId}/pin`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ pin: '1234' })

      expect(res.status).toBe(403)
    })

    it('should reject invalid PIN format', async () => {
      const res = await api()
        .put(`/api/users/${staffUserId}/pin`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ pin: '12' })

      expect(res.status).toBe(400)
    })

    it('should reject non-numeric PIN', async () => {
      const res = await api()
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
      const res = await api()
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
      const res = await api()
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

      const res = await api()
        .post('/api/auth/pin-login')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ userId: staffUserId, pin: '1234' })

      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('PIN_NOT_SET')
    })

    it('should reject unknown user', async () => {
      const res = await api()
        .post('/api/auth/pin-login')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ userId: 'nonexistent-user', pin: '1234' })

      expect(res.status).toBe(401)
      expect(res.body.error.code).toBe('INVALID_CREDENTIALS')
    })

    it('should return 401 without JWT', async () => {
      const res = await api()
        .post('/api/auth/pin-login')
        .send({ userId: adminUserId, pin: '9999' })

      expect(res.status).toBe(401)
    })

    it('should reject invalid PIN format', async () => {
      const res = await api()
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

      const res = await api()
        .post('/api/auth/setup-pin')
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ userId: staffUserId, pin: '4321' })

      expect(res.status).toBe(200)
      expect(res.body).toHaveProperty('profileToken')
      expect(res.body.user).toHaveProperty('id', staffUserId)
      expect(res.body.user).toHaveProperty('hasPinSet', true)
    })

    it('should reject if PIN already set', async () => {
      const res = await api()
        .post('/api/auth/setup-pin')
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ userId: staffUserId, pin: '1111' })

      expect(res.status).toBe(409)
      expect(res.body.error.code).toBe('PIN_ALREADY_SET')
    })

    it('should return 401 without JWT', async () => {
      const res = await api()
        .post('/api/auth/setup-pin')
        .send({ userId: staffUserId, pin: '1234' })

      expect(res.status).toBe(401)
    })

    it('should reject invalid PIN format', async () => {
      const res = await api()
        .post('/api/auth/setup-pin')
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ userId: staffUserId, pin: 'ab' })

      expect(res.status).toBe(400)
    })

    // Task #427: setup-pin was a one-request privilege escalation — any
    // authenticated tenant user could set *any* colleague's first PIN and
    // walk away with a profileToken carrying that colleague's role. The fix
    // gates the write on isSelf || hasMinRole(ADMIN), checked before the
    // user lookup and before any write.
    it('should reject a STAFF session setting an OWNER PIN, without writing the PIN or returning a profileToken', async () => {
      const res = await api()
        .post('/api/auth/setup-pin')
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ userId: ownerUserId, pin: '7777' })

      expect(res.status).toBe(403)
      expect(res.body).toEqual({
        success: false,
        error: { message: 'Insufficient permissions', code: 'FORBIDDEN' },
      })
      expect(res.body.profileToken).toBeUndefined()

      // The gate must run before the write: prove the PIN was never
      // persisted, not merely that the response was a 403.
      const ownerAfter = await prisma.user.findUnique({ where: { id: ownerUserId } })
      expect(ownerAfter?.pinHash).toBeNull()
    })

    it('should let an ADMIN provision another user first PIN, but withhold the profileToken', async () => {
      const targetUser = await prisma.user.create({
        data: {
          tenantId,
          email: 'provisioned-target@pin-test.com',
          firstName: 'Provisioned',
          lastName: 'Target',
          passwordHash: await hashPassword('Password123!'),
          role: 'STAFF',
        },
      })
      expect(targetUser.pinHash).toBeNull()

      const res = await api()
        .post('/api/auth/setup-pin')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ userId: targetUser.id, pin: '8642' })

      expect(res.status).toBe(200)
      expect(res.body.profileToken).toBeUndefined()
      expect(res.body.user).toHaveProperty('id', targetUser.id)
      expect(res.body.user).toHaveProperty('hasPinSet', true)

      // The PIN really was set — this is the half of the behavior that must
      // keep working.
      const targetAfter = await prisma.user.findUnique({ where: { id: targetUser.id } })
      expect(targetAfter?.pinHash).not.toBeNull()
    })
  })

  // ==========================================
  // GET /api/auth/me (hasPinSet)
  // ==========================================

  describe('GET /api/auth/me (hasPinSet)', () => {
    it('should include hasPinSet in response', async () => {
      const res = await api()
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${adminToken}`)

      expect(res.status).toBe(200)
      expect(res.body).toHaveProperty('hasPinSet')
    })

    it('should not include pinHash in response', async () => {
      const res = await api()
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
      const loginRes = await api()
        .post('/api/auth/pin-login')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ userId: adminUserId, pin: '9999' })

      expect(loginRes.status).toBe(200)
      const { profileToken } = loginRes.body

      // Use profile token on an endpoint that uses requireAuth
      const res = await api()
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

      const res = await api()
        .get('/api/auth/profiles')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Profile-Token', invalidToken)

      expect(res.status).toBe(403)
      expect(res.body.error.code).toBe('PROFILE_TOKEN_EXPIRED')
    })
  })

  // ==========================================
  // Task #431: canSetupPin on GET /auth/profiles
  // ==========================================
  //
  // The kiosk used to offer "set up a PIN" to any profile with no PIN, then
  // hit the #427 gate on submit and tell the operator to retry a thing they
  // can never do. The fix publishes the gate's own verdict per row as
  // `canSetupPin`, computed by the same `canProvisionPin()` helper the
  // setup-pin route calls.
  //
  // The criterion below is deliberately not "the flag looks right" and not
  // "the endpoint 403s": it is that the two ALWAYS AGREE. Testing them apart
  // and eyeballing the match would pass even if each call site kept its own
  // copy of the rule and the copies drifted.
  describe('canSetupPin (task #431)', () => {
    let callerStaffId: string
    let callerStaffToken: string
    let callerAdminId: string
    let callerAdminToken: string
    let targetOwnerId: string
    let targetDoctorId: string

    const createdIds: string[] = []

    async function createFixtureUser(
      role: 'OWNER' | 'ADMIN' | 'DOCTOR' | 'STAFF',
      label: string
    ): Promise<string> {
      const user = await prisma.user.create({
        data: {
          tenantId,
          email: `${label}-431@pin-test.com`,
          firstName: label,
          lastName: '431',
          passwordHash: await hashPassword('Password123!'),
          role,
        },
      })
      createdIds.push(user.id)
      return user.id
    }

    beforeAll(async () => {
      callerStaffId = await createFixtureUser('STAFF', 'caller-staff')
      callerStaffToken = generateToken(callerStaffId, tenantId, 'STAFF')
      callerAdminId = await createFixtureUser('ADMIN', 'caller-admin')
      callerAdminToken = generateToken(callerAdminId, tenantId, 'ADMIN')
      targetOwnerId = await createFixtureUser('OWNER', 'target-owner')
      targetDoctorId = await createFixtureUser('DOCTOR', 'target-doctor')
    })

    afterAll(async () => {
      await prisma.refreshToken.deleteMany({ where: { userId: { in: createdIds } } })
      await prisma.user.deleteMany({ where: { id: { in: createdIds } } })
    })

    /** The three callers whose authority the flag has to describe. */
    function callers(): { name: string; headers: Record<string, string> }[] {
      return [
        {
          name: 'STAFF base session',
          headers: { Authorization: `Bearer ${callerStaffToken}` },
        },
        {
          name: 'ADMIN base session',
          headers: { Authorization: `Bearer ${callerAdminToken}` },
        },
        {
          // The effective role is the profile's: requireAuth overwrites
          // req.user.role from the profile token while leaving userId on the
          // base session. A STAFF terminal switched into an ADMIN profile is
          // therefore an ADMIN for this decision.
          name: 'ADMIN profile token over a STAFF base session',
          headers: {
            Authorization: `Bearer ${callerStaffToken}`,
            'X-Profile-Token': generateProfileToken(callerAdminId, tenantId, 'ADMIN'),
          },
        },
      ]
    }

    function targetIds(): string[] {
      return [callerStaffId, callerAdminId, targetOwnerId, targetDoctorId]
    }

    async function fetchProfiles(headers: Record<string, string>): Promise<ProfileRow[]> {
      const res = await api().get('/api/auth/profiles').set(headers)
      expect(res.status).toBe(200)
      return res.body as ProfileRow[]
    }

    /**
     * Attempt the write and immediately undo it, so every cell of the matrix
     * starts from the same "no PIN yet" state regardless of the previous one.
     */
    async function attemptSetupPin(headers: Record<string, string>, targetId: string) {
      const res = await api()
        .post('/api/auth/setup-pin')
        .set(headers)
        .send({ userId: targetId, pin: '2468' })
      await prisma.user.updateMany({ where: { id: targetId }, data: { pinHash: null } })
      return res
    }

    it('reports true only on the caller own row for a STAFF session', async () => {
      const rows = await fetchProfiles({ Authorization: `Bearer ${callerStaffToken}` })

      const byId = new Map(rows.map((r) => [r.id, r]))
      expect(byId.get(callerStaffId)?.canSetupPin).toBe(true)
      expect(byId.get(callerAdminId)?.canSetupPin).toBe(false)
      expect(byId.get(targetOwnerId)?.canSetupPin).toBe(false)
      expect(byId.get(targetDoctorId)?.canSetupPin).toBe(false)
      // Not a single stray true anywhere else in the tenant either.
      const allowed = rows.filter((r) => r.canSetupPin).map((r) => r.id)
      expect(allowed).toEqual([callerStaffId])
    })

    it('reports true on every row for an ADMIN session', async () => {
      const rows = await fetchProfiles({ Authorization: `Bearer ${callerAdminToken}` })

      expect(rows.length).toBeGreaterThan(1)
      expect(rows.filter((r) => !r.canSetupPin)).toEqual([])
    })

    it('reports true on every row when an ADMIN profile token is layered over a STAFF base session', async () => {
      const [, , profileCaller] = callers()
      const rows = await fetchProfiles(profileCaller.headers)

      expect(rows.length).toBeGreaterThan(1)
      expect(rows.filter((r) => !r.canSetupPin)).toEqual([])
      // The base session alone would see exactly one true — proving the
      // profile token, not the base token, decided this.
      const baseRows = await fetchProfiles({ Authorization: `Bearer ${callerStaffToken}` })
      expect(baseRows.filter((r) => r.canSetupPin).map((r) => r.id)).toEqual([callerStaffId])
    })

    it('agrees with POST /auth/setup-pin for every caller/target pair', async () => {
      const disagreements: string[] = []
      const observed: string[] = []

      for (const caller of callers()) {
        const rows = await fetchProfiles(caller.headers)
        for (const targetId of targetIds()) {
          const row = rows.find((r) => r.id === targetId)
          expect(row, `${caller.name}: no /profiles row for ${targetId}`).toBeDefined()

          const res = await attemptSetupPin(caller.headers, targetId)
          const forbidden = res.status === 403
          observed.push(`${caller.name} -> ${targetId}: canSetupPin=${row!.canSetupPin} status=${res.status}`)
          // Strict, not `forbidden === canSetupPin` inverted: an absent
          // field is `undefined`, which is unequal to both booleans and
          // would make this whole matrix pass vacuously.
          if (row!.canSetupPin !== !forbidden) {
            disagreements.push(
              `${caller.name} -> ${targetId}: canSetupPin=${row!.canSetupPin} but setup-pin returned ${res.status}`
            )
          }
          if (forbidden) {
            expect(res.body.error.code).toBe('FORBIDDEN')
          }
        }
      }

      expect(disagreements, `flag and gate disagree:\n${observed.join('\n')}`).toEqual([])
      // Guard against a vacuous pass: the matrix must have exercised both
      // verdicts, not twelve allowed cells.
      expect(observed.filter((line) => line.includes('status=403')).length).toBe(3)
    })
  })
})
