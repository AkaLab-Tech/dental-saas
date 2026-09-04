import { prisma } from '@dental/database'

/*
 * Lives in services/, not beside the recovery helpers in
 * utils/password-reset.ts, because it reads the database. No file in utils/
 * imports prisma — that is an invariant of the directory, not a preference,
 * and this would have been the first. auth.service.ts is the precedent this
 * follows instead: a policy constant plus a DB-touching helper, imported by
 * both auth routers.
 */

/**
 * Task #415: per-account send cooldown for password recovery.
 *
 * The per-IP limiters on the recovery endpoints (#254, #416/#417) cap one
 * origin. They do nothing against a caller that rotates IPs, which is cheap
 * against an unauthenticated endpoint. This is the control keyed on the
 * TARGET ACCOUNT instead, and the two do not substitute for each other.
 *
 * It exists for two harms, and the second is the one usually missed:
 *
 *   1. Email bombing. Every accepted request sends real mail through Resend,
 *      so sustained abuse burns the shared sending domain's reputation —
 *      degrading transactional mail for every tenant, not just the target.
 *
 *   2. Denial of recovery. Both recovery handlers invalidate the user's
 *      outstanding tokens before issuing a new one. Uncapped, an attacker
 *      keeps killing whatever token the legitimate user is holding, so the
 *      link in their inbox is dead every time they click it. That is a
 *      targeted lockout of account recovery, requiring nothing to be guessed.
 *
 * The invalidate-then-issue design is correct on its own — it stops token
 * accumulation. It is the uncapped RATE that turns it into a lockout, which
 * is why the fix is here and not there.
 */

/** At most one recovery send per account per this window. */
export const RESET_SEND_COOLDOWN_MS = 2 * 60 * 1000

/** ...and at most this many sends per account per {@link RESET_SEND_CEILING_WINDOW_MS}. */
export const RESET_SEND_MAX_PER_WINDOW = 5
export const RESET_SEND_CEILING_WINDOW_MS = 60 * 60 * 1000

export type ResetSendDecision =
  | { allowed: true }
  | { allowed: false; reason: 'cooldown' | 'hourly-ceiling' }

/**
 * Decide whether a password-reset email may be sent for `userId` right now.
 *
 * Two windows, because one does not cover both harms: the short cooldown
 * bounds a burst, but on its own it still permits a slow indefinite drip that
 * keeps killing the victim's token. The hourly ceiling is what stops the drip.
 *
 * LOAD-BEARING, and not obvious from the schema: this reads
 * `PasswordResetToken.createdAt`, and it only works because the handlers
 * invalidate old tokens by setting `usedAt` rather than DELETING the rows.
 * The used rows ARE this cooldown's memory. A later "clean up used reset
 * tokens" change — an entirely reasonable thing to write — would delete that
 * memory and silently restore the vulnerability, with every test still green.
 * If such a cleanup is added, it must retain rows newer than
 * {@link RESET_SEND_CEILING_WINDOW_MS} or move this bookkeeping elsewhere.
 *
 * Keyed on `userId`, so the same email address in two tenants is two users
 * with two independent budgets (`@@unique([tenantId, email])` on `User`).
 */
export async function checkResetSendAllowed(userId: string): Promise<ResetSendDecision> {
  const now = Date.now()
  const windowStart = new Date(now - RESET_SEND_CEILING_WINDOW_MS)

  // One round-trip serves both windows. The row count is bounded by the
  // ceiling itself: rows are only created when a send is allowed, so at most
  // RESET_SEND_MAX_PER_WINDOW of them can fall inside the window.
  const recent = await prisma.passwordResetToken.findMany({
    where: { userId, createdAt: { gte: windowStart } },
    select: { createdAt: true },
    orderBy: { createdAt: 'desc' },
  })

  if (recent.length >= RESET_SEND_MAX_PER_WINDOW) {
    return { allowed: false, reason: 'hourly-ceiling' }
  }

  const mostRecent = recent[0]
  if (mostRecent && now - mostRecent.createdAt.getTime() < RESET_SEND_COOLDOWN_MS) {
    return { allowed: false, reason: 'cooldown' }
  }

  return { allowed: true }
}
