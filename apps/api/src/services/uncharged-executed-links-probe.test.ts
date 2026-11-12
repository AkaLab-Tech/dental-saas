import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { prisma, type Prisma } from '@dental/database'

// #681: guards over the committed probe, read from disk and never copied. The
// probe is global (it cannot be scoped to a tenant), so every run happens in a
// transaction that is rolled back, observed through this fixture's tenant only.
// The psql meta-commands (\set, \echo, \pset) are deliberately not exercised.

const PROBE = readFileSync(
  resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../../packages/database/scripts/uncharged-executed-links-probe.sql'),
  'utf8'
)
const INACTIVE = 'inactive link: uncharged'

class Rollback extends Error {}

async function inRolledBackTx(body: (tx: Prisma.TransactionClient) => Promise<void>) {
  let failure: unknown
  try {
    await prisma.$transaction(
      async (tx) => {
        try {
          await body(tx)
        } catch (error) {
          failure = error
        }
        throw new Rollback()
      },
      { timeout: 60_000 }
    )
  } catch (error) {
    if (!(error instanceof Rollback)) throw error
  }
  if (failure) throw failure
}

/** The statement whose final projection starts at `marker`, up to (excluding) that projection. */
function cteBefore(marker: string) {
  const end = PROBE.indexOf(marker)
  expect(end, `${marker} found`).toBeGreaterThan(-1)
  const start = PROBE.lastIndexOf('WITH live_drafts AS (', end)
  expect(start, 'population CTE found').toBeGreaterThan(-1)
  return PROBE.slice(start, end)
}
const LINKS_SQL = () => cteBefore('SELECT budget_id, item_id, bucket')
const MONEY_SQL = () => cteBefore('SELECT census.credit_patients')

type Spec = { key: string; active: boolean; status: 'SCHEDULED' | 'COMPLETED' | 'CANCELLED'; cost: number | null; scheduledLink?: boolean }

/** One live DRAFT budget per spec: a single EXECUTED item whose EXECUTED link sits on the described appointment. */
async function seed(tx: Prisma.TransactionClient, specs: Spec[]) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const tenant = await tx.tenant.create({
    data: { name: 'Probe Clinic', slug: `probe-681-${suffix}`, currency: 'USD', timezone: 'America/New_York' },
  })
  const patient = await tx.patient.create({ data: { tenantId: tenant.id, firstName: 'P', lastName: 'Q' } })
  const doctor = await tx.doctor.create({
    data: { tenantId: tenant.id, firstName: 'D', lastName: 'R', email: `probe-681-${suffix}@test.com` },
  })
  const start = new Date(Date.now() - 86_400_000)
  const appt = (s: Pick<Spec, 'active' | 'status' | 'cost'>) =>
    tx.appointment.create({
      data: {
        tenantId: tenant.id, patientId: patient.id, doctorId: doctor.id, startTime: start,
        endTime: new Date(start.getTime() + 1_800_000), status: s.status, cost: s.cost, isActive: s.active,
      },
    })
  const budgets: Record<string, { budgetId: string; itemId: string }> = {}
  for (const s of specs) {
    const budget = await tx.budget.create({ data: { tenantId: tenant.id, patientId: patient.id, status: 'DRAFT' } })
    const item = await tx.budgetItem.create({
      data: { budgetId: budget.id, description: s.key, quantity: 1, unitPrice: 200, totalPrice: 200, status: 'EXECUTED' },
    })
    const executed = await appt(s)
    await tx.budgetItemAppointment.create({ data: { budgetItemId: item.id, appointmentId: executed.id, role: 'EXECUTED' } })
    if (s.scheduledLink) {
      const planned = await appt({ active: true, status: 'COMPLETED', cost: 100 })
      await tx.budgetItemAppointment.create({ data: { budgetItemId: item.id, appointmentId: planned.id, role: 'SCHEDULED' } })
    }
    budgets[s.key] = { budgetId: budget.id, itemId: item.id }
  }
  return { tenantId: tenant.id, patientId: patient.id, budgets }
}

const SHAPES: Spec[] = [
  { key: 'inactive', active: false, status: 'CANCELLED', cost: null },
  { key: 'activeCancelled', active: true, status: 'CANCELLED', cost: 150 },
  { key: 'superseded', active: true, status: 'COMPLETED', cost: 150 },
  { key: 'scheduledBeside', active: false, status: 'CANCELLED', cost: null, scheduledLink: true },
]

type LinkRow = { budget_id: string; item_id: string; bucket: string | null; role: string; appt_active: boolean; appt_status: string }

describe('uncharged-executed-links probe (#681)', () => {
  it('guard 1: the committed CTE classifies each shape into its own bucket, with the order that matters', async () => {
    await inRolledBackTx(async (tx) => {
      const { budgets } = await seed(tx, SHAPES)
      const sql = `${LINKS_SQL()}SELECT budget_id, item_id, bucket, role::text AS role, appt_active, appt_status::text AS appt_status FROM links`
      const rows = await tx.$queryRawUnsafe<LinkRow[]>(sql)
      const bucketOf = (key: string) => rows.filter((r) => r.budget_id === budgets[key].budgetId && r.role === 'EXECUTED').map((r) => r.bucket)

      expect(bucketOf('inactive')).toEqual([INACTIVE])
      // The correction the first version of the issue got wrong: ACTIVE + CANCELLED bills.
      expect(bucketOf('activeCancelled')).toEqual(['factura'])
      expect(bucketOf('superseded')).toEqual(['tapado por #590'])
      expect(bucketOf('scheduledBeside')).toEqual([INACTIVE])
      // Question 4: both links of the item are inventoried, each with its own role.
      const beside = rows.filter((r) => r.budget_id === budgets.scheduledBeside.budgetId)
      expect(beside.map((r) => [r.role, r.appt_active, r.appt_status]).sort()).toEqual([
        ['EXECUTED', false, 'CANCELLED'],
        ['SCHEDULED', true, 'COMPLETED'],
      ])
      // Vacuity: a CTE that put everything in one bucket cannot pass.
      const observed = new Set(SHAPES.flatMap((s) => bucketOf(s.key)))
      expect(observed).toEqual(new Set([INACTIVE, 'factura', 'tapado por #590']))
    })
  })

  it('guard 2: a fabricated uncharged link moves the bucket count by 1 and the credit by the advance', async () => {
    await inRolledBackTx(async (tx) => {
      const { tenantId, patientId } = await seed(tx, [{ key: 'baseline', active: false, status: 'CANCELLED', cost: null }])
      const inactiveCount = async () => {
        const sql = `${LINKS_SQL()}SELECT count(DISTINCT item_id)::int AS n FROM links WHERE bucket = '${INACTIVE}'
          AND budget_id IN (SELECT "id" FROM "budgets" WHERE "tenantId" = '${tenantId}')`
        return (await tx.$queryRawUnsafe<{ n: number }[]>(sql))[0].n
      }
      const credit = async () => {
        const sql = `${MONEY_SQL()}SELECT credit::float8 AS credit FROM fin WHERE pid = '${patientId}'`
        return (await tx.$queryRawUnsafe<{ credit: number }[]>(sql))[0]?.credit ?? 0
      }
      const [countBefore, creditBefore] = [await inactiveCount(), await credit()]
      expect(creditBefore).toBe(0)

      // Same patient: add the uncharged shape and a 500 advance.
      const budget = await tx.budget.create({ data: { tenantId, patientId, status: 'DRAFT' } })
      const item = await tx.budgetItem.create({
        data: { budgetId: budget.id, description: 'known positive', quantity: 1, unitPrice: 200, totalPrice: 200, status: 'EXECUTED' },
      })
      const doctor = await tx.doctor.findFirstOrThrow({ where: { tenantId } })
      const start = new Date(Date.now() - 86_400_000)
      const appointment = await tx.appointment.create({
        data: { tenantId, patientId, doctorId: doctor.id, startTime: start, endTime: new Date(start.getTime() + 1_800_000), status: 'CANCELLED', isActive: false },
      })
      await tx.budgetItemAppointment.create({ data: { budgetItemId: item.id, appointmentId: appointment.id, role: 'EXECUTED' } })
      await tx.patientPayment.create({ data: { tenantId, patientId, amount: 500, date: new Date(), kind: 'ADVANCE' } })

      expect(await inactiveCount()).toBe(countBefore + 1)
      // The uncharged item adds no debt, so the whole advance is credit.
      expect(await credit()).toBe(creditBefore + 500)
    })
  })

  // Statements, not substrings: comments are stripped, so the header cannot match.
  const MUTATING = /\b(UPDATE\s+["\w.]+\s+(?:\w+\s+)?SET|INSERT\s+INTO|DELETE\s+FROM|TRUNCATE\b|ALTER\s+(?:TABLE|SEQUENCE|INDEX|TYPE|DATABASE|ROLE))/i
  const FORBIDDEN = /"(?:firstName|lastName|description|notes|privateNotes|note)"|\.(?:firstName|lastName|description|notes|privateNotes|note)\b/
  const code = (sql: string) => sql.replace(/--[^\n]*/g, '')

  it('guard 3: the probe fails closed, is read-only and selects no name or free text', () => {
    expect(code(PROBE)).toContain('SET TRANSACTION READ ONLY')
    expect(code(PROBE)).toContain('\\set ON_ERROR_STOP on')
    expect(code(PROBE)).not.toMatch(MUTATING)
    expect(code(PROBE)).not.toMatch(FORBIDDEN)

    // Known positives: each pattern must catch what it claims to.
    for (const mutation of [
      'UPDATE "budgets" b SET "status" = \'APPROVED\';',
      'INSERT INTO "budgets" ("id") VALUES (1);',
      'DELETE FROM "budgets";',
      'TRUNCATE "budgets";',
      'ALTER TABLE "budgets" ADD COLUMN x int;',
    ]) {
      expect(code(`${PROBE}\n${mutation}\n`), mutation).toMatch(MUTATING)
    }
    for (const leak of ['SELECT p."firstName" FROM "patients" p;', 'SELECT i."description" FROM "budget_items" i;', 'SELECT a.notes FROM "appointments" a;']) {
      expect(code(`${PROBE}\n${leak}\n`), leak).toMatch(FORBIDDEN)
    }
  })
})
