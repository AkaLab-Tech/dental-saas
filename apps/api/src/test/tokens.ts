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
 * Six local mints are deliberately kept and are not violations of that rule.
 * The list is derived from
 * `git grep -nE "(^|[^a-zA-Z.])(jwt\.)?sign\(" -- apps/api/src`, not from
 * memory — an earlier version of this comment named four, because the query
 * that produced it was shaped by the instances already in mind and missed
 * every `jwt.sign(` and every multi-line call:
 *
 *   settings.test.ts, export.test.ts   payload-object signature, and a
 *                                      different JWT secret default
 *   middleware/ownership.test.ts       a middleware test, different arity, and
 *                                      its comment about userId vs sub is TRUE
 *   routes/auth.test.ts                tokens are the subject of the suite, and
 *                                      its helper also carries `email`
 *   routes/admin/stats.test.ts         SUPER_ADMIN with `tenantId: null`, a
 *                                      shape this helper's signature cannot
 *                                      express
 *   routes/pin.test.ts                 an EXPIRED profile token, the subject of
 *                                      an expiry test
 *
 * None ever had the `sub` bug.
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
