import { prisma } from '@dental/database'
import {
  computeFifoAllocation,
  getAppointmentEarmarks,
  getBudgetReservations,
  getTotalPaid,
  listBillableItems,
} from './payment.service.js'

// payment.service does not export its integer-cents helpers; these are the same
// two one-liners so budget figures reduce exactly as the account statement does.
const toCents = (dollars: number) => Math.round(dollars * 100)
const fromCents = (cents: number) => cents / 100

export interface BudgetMoney {
  /** Budget.totalAmount as stored. */
  total: number
  /** Sum of this budget's lines that became charges. */
  billed: number
  /** Sum of FIFO-allocated paidAmount over those charges. */
  covered: number
  /** billed - covered. */
  remaining: number
  /** total - billed. */
  notBilled: number
}

/** One paying visit of a budget: what was executed at it and what it charged. */
export interface BudgetVisit {
  appointmentId: string
  /** Appointment startTime, ISO. */
  date: string
  lines: { budgetItemId: string; description: string; notes: string | null }[]
  charged: number
  covered: number
}

type Bucket = { billedCents: number; coveredCents: number }

type Charge = { item: Awaited<ReturnType<typeof listBillableItems>>[number]; paidCents: number }

async function allocateCharges(tenantId: string, patientId: string): Promise<Charge[]> {
  const [items, totalPaid, earmarks, reservations] = await Promise.all([
    listBillableItems(tenantId, patientId),
    getTotalPaid(tenantId, patientId),
    getAppointmentEarmarks(tenantId, patientId),
    getBudgetReservations(tenantId, patientId),
  ])
  const allocations = computeFifoAllocation(items, totalPaid, earmarks, reservations)
  return items.flatMap((item, i) =>
    item.type === 'budgetItem' && item.budgetId
      ? [{ item, paidCents: toCents(allocations[i].paidAmount) }]
      : []
  )
}

function bucketsOf(charges: Charge[]): Map<string, Bucket> {
  const buckets = new Map<string, Bucket>()
  for (const { item, paidCents } of charges) {
    const bucket = buckets.get(item.budgetId!) ?? { billedCents: 0, coveredCents: 0 }
    bucket.billedCents += toCents(item.cost)
    bucket.coveredCents += paidCents
    buckets.set(item.budgetId!, bucket)
  }
  return buckets
}

/**
 * Per-budget billed/covered figures for one patient, from the same FIFO
 * allocation the account statement uses. Returns only budgets that have at least
 * one charge; use `buildBudgetMoney` for the full shape of any budget.
 */
export async function getBudgetMoneyBuckets(
  tenantId: string,
  patientId: string
): Promise<Map<string, Bucket>> {
  return bucketsOf(await allocateCharges(tenantId, patientId))
}

/**
 * The aggregate and the payments-table rows of ONE budget out of a single
 * allocation. Rows come from the allocated charges (never from the links), so
 * SCHEDULED links, lines superseded by their appointment's own cost and extra
 * EXECUTED links of the same line produce nothing; each billed line lands on
 * exactly one visit, so rows sum to `billed` and `covered`.
 */
export async function getBudgetMoneyDetail(
  tenantId: string,
  patientId: string,
  budgetId: string
): Promise<{ bucket: Bucket | undefined; visits: BudgetVisit[] }> {
  const charges = await allocateCharges(tenantId, patientId)
  const own = charges.filter((c) => c.item.budgetId === budgetId)
  const bucket = bucketsOf(own).get(budgetId)
  if (own.length === 0) return { bucket, visits: [] }

  const links = await prisma.budgetItemAppointment.findMany({
    where: { role: 'EXECUTED', budgetItemId: { in: own.map((c) => c.item.id) } },
    select: {
      budgetItemId: true,
      appointmentId: true,
      notes: true,
      budgetItem: { select: { description: true } },
    },
  })
  const linkOf = new Map(links.map((l) => [`${l.budgetItemId}:${l.appointmentId}`, l]))

  const rows = new Map<string, { visit: BudgetVisit; chargedCents: number; coveredCents: number }>()
  for (const { item, paidCents } of own) {
    const appointmentId = item.appointmentId!
    const row = rows.get(appointmentId) ?? {
      visit: { appointmentId, date: item.date.toISOString(), lines: [], charged: 0, covered: 0 },
      chargedCents: 0,
      coveredCents: 0,
    }
    const link = linkOf.get(`${item.id}:${appointmentId}`)
    row.visit.lines.push({
      budgetItemId: item.id,
      description: link?.budgetItem.description ?? '',
      notes: link?.notes ?? null,
    })
    row.chargedCents += toCents(item.cost)
    row.coveredCents += paidCents
    rows.set(appointmentId, row)
  }
  const visits = [...rows.values()].map(({ visit, chargedCents, coveredCents }) => ({
    ...visit,
    charged: fromCents(chargedCents),
    covered: fromCents(coveredCents),
  }))
  return { bucket, visits }
}

export function buildBudgetMoney(
  totalAmount: { toNumber(): number },
  bucket: Bucket | undefined
): BudgetMoney {
  const totalCents = toCents(totalAmount.toNumber())
  const billedCents = bucket?.billedCents ?? 0
  const coveredCents = bucket?.coveredCents ?? 0
  return {
    total: fromCents(totalCents),
    billed: fromCents(billedCents),
    covered: fromCents(coveredCents),
    remaining: fromCents(billedCents - coveredCents),
    notBilled: fromCents(totalCents - billedCents),
  }
}
