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

type Bucket = { billedCents: number; coveredCents: number }

/**
 * Per-budget billed/covered figures for one patient, from the same FIFO
 * allocation the account statement uses. Returns only budgets that have at least
 * one charge; use `buildBudgetMoney` for the full shape of any budget.
 */
export async function getBudgetMoneyBuckets(
  tenantId: string,
  patientId: string
): Promise<Map<string, Bucket>> {
  const [items, totalPaid, earmarks, reservations] = await Promise.all([
    listBillableItems(tenantId, patientId),
    getTotalPaid(tenantId, patientId),
    getAppointmentEarmarks(tenantId, patientId),
    getBudgetReservations(tenantId, patientId),
  ])
  const allocations = computeFifoAllocation(items, totalPaid, earmarks, reservations)

  const buckets = new Map<string, Bucket>()
  items.forEach((item, i) => {
    if (item.type !== 'budgetItem' || !item.budgetId) return
    const bucket = buckets.get(item.budgetId) ?? { billedCents: 0, coveredCents: 0 }
    bucket.billedCents += toCents(item.cost)
    bucket.coveredCents += toCents(allocations[i].paidAmount)
    buckets.set(item.budgetId, bucket)
  })
  return buckets
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
