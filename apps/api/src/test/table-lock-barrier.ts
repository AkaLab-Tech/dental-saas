import { prisma } from '@dental/database'

// Task #442: a deterministic concurrency barrier for route tests.
//
// A plain `Promise.all` burst does NOT reliably interleave requests: measured
// against the unfixed recovery handlers, one burst in five (the cold start)
// showed no race at all, so a test built on it could pass while the bug was
// present. This makes the interleaving certain instead of likely.
//
// It holds `LOCK TABLE <table> IN SHARE MODE` in its own transaction. SHARE
// lets reads through and blocks INSERT/UPDATE/DELETE, so every request in the
// burst runs its read-only checks and then parks on its first write. Once all
// of them are either parked or have already responded, the lock is released
// and they proceed together — the worst-case interleaving, every time.
//
// Two properties are load-bearing, and both exist because getting them wrong
// fails somewhere else, slowly:
//
//   * The lock is released in a `finally`. If an assertion or the wait below
//     throws while it is held, a leaked SHARE lock blocks every later write to
//     the table and surfaces as a 30s timeout in an unrelated test.
//   * The wait has its own deadline and THROWS on it. It never falls through
//     to the release: a barrier that released early would let the requests run
//     sequentially and the test would pass for the wrong reason.
//
// Safe only because vitest.config.ts runs the suite in a single fork. If that
// ever changes, a table lock here becomes cross-file interference.

/** Tables a barrier may lock. A fixed union, because the name is interpolated. */
export type BarrierTable = 'password_reset_tokens'

export interface BarrierResult<T> {
  results: T[]
  /** Requests parked on the lock at the moment it was released. */
  parkedAtRelease: number
}

async function countParked(table: BarrierTable): Promise<number> {
  const rows = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT count(*)::bigint AS n
    FROM pg_locks l
    JOIN pg_class c ON c.oid = l.relation
    WHERE c.relname = ${table} AND NOT l.granted`
  return Number(rows[0].n)
}

/**
 * Fire `count` concurrent calls to `send` with writes to `table` blocked until
 * every call has either parked on the lock or already settled.
 */
export async function burstBehindTableLock<T>(
  table: BarrierTable,
  count: number,
  send: (index: number) => PromiseLike<T>,
  { deadlineMs = 10_000 }: { deadlineMs?: number } = {}
): Promise<BarrierResult<T>> {
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  let signalLocked!: () => void
  const locked = new Promise<void>((resolve) => {
    signalLocked = resolve
  })

  const holder = prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(`LOCK TABLE ${table} IN SHARE MODE`)
      signalLocked()
      await gate
    },
    { maxWait: 5_000, timeout: deadlineMs + 20_000 }
  )

  let settled = 0
  let inFlight: Promise<T>[] = []
  let parkedAtRelease = 0
  try {
    // If the holder fails before taking the lock, surface that instead of
    // waiting forever for a signal that will never come.
    await Promise.race([locked, holder.then(() => undefined)])

    inFlight = Array.from({ length: count }, (_, i) =>
      // Promise.resolve: a supertest request is thenable, not a Promise.
      Promise.resolve(send(i)).finally(() => {
        settled++
      })
    )

    const deadline = Date.now() + deadlineMs
    for (;;) {
      parkedAtRelease = await countParked(table)
      if (parkedAtRelease + settled >= count) break
      if (Date.now() > deadline) {
        throw new Error(
          `table-lock barrier: only ${parkedAtRelease} parked and ${settled} settled of ` +
            `${count} within ${deadlineMs}ms — the burst never reached its writes together`
        )
      }
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
  } finally {
    release()
    await holder.catch(() => {
      // The holder's own failure is not this test's result; the burst's is.
    })
    // Even on the throwing path the burst is already in flight and will write
    // once released. Let it finish here, or its rows land in the next test.
    await Promise.allSettled(inFlight)
  }

  return { results: await Promise.all(inFlight), parkedAtRelease }
}
