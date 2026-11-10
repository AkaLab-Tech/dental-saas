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

// #671: the shipped migration promotes every live DRAFT budget that still has
// a line that is neither EXECUTED nor CANCELLED, link or no link. The numbered
// guards below (1-14) are this task's own; they are unrelated to #602's.
const PROMOTE_671_DIR = readdirSync(MIGRATIONS_DIR).find((d) => d.endsWith('_promote_linkless_draft_budgets_to_approved'))
const PROMOTE_671_SQL = readFileSync(join(MIGRATIONS_DIR, PROMOTE_671_DIR ?? 'missing', 'migration.sql'), 'utf8')
const DRYRUN_PATH = resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  '../../../../packages/database/scripts/promote-linkless-draft-budgets-dryrun.sql'
)
const DRYRUN_SQL = readFileSync(DRYRUN_PATH, 'utf8')

describe('migration: promote linkless draft budgets to approved (#671)', () => {
  const suffix = Date.now() + 1
  let tenantId: string
  let patientId: string
  let patient2Id: string
  const ids: Record<string, string> = {}

  type ItemStatus = 'PENDING' | 'SCHEDULED' | 'IN_PROGRESS' | 'EXECUTED' | 'CANCELLED'
  type BudgetStatus = 'DRAFT' | 'APPROVED' | 'PARTIAL' | 'COMPLETED' | 'CANCELLED'

  /** A budget with the given line statuses. No link rows: #671 is about budgets without them. */
  async function budgetWith(key: string, status: BudgetStatus, lines: ItemStatus[], opts: { isActive?: boolean } = {}) {
    const budget = await prisma.budget.create({
      data: { tenantId, patientId, status, isActive: opts.isActive ?? true },
    })
    ids[key] = budget.id
    for (const [order, lineStatus] of lines.entries()) {
      await prisma.budgetItem.create({
        data: {
          budgetId: budget.id,
          description: `Line ${key} ${order}`,
          quantity: 1,
          unitPrice: 200,
          totalPrice: 200,
          status: lineStatus,
          order,
        },
      })
    }
    return budget.id
  }

  beforeAll(async () => {
    expect(PROMOTE_671_DIR, '#671 migration directory exists').toBeDefined()
    const freePlan =
      (await prisma.plan.findUnique({ where: { name: 'free' } })) ??
      (await prisma.plan.create({
        data: { name: 'free', displayName: 'Free', price: 0, maxAdmins: 1, maxDoctors: 3, maxPatients: 50 },
      }))
    const tenant = await prisma.tenant.create({
      data: { name: 'Linkless Promotion Clinic', slug: `linkless-promotion-${suffix}`, currency: 'USD', timezone: 'America/New_York' },
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
    patientId = (await prisma.patient.create({ data: { tenantId, firstName: 'Linkless', lastName: 'One' } })).id
    patient2Id = (await prisma.patient.create({ data: { tenantId, firstName: 'Linkless', lastName: 'Two' } })).id

    // Promoted by the migration (a PENDING / IN_PROGRESS line is open).
    await budgetWith('promoPending', 'DRAFT', ['PENDING']) // derives APPROVED
    await budgetWith('promoInProgress', 'DRAFT', ['IN_PROGRESS', 'CANCELLED']) // derives APPROVED
    await budgetWith('promoPartial', 'DRAFT', ['EXECUTED', 'PENDING']) // derives PARTIAL
    // Left alone.
    await budgetWith('draftNoItems', 'DRAFT', [])
    await budgetWith('draftAllExecuted', 'DRAFT', ['EXECUTED', 'EXECUTED']) // would derive COMPLETED
    await budgetWith('draftAllCancelled', 'DRAFT', ['CANCELLED', 'CANCELLED'])
    await budgetWith('draftInactive', 'DRAFT', ['PENDING'], { isActive: false })
    // Not DRAFT: must be untouched.
    await budgetWith('approvedOpen', 'APPROVED', ['PENDING'])
    await budgetWith('partialOpen', 'PARTIAL', ['EXECUTED', 'PENDING'])
    await budgetWith('completedDone', 'COMPLETED', ['EXECUTED'])
    await budgetWith('cancelledOpen', 'CANCELLED', ['PENDING'])

    // 500.00 reserved against a budget the migration PROMOTES (patient one) and
    // 300.00 against the all-EXECUTED DRAFT it must NOT promote (patient two,
    // so guard 11's 50000 stays exact). Promoting the latter would derive
    // COMPLETED on recalculation and release it.
    await prisma.patientPayment.create({
      data: { tenantId, patientId, amount: 500, date: new Date(), kind: 'ADVANCE', budgetId: ids.promoPending },
    })
    await prisma.patientPayment.create({
      data: { tenantId, patientId: patient2Id, amount: 300, date: new Date(), kind: 'ADVANCE', budgetId: ids.draftAllExecuted },
    })
  })

  afterAll(async () => {
    await prisma.patientPayment.deleteMany({ where: { tenantId } })
    await prisma.budgetItem.deleteMany({ where: { budget: { tenantId } } })
    await prisma.budget.deleteMany({ where: { tenantId } })
    await prisma.patient.deleteMany({ where: { tenantId } })
    await prisma.subscription.deleteMany({ where: { tenantId } })
    await prisma.tenant.deleteMany({ where: { id: tenantId } })
  })

  /** Statuses of this fixture's budgets, keyed by fixture name. */
  async function statuses(tx: Prisma.TransactionClient) {
    const rows = await tx.budget.findMany({ where: { tenantId }, select: { id: true, status: true } })
    const byId = new Map(rows.map((r) => [r.id, r.status]))
    return Object.fromEntries(Object.entries(ids).map(([key, id]) => [key, byId.get(id)]))
  }

  async function updatedAts(tx: Prisma.TransactionClient) {
    return tx.budget.findMany({ where: { tenantId }, select: { id: true, updatedAt: true }, orderBy: { id: 'asc' } })
  }

  /** The held amount for one patient, from the same rule the money readers use (computeHeldCents). */
  async function heldCents(tx: Prisma.TransactionClient, forPatientId: string = patientId) {
    const grouped = await tx.patientPayment.groupBy({
      by: ['budgetId'],
      where: { tenantId, patientId: forPatientId, isActive: true, budgetId: { not: null } },
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

  const keyOf = (id: string) => Object.keys(ids).find((k) => ids[k] === id)
  const PROMOTED = ['promoPending', 'promoInProgress', 'promoPartial']

  it('guard 1: promotes a linkless DRAFT budget with a PENDING line', async () => {
    await inRolledBackTx(async (tx) => {
      expect((await statuses(tx)).promoPending).toBe('DRAFT')
      await tx.$executeRawUnsafe(PROMOTE_671_SQL)
      expect((await statuses(tx)).promoPending).toBe('APPROVED')
    })
  })

  it('guard 2: leaves a DRAFT budget with no items as DRAFT', async () => {
    await inRolledBackTx(async (tx) => {
      await tx.$executeRawUnsafe(PROMOTE_671_SQL)
      expect((await statuses(tx)).draftNoItems).toBe('DRAFT')
    })
  })

  it('guard 3: leaves a DRAFT budget whose active lines are all EXECUTED as DRAFT (it would derive COMPLETED)', async () => {
    await inRolledBackTx(async (tx) => {
      await tx.$executeRawUnsafe(PROMOTE_671_SQL)
      expect((await statuses(tx)).draftAllExecuted).toBe('DRAFT')
    })
  })

  it('guard 4: discrimination control, one run promotes the PENDING budget and leaves the all-EXECUTED one', async () => {
    await inRolledBackTx(async (tx) => {
      await tx.$executeRawUnsafe(PROMOTE_671_SQL)
      const after = await statuses(tx)
      // One object, so both halves are always evaluated: the positive half
      // rules out a promotes-nothing predicate, the negative a promote-everything one.
      expect({ promoted: after.promoPending, left: after.draftAllExecuted }).toEqual({
        promoted: 'APPROVED',
        left: 'DRAFT',
      })
    })
  })

  it('guard 5: leaves a DRAFT budget whose every line is CANCELLED as DRAFT', async () => {
    await inRolledBackTx(async (tx) => {
      await tx.$executeRawUnsafe(PROMOTE_671_SQL)
      expect((await statuses(tx)).draftAllCancelled).toBe('DRAFT')
    })
  })

  it('guard 6: leaves an inactive (deleted) DRAFT budget as DRAFT', async () => {
    await inRolledBackTx(async (tx) => {
      await tx.$executeRawUnsafe(PROMOTE_671_SQL)
      expect((await statuses(tx)).draftInactive).toBe('DRAFT')
    })
  })

  it('guard 7: changes nothing else, a full status map over every fixture budget', async () => {
    await inRolledBackTx(async (tx) => {
      await tx.$executeRawUnsafe(PROMOTE_671_SQL)
      expect(await statuses(tx)).toEqual({
        promoPending: 'APPROVED',
        promoInProgress: 'APPROVED',
        promoPartial: 'APPROVED',
        draftNoItems: 'DRAFT',
        draftAllExecuted: 'DRAFT',
        draftAllCancelled: 'DRAFT',
        draftInactive: 'DRAFT',
        approvedOpen: 'APPROVED',
        partialOpen: 'PARTIAL',
        completedDone: 'COMPLETED',
        cancelledOpen: 'CANCELLED',
      })
    })
  })

  it('guard 8: never writes COMPLETED or CANCELLED, the closed set is identical before and after', async () => {
    await inRolledBackTx(async (tx) => {
      const closed = () =>
        tx.budget.findMany({
          where: { status: { in: ['COMPLETED', 'CANCELLED'] } },
          select: { id: true, status: true },
          orderBy: { id: 'asc' },
        })
      const closedBefore = await closed()
      expect(closedBefore.length).toBeGreaterThanOrEqual(2) // non-vacuous: the fixture's own two

      await tx.$executeRawUnsafe(PROMOTE_671_SQL)

      expect(await closed()).toEqual(closedBefore)
    })
  })

  it('guard 9: only the status column changes, updatedAt is identical before and after', async () => {
    await inRolledBackTx(async (tx) => {
      const before = await updatedAts(tx)
      await tx.$executeRawUnsafe(PROMOTE_671_SQL)
      // non-vacuous: rows really were written
      expect((await statuses(tx)).promoPending).toBe('APPROVED')
      expect(await updatedAts(tx)).toEqual(before)
    })
  })

  it('guard 10: is idempotent, the second run matches nothing and changes nothing', async () => {
    await inRolledBackTx(async (tx) => {
      const first = await tx.$executeRawUnsafe(PROMOTE_671_SQL)
      expect(first).toBeGreaterThanOrEqual(PROMOTED.length) // non-vacuous: at least this fixture's three
      const afterFirst = await statuses(tx)
      const updatedAtFirst = await updatedAts(tx)

      const second = await tx.$executeRawUnsafe(PROMOTE_671_SQL)

      expect({ second, statuses: await statuses(tx), updatedAt: await updatedAts(tx) }).toEqual({
        second: 0,
        statuses: afterFirst,
        updatedAt: updatedAtFirst,
      })
    })
  })

  it('guard 11: keeps an advance reserved against a promoted DRAFT budget held, to the cent', async () => {
    await inRolledBackTx(async (tx) => {
      const before = await heldCents(tx)
      expect(before).toBe(50000) // non-vacuous: the 500.00 advance is held while the budget is open

      await tx.$executeRawUnsafe(PROMOTE_671_SQL)

      expect({ status: (await statuses(tx)).promoPending, held: await heldCents(tx) }).toEqual({
        status: 'APPROVED',
        held: before,
      })
    })
  })

  it('guard 12: promote, then recalculate, no promoted budget ends COMPLETED and no held advance is released', async () => {
    await inRolledBackTx(async (tx) => {
      const heldBefore = { one: await heldCents(tx), two: await heldCents(tx, patient2Id) }
      expect(heldBefore).toEqual({ one: 50000, two: 30000 }) // non-vacuous: both advances are held

      const draftsBefore = await tx.budget.findMany({ where: { tenantId, status: 'DRAFT' }, select: { id: true } })
      await tx.$executeRawUnsafe(PROMOTE_671_SQL)
      const promoted = await tx.budget.findMany({
        where: { id: { in: draftsBefore.map((b) => b.id) }, status: 'APPROVED' },
        select: { id: true },
      })
      expect(promoted.length).toBeGreaterThan(0) // non-vacuous

      for (const { id } of promoted) await recalculateBudgetAggregates(tx, id)

      const finals = await tx.budget.findMany({
        where: { id: { in: promoted.map((p) => p.id) } },
        select: { id: true, status: true },
      })
      // One object so the status and the money are both always evaluated.
      expect({
        completed: finals.filter((f) => f.status === 'COMPLETED').map((f) => keyOf(f.id)),
        held: { one: await heldCents(tx), two: await heldCents(tx, patient2Id) },
      }).toEqual({ completed: [], held: heldBefore })
    })
  })

  it('guard 13: the dry-run classification agrees with the status recalculateBudgetAggregates writes', async () => {
    // The statement that ends in the per-budget (A) detail, from the file on
    // disk: its WITH ... classified CTE, followed by our own projection.
    const start = DRYRUN_SQL.lastIndexOf('WITH live_drafts AS (')
    const end = DRYRUN_SQL.indexOf('SELECT budget_id, bucket', start)
    expect(start, 'dry-run CTE found').toBeGreaterThan(-1)
    expect(end, 'dry-run (A) projection found').toBeGreaterThan(start)
    const classifySql = `${DRYRUN_SQL.slice(start, end)}SELECT budget_id, derived_after_promotion FROM classified`

    await inRolledBackTx(async (tx) => {
      const rows = await tx.$queryRawUnsafe<{ budget_id: string; derived_after_promotion: string }[]>(classifySql)
      const predicted: Record<string, string> = {}
      for (const row of rows) {
        const key = keyOf(row.budget_id)
        if (key) predicted[key] = row.derived_after_promotion
      }
      // Every live DRAFT of the fixture, promoted or not.
      const liveDrafts = ['promoPending', 'promoInProgress', 'promoPartial', 'draftNoItems', 'draftAllExecuted', 'draftAllCancelled']
      expect(Object.keys(predicted).sort()).toEqual([...liveDrafts].sort())
      // Agreement over the complement too: all three outcomes are present, the
      // COMPLETED one coming from a budget the migration must NOT promote.
      expect(new Set(Object.values(predicted))).toEqual(new Set(['APPROVED', 'PARTIAL', 'COMPLETED']))

      // Simulate "promoted" for every one of them (currentStatus = APPROVED),
      // then let the real derivation speak.
      await tx.budget.updateMany({ where: { id: { in: liveDrafts.map((k) => ids[k]) } }, data: { status: 'APPROVED' } })
      for (const key of liveDrafts) await recalculateBudgetAggregates(tx, ids[key])
      const written = await statuses(tx)

      expect(Object.fromEntries(liveDrafts.map((k) => [k, written[k]]))).toEqual(predicted)
    })
  })

  it('guard 14: the dry-run script is read-only', () => {
    // Statements, not substrings: comments are stripped, and the keyword must
    // stand as a statement ("DELETE FROM", "INSERT INTO", ...), so the column
    // alias draft_inactive_excluded cannot match.
    const MUTATING = /\b(UPDATE\s+["\w.]+\s+(?:\w+\s+)?SET|INSERT\s+INTO|DELETE\s+FROM|TRUNCATE\b|ALTER\s+(?:TABLE|SEQUENCE|INDEX|TYPE|DATABASE|ROLE))/i
    const code = (sql: string) => sql.replace(/--[^\n]*/g, '')

    // The comment header also names it, so look at the code only.
    expect(code(DRYRUN_SQL)).toContain('SET TRANSACTION READ ONLY')
    expect(code(DRYRUN_SQL)).not.toMatch(MUTATING)

    // Known positives: the pattern must catch a real mutating statement.
    for (const mutation of [
      'UPDATE "budgets" b SET "status" = \'APPROVED\';',
      'INSERT INTO "budgets" ("id") VALUES (1);',
      'DELETE FROM "budgets";',
      'TRUNCATE "budgets";',
      'ALTER TABLE "budgets" ADD COLUMN x int;',
    ]) {
      expect(code(`${DRYRUN_SQL}\n${mutation}\n`), mutation).toMatch(MUTATING)
    }
  })
})
