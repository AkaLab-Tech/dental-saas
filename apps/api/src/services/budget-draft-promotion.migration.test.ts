import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { prisma, type Prisma } from '@dental/database'
import { computeHeldCents } from './payment.service.js'

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

  async function budgetWithItem(
    key: string,
    status: 'DRAFT' | 'APPROVED' | 'PARTIAL' | 'COMPLETED' | 'CANCELLED',
    link: 'EXECUTED' | 'SCHEDULED' | null,
    opts: { items?: boolean; isActive?: boolean } = {}
  ) {
    const budget = await prisma.budget.create({
      data: { tenantId, patientId, status, isActive: opts.isActive ?? true },
    })
    ids[key] = budget.id
    if (opts.items === false) return budget.id
    const item = await prisma.budgetItem.create({
      data: {
        budgetId: budget.id,
        description: `Line ${key}`,
        quantity: 1,
        unitPrice: 200,
        totalPrice: 200,
        status: link === 'EXECUTED' ? 'EXECUTED' : link === 'SCHEDULED' ? 'SCHEDULED' : 'PENDING',
        order: 0,
      },
    })
    if (link) {
      await prisma.budgetItemAppointment.create({
        data: { budgetItemId: item.id, appointmentId, role: link },
      })
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

    // Guard 8 fixture: four DRAFT budgets.
    await budgetWithItem('draftExecuted', 'DRAFT', 'EXECUTED')
    await budgetWithItem('draftScheduled', 'DRAFT', 'SCHEDULED')
    await budgetWithItem('draftItemsNoLink', 'DRAFT', null)
    await budgetWithItem('draftNoItems', 'DRAFT', null, { items: false })
    // Guard 9 fixture: closed budgets that carry links must stay as they are.
    await budgetWithItem('completedLinked', 'COMPLETED', 'EXECUTED')
    await budgetWithItem('cancelledLinked', 'CANCELLED', 'SCHEDULED')
    await budgetWithItem('approvedLinked', 'APPROVED', 'SCHEDULED')
    await budgetWithItem('partialLinked', 'PARTIAL', 'EXECUTED')
    // An inactive (deleted) DRAFT budget with a link is not promoted either.
    await budgetWithItem('draftInactiveLinked', 'DRAFT', 'SCHEDULED', { isActive: false })
    // Guard 10 fixture: an advance reserved against a DRAFT budget that WILL be promoted.
    await prisma.patientPayment.create({
      data: { tenantId, patientId, amount: 500, date: new Date(), kind: 'ADVANCE', budgetId: ids.draftScheduled },
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

  it('promotes exactly the DRAFT budgets that carry a SCHEDULED or EXECUTED link', async () => {
    await inRolledBackTx(async (tx) => {
      const before = await statuses(tx)
      expect(before.draftExecuted).toBe('DRAFT')
      await tx.$executeRawUnsafe(MIGRATION_SQL)
      const after = await statuses(tx)

      expect(after.draftExecuted).toBe('APPROVED')
      expect(after.draftScheduled).toBe('APPROVED')
    })
  })

  it('leaves a DRAFT budget with items but no link, and one with no items, as DRAFT', async () => {
    await inRolledBackTx(async (tx) => {
      await tx.$executeRawUnsafe(MIGRATION_SQL)
      const after = await statuses(tx)

      expect(after.draftItemsNoLink).toBe('DRAFT')
      expect(after.draftNoItems).toBe('DRAFT')
    })
  })

  it('changes nothing else: every other fixture budget keeps its status, inactive DRAFT included', async () => {
    await inRolledBackTx(async (tx) => {
      await tx.$executeRawUnsafe(MIGRATION_SQL)
      const after = await statuses(tx)

      expect(after).toEqual({
        draftExecuted: 'APPROVED',
        draftScheduled: 'APPROVED',
        draftItemsNoLink: 'DRAFT',
        draftNoItems: 'DRAFT',
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

      expect((await statuses(tx)).draftScheduled).toBe('APPROVED')
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
})
