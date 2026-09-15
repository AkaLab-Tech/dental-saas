import { prisma, type Prisma } from '@dental/database'
import { hashToken } from './auth.service.js'
import { generateResetToken, getTokenExpiryDate } from '../utils/password-reset.js'

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
export async function checkResetSendAllowed(
  userId: string,
  // Task #442: the check must read through the same transaction that holds the
  // per-user lock — see issueResetTokenIfAllowed. Defaults to the global
  // client only for callers that do not issue a token.
  client: Prisma.TransactionClient = prisma
): Promise<ResetSendDecision> {
  const now = Date.now()
  const windowStart = new Date(now - RESET_SEND_CEILING_WINDOW_MS)

  // One round-trip serves both windows. The row count is bounded by the
  // ceiling itself: rows are only created when a send is allowed, so at most
  // RESET_SEND_MAX_PER_WINDOW of them can fall inside the window.
  const recent = await client.passwordResetToken.findMany({
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

/**
 * Task #442: advisory-lock namespace for recovery sends. Postgres advisory
 * locks share one keyspace across the whole database, so every caller picks a
 * namespace; this is the first in the codebase. The value is arbitrary and
 * must simply not be reused for a different purpose.
 */
export const RESET_SEND_LOCK_NAMESPACE = 442_415

export type IssueResetTokenResult =
  | { issued: true; plainToken: string }
  | { issued: false; reason: 'cooldown' | 'hourly-ceiling' | 'in-flight' }

/**
 * Task #442: the ONLY way a recovery token is issued. Both recovery routers
 * call this; neither may invalidate or create reset tokens itself.
 *
 * Why one function. {@link checkResetSendAllowed} only reads. When the check,
 * the invalidation and the create lived inline in each handler, concurrent
 * requests for one account all passed the check before any of them wrote:
 * one token and one email PER REQUEST, several of them left outstanding. So
 * the #415 bound held only against sequential requests, and the burst's own
 * invalidations raced each other — the victim could receive several links,
 * some already dead, in an order that is not the order they were issued.
 *
 * The fix makes check -> invalidate -> create exclusive per account, in one
 * transaction whose first statement is a per-user advisory lock.
 *
 * TRY, not blocking, and deliberately. A request that cannot take the lock
 * returns `in-flight` and the caller takes its ordinary suppressed branch —
 * another send for this account is already under way, which is exactly the
 * case the cooldown would suppress a moment later anyway. A BLOCKING lock (or
 * `SELECT ... FOR UPDATE` on the user row) would also serialize correctly, but
 * every waiter would hold a pool connection for as long as the lock holder's
 * transaction runs. With the transaction as short as it is today that costs
 * little, but a slow or stalled holder would let one account's burst tie up the
 * pool. `try` removes that dependency on the holder's speed. The barrier does
 * catch a blocking lock — the waiters neither park on the table nor respond,
 * so its deadline fails the test — but no test shows that harm; it rests on
 * this reasoning.
 *
 * ORDERING (#415), now enforced here rather than by a comment in two handlers:
 * the lock and the cooldown checks both return BEFORE the invalidation, so a
 * suppressed request — for any reason, `in-flight` included — never kills the
 * token already sitting in the user's inbox.
 *
 * Accepted cost: `hashtext` is 32-bit, so two different accounts can share a
 * lock key. The effect is that a request for one of them is suppressed as
 * `in-flight` if it arrives while a request for the other holds the lock —
 * i.e. overlaps that transaction, which lasts a few queries, not only the
 * same instant.
 *
 * Email sending is the caller's, after this returns, i.e. after commit: a send
 * is never made for a token whose transaction could still roll back.
 */
export async function issueResetTokenIfAllowed(userId: string): Promise<IssueResetTokenResult> {
  return prisma.$transaction(async (tx) => {
    const [{ locked }] = await tx.$queryRaw<{ locked: boolean }[]>`
      SELECT pg_try_advisory_xact_lock(${RESET_SEND_LOCK_NAMESPACE}::int4, hashtext(${userId})) AS locked`
    if (!locked) {
      return { issued: false, reason: 'in-flight' } as const
    }

    const decision = await checkResetSendAllowed(userId, tx)
    if (!decision.allowed) {
      return { issued: false, reason: decision.reason } as const
    }

    // Invalidate by setting usedAt, never by deleting: the used rows are the
    // cooldown's memory (see checkResetSendAllowed).
    await tx.passwordResetToken.updateMany({
      where: { userId, usedAt: null },
      data: { usedAt: new Date() },
    })

    const plainToken = generateResetToken()
    await tx.passwordResetToken.create({
      data: {
        userId,
        tokenHash: hashToken(plainToken),
        expiresAt: getTokenExpiryDate(),
      },
    })

    return { issued: true, plainToken } as const
  })
}
