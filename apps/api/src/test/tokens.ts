import { sign } from 'jsonwebtoken'

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret'

/**
 * Task #447: the ONE place route tests mint auth tokens.
 *
 * It exists because there were fourteen copies of this function across ten
 * files and every one of them signed `sub` instead of `userId`. The middleware
 * assigns the decoded payload straight to `req.user` (middleware/auth.ts), so
 * `req.user.userId` — read at nineteen production sites, including every
 * `createdBy` / `createdById` / `actorUserId` — was `undefined` for every
 * request those suites made. The tokens still authenticated, because
 * `tenantId` and `role` are the claims the middleware and requirePermission
 * actually use, so nothing failed. Values silently became null and any
 * assertion about WHO did something passed vacuously.
 *
 * Keep this the only definition. Fourteen copies is how the wrong shape
 * spread, and a local copy is how it would come back.
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
