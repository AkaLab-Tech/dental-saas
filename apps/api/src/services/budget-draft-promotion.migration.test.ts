import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { prisma, type Prisma } from '@dental/database'
import { computeHeldCents } from './payment.service.js'
import { recalculateBudgetAggregates } from './budget.service.js'

// #602: the shipped migration promotes DRAFT budgets that already carry a
// SCHEDULED/EXECUTED link to APPROVED. The SQL is read from disk, never
// copied, so this test guards the file that ships.
//
// The UPDATE is global (it cannot be scoped to this test's tenant), so every
// run happens inside a transaction that is rolled back: other test files'
// rows in dental_test are never touched, and the fixture is observed
// before/after inside the same transaction.

const MIGRATIONS_DIR = resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  '../../../../packages/database/prisma/migrations'
)
const migrationDir = readdirSync(MIGRATIONS_DIR).find((d) => d.endsWith('_promote_draft_budgets_with_links_to_approved'))
const MIGRATION_SQL = readFileSync(join(MIGRATIONS_DIR, migrationDir ?? 'missing', 'migration.sql'), 'utf8')

class Rollback extends Error {}

describe('migration: promote draft budgets with links to approved (#602)', () => {
  const suffix = Date.now()
  let tenantId: string
  let patientId: string
  let doctorId: string
  let appointmentId: string
  const ids: Record<string, string> = {}

  type ItemStatus = 'PENDING' | 'SCHEDULED' | 'IN_PROGRESS' | 'EXECUTED' | 'CANCELLED'
  type LineSpec = { status: ItemStatus; link?: 'EXECUTED' | 'SCHEDULED' }

  /** A budget with the given lines; a line with `link` also gets a link row to the fixture appointment. */
  async function budgetWith(
    key: string,
    status: 'DRAFT' | 'APPROVED' | 'PARTIAL' | 'COMPLETED' | 'CANCELLED',
    lines: LineSpec[],
    opts: { isActive?: boolean } = {}
  ) {
    const budget = await prisma.budget.create({
      data: { tenantId, patientId, status, isActive: opts.isActive ?? true },
    })
    ids[key] = budget.id
    for (const [order, line] of lines.entries()) {
      const item = await prisma.budgetItem.create({
        data: {
          budgetId: budget.id,
          description: `Line ${key} ${order}`,
          quantity: 1,
          unitPrice: 200,
          totalPrice: 200,
          status: line.status,
          order,
        },
      })
      if (line.link) {
        await prisma.budgetItemAppointment.create({
          data: { budgetItemId: item.id, appointmentId, role: line.link },
        })
      }
    }
    return budget.id
  }

  beforeAll(async () => {
    expect(migrationDir, 'migration directory exists').toBeDefined()
    const freePlan =
      (await prisma.plan.findUnique({ where: { name: 'free' } })) ??
      (await prisma.plan.create({
        data: { name: 'free', displayName: 'Free', price: 0, maxAdmins: 1, maxDoctors: 3, maxPatients: 50 },
      }))
    const tenant = await prisma.tenant.create({
      data: { name: 'Draft Promotion Clinic', slug: `draft-promotion-${suffix}`, currency: 'USD', timezone: 'America/New_York' },
    })
    tenantId = tenant.id
    await prisma.subscription.create({
      data: {
        tenantId,
        planId: freePlan.id,
        status: 'ACTIVE',
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    })
    patientId = (await prisma.patient.create({ data: { tenantId, firstName: 'Mig', lastName: 'Patient' } })).id
    doctorId = (
      await prisma.doctor.create({
        data: { tenantId, firstName: 'Mig', lastName: 'Doctor', email: `mig-doc-${suffix}@test.com` },
      })
    ).id
    const start = new Date(Date.now() + 24 * 60 * 60 * 1000)
    appointmentId = (
      await prisma.appointment.create({
        data: { tenantId, patientId, doctorId, startTime: start, endTime: new Date(start.getTime() + 1800000), duration: 30 },
      })
    ).id

    // Guard 8 fixture: four DRAFT budgets. The two linked ones also hold a
    // non-executed line (the amended condition), so only the link decides.
    await budgetWith('draftExecutedLink', 'DRAFT', [{ status: 'EXECUTED', link: 'EXECUTED' }, { status: 'PENDING' }])
    await budgetWith('draftScheduledLink', 'DRAFT', [{ status: 'SCHEDULED', link: 'SCHEDULED' }])
    await budgetWith('draftItemsNoLink', 'DRAFT', [{ status: 'PENDING' }])
    await budgetWith('draftNoItems', 'DRAFT', [])
    // Guard 12 and the plan's edges: a link exists, but no line is open.
    await budgetWith('draftAllExecuted', 'DRAFT', [
      { status: 'EXECUTED', link: 'EXECUTED' },
      { status: 'EXECUTED', link: 'EXECUTED' },
    ])
    await budgetWith('draftAllCancelled', 'DRAFT', [
      { status: 'CANCELLED', link: 'SCHEDULED' },
      { status: 'CANCELLED' },
    ])
    await budgetWith('draftCancelledPlusExecuted', 'DRAFT', [
      { status: 'CANCELLED' },
      { status: 'EXECUTED', link: 'EXECUTED' },
    ])
    // An IN_PROGRESS line counts as open.
    await budgetWith('draftInProgressLink', 'DRAFT', [{ status: 'IN_PROGRESS', link: 'SCHEDULED' }])
    // Guard 9 fixture: closed budgets that carry links must stay as they are.
    await budgetWith('completedLinked', 'COMPLETED', [{ status: 'EXECUTED', link: 'EXECUTED' }])
    await budgetWith('cancelledLinked', 'CANCELLED', [{ status: 'SCHEDULED', link: 'SCHEDULED' }])
    await budgetWith('approvedLinked', 'APPROVED', [{ status: 'SCHEDULED', link: 'SCHEDULED' }])
    await budgetWith('partialLinked', 'PARTIAL', [{ status: 'EXECUTED', link: 'EXECUTED' }, { status: 'PENDING' }])
    // An inactive (deleted) DRAFT budget with a link is not promoted either.
    await budgetWith('draftInactiveLinked', 'DRAFT', [{ status: 'SCHEDULED', link: 'SCHEDULED' }], { isActive: false })
    // Guard 10 fixture: an advance reserved against a DRAFT budget that WILL be promoted.
    await prisma.patientPayment.create({
      data: { tenantId, patientId, amount: 500, date: new Date(), kind: 'ADVANCE', budgetId: ids.draftScheduledLink },
    })
  })

  afterAll(async () => {
    await prisma.patientPayment.deleteMany({ where: { tenantId } })
    await prisma.appointment.deleteMany({ where: { tenantId } })
    await prisma.budgetItem.deleteMany({ where: { budget: { tenantId } } })
    await prisma.budget.deleteMany({ where: { tenantId } })
    await prisma.patient.deleteMany({ where: { tenantId } })
    await prisma.doctor.deleteMany({ where: { tenantId } })
    await prisma.subscription.deleteMany({ where: { tenantId } })
    await prisma.tenant.deleteMany({ where: { id: tenantId } })
  })

  /** Statuses of this fixture's budgets, keyed by fixture name. */
  async function statuses(tx: Prisma.TransactionClient) {
    const rows = await tx.budget.findMany({ where: { tenantId }, select: { id: true, status: true } })
    const byId = new Map(rows.map((r) => [r.id, r.status]))
    return Object.fromEntries(Object.entries(ids).map(([key, id]) => [key, byId.get(id)]))
  }

  /** The held amount, from the same rule the money readers use (computeHeldCents). */
  async function heldCents(tx: Prisma.TransactionClient) {
    const grouped = await tx.patientPayment.groupBy({
      by: ['budgetId'],
      where: { tenantId, patientId, isActive: true, budgetId: { not: null } },
      _sum: { amount: true },
    })
    const budgets = await tx.budget.findMany({
      where: { id: { in: grouped.map((g) => g.budgetId as string) } },
      select: { id: true, status: true, isActive: true },
    })
    const openById = new Map(
      budgets.map((b) => [b.id, b.isActive && b.status !== 'COMPLETED' && b.status !== 'CANCELLED'])
    )
    return computeHeldCents(
      grouped.map((g) => ({
        reservedCents: Math.round((g._sum.amount?.toNumber() ?? 0) * 100),
        consumedCents: 0,
        open: openById.get(g.budgetId as string) ?? false,
      }))
    )
  }

  /** Run `body` inside a transaction that is always rolled back. */
  async function inRolledBackTx(body: (tx: Prisma.TransactionClient) => Promise<void>) {
    let failure: unknown
    try {
      await prisma.$transaction(async (tx) => {
        try {
          await body(tx)
        } catch (error) {
          failure = error // surface the real assertion, not the rollback
        }
        throw new Rollback()
      })
    } catch (error) {
      if (!(error instanceof Rollback)) throw error
    }
    if (failure) throw failure
  }

  const PROMOTED = ['draftExecutedLink', 'draftScheduledLink', 'draftInProgressLink']

  it('promotes a DRAFT budget with an EXECUTED link and a still-open line', async () => {
    await inRolledBackTx(async (tx) => {
      expect((await statuses(tx)).draftExecutedLink).toBe('DRAFT')
      await tx.$executeRawUnsafe(MIGRATION_SQL)
      expect((await statuses(tx)).draftExecutedLink).toBe('APPROVED')
    })
  })

  it('promotes a DRAFT budget with a SCHEDULED link', async () => {
    await inRolledBackTx(async (tx) => {
      await tx.$executeRawUnsafe(MIGRATION_SQL)
      expect((await statuses(tx)).draftScheduledLink).toBe('APPROVED')
    })
  })

  it('leaves a DRAFT budget with items but no link as DRAFT', async () => {
    await inRolledBackTx(async (tx) => {
      await tx.$executeRawUnsafe(MIGRATION_SQL)
      expect((await statuses(tx)).draftItemsNoLink).toBe('DRAFT')
    })
  })

  it('leaves a DRAFT budget with no items as DRAFT', async () => {
    await inRolledBackTx(async (tx) => {
      await tx.$executeRawUnsafe(MIGRATION_SQL)
      expect((await statuses(tx)).draftNoItems).toBe('DRAFT')
    })
  })

  it('does NOT promote a linked DRAFT budget whose active lines are all EXECUTED (it would derive COMPLETED)', async () => {
    await inRolledBackTx(async (tx) => {
      await tx.$executeRawUnsafe(MIGRATION_SQL)
      expect((await statuses(tx)).draftAllExecuted).toBe('DRAFT')
    })
  })

  it('control for the all-EXECUTED case: the linked DRAFT budget with a PENDING line IS promoted in the same run', async () => {
    await inRolledBackTx(async (tx) => {
      await tx.$executeRawUnsafe(MIGRATION_SQL)
      const after = await statuses(tx)
      expect(after.draftExecutedLink).toBe('APPROVED')
      expect(after.draftAllExecuted).toBe('DRAFT')
    })
  })

  it('does NOT promote a DRAFT budget whose every line is CANCELLED, even with a link', async () => {
    await inRolledBackTx(async (tx) => {
      await tx.$executeRawUnsafe(MIGRATION_SQL)
      expect((await statuses(tx)).draftAllCancelled).toBe('DRAFT')
    })
  })

  it('does NOT promote a DRAFT budget with a CANCELLED line next to only-EXECUTED active lines', async () => {
    await inRolledBackTx(async (tx) => {
      await tx.$executeRawUnsafe(MIGRATION_SQL)
      expect((await statuses(tx)).draftCancelledPlusExecuted).toBe('DRAFT')
    })
  })

  it('promotes a DRAFT budget whose only line is IN_PROGRESS and linked', async () => {
    await inRolledBackTx(async (tx) => {
      await tx.$executeRawUnsafe(MIGRATION_SQL)
      expect((await statuses(tx)).draftInProgressLink).toBe('APPROVED')
    })
  })

  it('changes nothing else: every other fixture budget keeps its status, inactive DRAFT included', async () => {
    await inRolledBackTx(async (tx) => {
      await tx.$executeRawUnsafe(MIGRATION_SQL)
      const after = await statuses(tx)

      expect(after).toEqual({
        draftExecutedLink: 'APPROVED',
        draftScheduledLink: 'APPROVED',
        draftItemsNoLink: 'DRAFT',
        draftNoItems: 'DRAFT',
        draftAllExecuted: 'DRAFT',
        draftAllCancelled: 'DRAFT',
        draftCancelledPlusExecuted: 'DRAFT',
        draftInProgressLink: 'APPROVED',
        completedLinked: 'COMPLETED',
        cancelledLinked: 'CANCELLED',
        approvedLinked: 'APPROVED',
        partialLinked: 'PARTIAL',
        draftInactiveLinked: 'DRAFT',
      })
    })
  })

  it('never writes COMPLETED or CANCELLED: the set of closed budgets is the same before and after', async () => {
    await inRolledBackTx(async (tx) => {
      const closedBefore = await tx.budget.findMany({
        where: { status: { in: ['COMPLETED', 'CANCELLED'] } },
        select: { id: true, status: true },
        orderBy: { id: 'asc' },
      })
      expect(closedBefore.length).toBeGreaterThanOrEqual(2)

      await tx.$executeRawUnsafe(MIGRATION_SQL)

      const closedAfter = await tx.budget.findMany({
        where: { status: { in: ['COMPLETED', 'CANCELLED'] } },
        select: { id: true, status: true },
        orderBy: { id: 'asc' },
      })
      expect(closedAfter).toEqual(closedBefore)
    })
  })

  it('keeps an advance reserved against a promoted DRAFT budget held, to the cent', async () => {
    await inRolledBackTx(async (tx) => {
      const before = await heldCents(tx)
      expect(before).toBe(50000) // non-vacuous: the 500.00 advance is held while the budget is open

      await tx.$executeRawUnsafe(MIGRATION_SQL)

      expect((await statuses(tx)).draftScheduledLink).toBe('APPROVED')
      expect(await heldCents(tx)).toBe(before)
    })
  })

  it('is idempotent: a second run changes nothing', async () => {
    await inRolledBackTx(async (tx) => {
      const first = await tx.$executeRawUnsafe(MIGRATION_SQL)
      expect(first).toBeGreaterThanOrEqual(2) // at least this fixture's two
      const afterFirst = await statuses(tx)
      const updatedAtFirst = await tx.budget.findMany({ where: { tenantId }, select: { id: true, updatedAt: true }, orderBy: { id: 'asc' } })

      const second = await tx.$executeRawUnsafe(MIGRATION_SQL)

      expect(second).toBe(0)
      expect(await statuses(tx)).toEqual(afterFirst)
      expect(
        await tx.budget.findMany({ where: { tenantId }, select: { id: true, updatedAt: true }, orderBy: { id: 'asc' } })
      ).toEqual(updatedAtFirst)
    })
  })

  it('promote, then recalculate: no promoted budget ends COMPLETED', async () => {
    await inRolledBackTx(async (tx) => {
      const draftsBefore = await tx.budget.findMany({ where: { tenantId, status: 'DRAFT' }, select: { id: true } })
      await tx.$executeRawUnsafe(MIGRATION_SQL)
      const promoted = await tx.budget.findMany({
        where: { id: { in: draftsBefore.map((b) => b.id) }, status: 'APPROVED' },
        select: { id: true },
      })
      expect(promoted.length).toBeGreaterThan(0) // non-vacuous; the exact set is pinned by the status tests above

      for (const { id } of promoted) await recalculateBudgetAggregates(tx, id)

      const finals = await tx.budget.findMany({ where: { id: { in: promoted.map((p) => p.id) } }, select: { id: true, status: true } })
      const keyOf = (id: string) => Object.keys(ids).find((k) => ids[k] === id)
      expect(finals.filter((f) => f.status === 'COMPLETED').map((f) => keyOf(f.id))).toEqual([])
    })
  })

  it('promote, then recalculate: the reserved advance is still held', async () => {
    await inRolledBackTx(async (tx) => {
      const before = await heldCents(tx)
      expect(before).toBe(50000)
      await tx.$executeRawUnsafe(MIGRATION_SQL)
      const promoted = await tx.budget.findMany({ where: { id: { in: PROMOTED.map((k) => ids[k]) } }, select: { id: true } })
      for (const { id } of promoted) await recalculateBudgetAggregates(tx, id)
      expect(await heldCents(tx)).toBe(before)
    })
  })
})
