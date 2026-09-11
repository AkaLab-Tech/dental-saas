import { sign } from 'jsonwebtoken'

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret'

/**
 * Task #447: the ONE place route tests mint auth tokens.
 *
 * It exists because there were sixteen copies of this function across twelve
 * files, thirteen of which signed `sub` instead of `userId`. The middleware
 * assigns the decoded payload straight to `req.user` (middleware/auth.ts), so
 * `req.user.userId` — read at twenty production sites, including every
 * `createdBy` / `createdById` / `actorUserId` — was `undefined` for every
 * request those suites made. The tokens still authenticated, because
 * `tenantId` and `role` are the claims the middleware and requirePermission
 * actually use, so nothing failed. Values silently became null and any
 * assertion about WHO did something passed vacuously.
 *
 * Keep this the only definition **for route tests**. Sixteen copies is how the
 * wrong shape spread, and a local copy is how it would come back — including
 * the two `tokenWithUserId` arrows that existed in payments/appointments tests
 * purely to work around the bug this removes.
 *
 * Three local helpers are deliberately kept and are not violations of that
 * rule: `settings.test.ts` and `export.test.ts` take a payload object and use a
 * different JWT secret default, and `middleware/ownership.test.ts` is a
 * middleware test with a different arity whose own comment about `userId` vs
 * `sub` is true. None ever had the bug. `pin.test.ts` mints an expired profile
 * token as the SUBJECT of an expiry test, which this helper cannot express.
 */
export function generateToken(userId: string, tenantId: string, role: string): string {
  return sign({ userId, tenantId, role }, JWT_SECRET, { expiresIn: '1h' })
}

/**
 * A PIN-profile token, carried in the `X-Profile-Token` header alongside a
 * normal one. The middleware overwrites `role` and sets `profileUserId` from
 * it, which is the identity every actor-recording site prefers — under the
 * kiosk model the login names a terminal and only the profile names a person.
 */
export function generateProfileToken(profileUserId: string, tenantId: string, role: string): string {
  return sign({ profileUserId, tenantId, role, type: 'profile' }, JWT_SECRET, { expiresIn: '1h' })
}
