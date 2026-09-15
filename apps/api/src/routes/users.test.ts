import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import crypto from 'crypto'
import { api } from '../test/http.js'
import { prisma } from '@dental/database'
import { hashPassword } from '../services/auth.service.js'
import { generateToken, generateProfileToken } from '../test/tokens.js'

// PUT /api/users/:id applies the role hierarchy to a user's email and active
// status: a requester may change them on themselves, or on a user whose role
// is strictly lower than their own. Everything else is 403 and changes nothing.
//
// Every rejection below asserts BOTH the status and the unchanged row. A 403
// alone would still pass if the update had already been written before the
// response was chosen.
//
// When a PIN profile is active, the requester is the profile's person and role,
// not the shared login's. The kiosk cases pin that down in both directions.

describe('PUT /api/users/:id — role hierarchy for email and active status', () => {
  const run = crypto.randomBytes(4).toString('hex')
  const emailFor = (who: string) => `${who}-${run}@users-hierarchy.test`

  let tenantId: string
  const ids: Record<'owner' | 'admin' | 'otherAdmin' | 'staff', string> = {
    owner: '',
    admin: '',
    otherAdmin: '',
    staff: '',
  }

  beforeAll(async () => {
    const tenant = await prisma.tenant.create({
      data: { name: 'Users hierarchy', slug: `users-hierarchy-${run}` },
    })
    tenantId = tenant.id
    const passwordHash = await hashPassword('Password123!')

    for (const [key, role] of [
      ['owner', 'OWNER'],
      ['admin', 'ADMIN'],
      ['otherAdmin', 'ADMIN'],
      ['staff', 'STAFF'],
    ] as const) {
      const user = await prisma.user.create({
        data: { tenantId, email: emailFor(key), firstName: key, lastName: 'Hierarchy', passwordHash, role },
      })
      ids[key] = user.id
    }
  })

  afterAll(async () => {
    if (tenantId) {
      await prisma.user.deleteMany({ where: { tenantId } })
      await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {})
    }
  })

  async function stored(id: string) {
    return prisma.user.findUniqueOrThrow({ where: { id }, select: { email: true, isActive: true } })
  }

  function put(id: string, body: object, opts: { token: string; profileToken?: string }) {
    const req = api().put(`/api/users/${id}`).set('Authorization', `Bearer ${opts.token}`)
    if (opts.profileToken) req.set('X-Profile-Token', opts.profileToken)
    return req.send(body)
  }

  const adminToken = () => generateToken(ids.admin, tenantId, 'ADMIN')

  it('rejects changing the email of a user with a higher role', async () => {
    const res = await put(ids.owner, { email: emailFor('changed-owner') }, { token: adminToken() })

    expect(res.status).toBe(403)
    expect((await stored(ids.owner)).email).toBe(emailFor('owner'))
  })

  it('rejects changing the active status of a user with a higher role', async () => {
    const res = await put(ids.owner, { isActive: false }, { token: adminToken() })

    expect(res.status).toBe(403)
    expect((await stored(ids.owner)).isActive).toBe(true)
  })

  it('rejects changing the email of a user with an equal role', async () => {
    const res = await put(ids.otherAdmin, { email: emailFor('changed-other-admin') }, { token: adminToken() })

    expect(res.status).toBe(403)
    expect((await stored(ids.otherAdmin)).email).toBe(emailFor('otherAdmin'))
  })

  it('allows changing the email and active status of a user with a strictly lower role', async () => {
    const res = await put(ids.staff, { email: emailFor('staff-renamed'), isActive: false }, { token: adminToken() })

    expect(res.status).toBe(200)
    expect(await stored(ids.staff)).toEqual({ email: emailFor('staff-renamed'), isActive: false })

    // Restore for any later case.
    await prisma.user.update({ where: { id: ids.staff }, data: { email: emailFor('staff'), isActive: true } })
  })

  it('allows a user to change their own email', async () => {
    const res = await put(ids.admin, { email: emailFor('admin-renamed') }, { token: adminToken() })

    expect(res.status).toBe(200)
    expect((await stored(ids.admin)).email).toBe(emailFor('admin-renamed'))

    await prisma.user.update({ where: { id: ids.admin }, data: { email: emailFor('admin') } })
  })

  describe('with a PIN profile active, the requester is the profile, not the login', () => {
    it('rejects a lower-role profile changing the email of the account whose login it is using', async () => {
      // The terminal is signed in as the OWNER; an ADMIN has unlocked their
      // profile on it. The login's userId is the OWNER's, but the person acting
      // is the ADMIN, so this is not a change to "their own" account.
      const res = await put(
        ids.owner,
        { email: emailFor('changed-owner-kiosk') },
        {
          token: generateToken(ids.owner, tenantId, 'OWNER'),
          profileToken: generateProfileToken(ids.admin, tenantId, 'ADMIN'),
        }
      )

      expect(res.status).toBe(403)
      expect((await stored(ids.owner)).email).toBe(emailFor('owner'))
    })

    it("allows a profile to change its own person's email on another user's login", async () => {
      const res = await put(
        ids.admin,
        { email: emailFor('admin-renamed-kiosk') },
        {
          token: generateToken(ids.owner, tenantId, 'OWNER'),
          profileToken: generateProfileToken(ids.admin, tenantId, 'ADMIN'),
        }
      )

      expect(res.status).toBe(200)
      expect((await stored(ids.admin)).email).toBe(emailFor('admin-renamed-kiosk'))

      await prisma.user.update({ where: { id: ids.admin }, data: { email: emailFor('admin') } })
    })

    it("rejects a profile below the route's minimum role on a higher-role login, even for its own account", async () => {
      // An ADMIN terminal with a STAFF profile unlocked, changing the STAFF
      // person's own email. The route's minimum-role gate evaluates the
      // profile's role, so this is refused before the hierarchy is consulted —
      // "own account" does not get past it. It is here so that stays true; it
      // does not exercise the hierarchy check itself.
      const res = await put(
        ids.staff,
        { email: emailFor('changed-staff-kiosk') },
        {
          token: adminToken(),
          profileToken: generateProfileToken(ids.staff, tenantId, 'STAFF'),
        }
      )

      expect(res.status).toBe(403)
      expect((await stored(ids.staff)).email).toBe(emailFor('staff'))
    })
  })
})
