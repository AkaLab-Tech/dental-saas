import { prisma, Prisma, PatientPaymentKind } from '@dental/database'
import { logger } from '../utils/logger.js'

// Fields to include in payment responses
const PAYMENT_SELECT = {
  id: true,
  tenantId: true,
  patientId: true,
  amount: true,
  date: true,
  note: true,
  createdBy: true,
  kind: true,
  appointmentId: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const

export type SafePayment = {
  id: string
  tenantId: string
  patientId: string
  amount: Prisma.Decimal
  date: Date
  note: string | null
  createdBy: string | null
  kind: PatientPaymentKind
  appointmentId: string | null
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}

export type PaymentErrorCode =
  | 'NOT_FOUND'
  | 'PATIENT_NOT_FOUND'
  | 'ALREADY_INACTIVE'
  | 'EXCEEDS_BALANCE'

export interface CreatePaymentInput {
  amount: number
  date: Date
  note?: string
  createdBy?: string
  kind?: PatientPaymentKind
  appointmentId?: string
}

export interface ListPaymentsOptions {
  limit?: number
  offset?: number
  kind?: PatientPaymentKind
}

// Money arithmetic in this service runs in integer cents. `cost`/`price`/
// `amount` are Decimal(10,2) at the source, so cents are always whole numbers
// and the conversion at the boundary is lossless — no IEEE-754 double can
// introduce fractional-cent drift into a chain of integer +/- ops (unlike the
// equivalent chain in dollars, where subtract-then-re-add round-trips are not
// exact).
const toCents = (dollars: number) => Math.round(dollars * 100)
const fromCents = (cents: number) => cents / 100

/**
 * Billable item (appointment or labwork) used for FIFO allocation
 */
export interface BillableItem {
  id: string
  type: 'appointment' | 'labwork'
  cost: number
  date: Date
  isPaid: boolean
}

/**
 * Per-item result of FIFO allocation. paidAmount is what the patient's
 * total payments cover for this specific item; outstanding is what is
 * still owed. isPaid is true only when the item is fully covered.
 */
export interface FifoAllocation {
  id: string
  type: 'appointment' | 'labwork'
  cost: number
  paidAmount: number
  outstanding: number
  isPaid: boolean
}

/**
 * Allocate a patient's total active payments across their billable items
 * in FIFO order (oldest first). When a payment partially covers an item,
 * the remainder is applied as a partial payment to that item and stops —
 * later items receive paidAmount=0 even if a smaller item could have been
 * fully covered. This keeps the model coherent with how patients reason
 * about their debt: pagos cubren deudas en orden de antigüedad sin
 * "saltearlas".
 *
 * `earmarks` (billable-item id -> amount) lets a payment recorded directly
 * against an item (a kind=APPOINTMENT consultation payment) claim its own
 * item first, up to that item's cost, before the remainder joins the FIFO
 * pool. The pool is derived by subtraction (totalPaid - sum(earmarked)),
 * never by re-summing leftovers — that is what makes "no earmarked money is
 * stranded" true by construction, and it handles over-cost earmarks and
 * earmarks pointing at items absent from `items` (cost null/0/inactive) for
 * free, with no special-casing. Called without `earmarks`, the output is
 * byte-identical to the pre-earmark behaviour.
 */
export function computeFifoAllocation(
  items: BillableItem[],
  totalPaid: number,
  earmarks?: ReadonlyMap<string, number>
): FifoAllocation[] {
  // Run the whole allocation in integer cents (see toCents at module scope;
  // this is the isPaid regression that motivated it). Comparisons, capping,
  // and the no-skip FIFO walk all happen here in cents; only the final
  // FifoAllocation is converted back to dollars, once per item.
  const costCents = items.map((item) => toCents(item.cost))
  const earmarkedCents = items.map((item, i) =>
    costCents[i] > 0 ? Math.min(toCents(earmarks?.get(item.id) ?? 0), costCents[i]) : 0
  )
  const totalEarmarkedCents = earmarkedCents.reduce((sum, cents) => sum + cents, 0)

  // Clamp to 0: totalPaid and earmarks come from separate, non-transactional
  // reads (see buildPatientAllocationMap's Promise.all), so a payment
  // inserted between them can make totalEarmarked outgrow the totalPaid
  // snapshot. Without the clamp that would go negative here.
  let remainingCents = Math.max(0, toCents(totalPaid) - totalEarmarkedCents)
  const result: FifoAllocation[] = []
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    const capacityCents = costCents[i] - earmarkedCents[i]
    const fromPoolCents = Math.min(remainingCents, capacityCents)
    remainingCents = Math.max(0, remainingCents - capacityCents)
    const paidAmountCents = earmarkedCents[i] + fromPoolCents
    result.push({
      id: item.id,
      type: item.type,
      cost: item.cost,
      paidAmount: paidAmountCents / 100,
      outstanding: Math.max(0, costCents[i] - paidAmountCents) / 100,
      isPaid: costCents[i] > 0 && paidAmountCents >= costCents[i],
    })
  }
  return result
}

/**
 * Get all billable items for a patient, ordered by date ASC (for FIFO).
 * Exported so callers (e.g. appointment.service) can compute the
 * allocation without duplicating the query.
 */
export async function listBillableItems(
  tenantId: string,
  patientId: string
): Promise<BillableItem[]> {
  return getBillableItems(tenantId, patientId)
}

/**
 * Get total active payments for a patient.
 */
export async function getTotalPaid(tenantId: string, patientId: string): Promise<number> {
  const aggregate = await prisma.patientPayment.aggregate({
    where: { tenantId, patientId, isActive: true },
    _sum: { amount: true },
  })
  return aggregate._sum.amount?.toNumber() || 0
}

/**
 * Get earmarked amounts per appointment: the sum of active kind=APPOINTMENT
 * payments linked to each appointment, keyed by appointment id. Uses
 * groupBy (not findFirst) because an appointment can carry more than one
 * active linked payment after a re-edit or a reversal-then-re-record, and
 * all of them are earmarked to it. Appointment cuids never collide with
 * labwork ids in the shared billable-item space.
 */
export async function getAppointmentEarmarks(
  tenantId: string,
  patientId: string
): Promise<Map<string, number>> {
  const grouped = await prisma.patientPayment.groupBy({
    by: ['appointmentId'],
    where: { tenantId, patientId, isActive: true, kind: 'APPOINTMENT', appointmentId: { not: null } },
    _sum: { amount: true },
  })

  const earmarks = new Map<string, number>()
  for (const row of grouped) {
    if (row.appointmentId) {
      earmarks.set(row.appointmentId, row._sum.amount?.toNumber() || 0)
    }
  }
  return earmarks
}

/**
 * Get all billable items for a patient, ordered by date ASC (for FIFO)
 */
async function getBillableItems(tenantId: string, patientId: string): Promise<BillableItem[]> {
  const [appointments, labworks] = await Promise.all([
    prisma.appointment.findMany({
      where: { tenantId, patientId, isActive: true, cost: { not: null } },
      select: { id: true, cost: true, startTime: true, isPaid: true },
      orderBy: { startTime: 'asc' },
    }),
    prisma.labwork.findMany({
      where: { tenantId, patientId, isActive: true, price: { gt: 0 }, priceIncludedInAppointment: false },
      select: { id: true, price: true, date: true, isPaid: true },
      orderBy: { date: 'asc' },
    }),
  ])

  const items: BillableItem[] = [
    ...appointments
      .filter((a) => a.cost && a.cost.toNumber() > 0)
      .map((a) => ({
        id: a.id,
        type: 'appointment' as const,
        cost: a.cost!.toNumber(),
        date: a.startTime,
        isPaid: a.isPaid,
      })),
    ...labworks.map((l) => ({
      id: l.id,
      type: 'labwork' as const,
      cost: l.price.toNumber(),
      date: l.date,
      isPaid: l.isPaid,
    })),
  ]

  // Sort by date ASC for FIFO
  items.sort((a, b) => a.date.getTime() - b.date.getTime())

  return items
}

export interface RecalculatePaidStatusResult {
  appointmentChanges: number
  labworkChanges: number
}

/**
 * Recalculate isPaid status for all billable items of a patient using FIFO allocation.
 * Total active payments are distributed to items oldest-first, with
 * kind=APPOINTMENT payments earmarked to their own appointment first.
 *
 * `options.dryRun` computes the same changes without writing them — used by
 * the recalc-paid-status backfill script to preview counts before applying.
 */
export async function recalculatePaidStatus(
  tenantId: string,
  patientId: string,
  options?: { dryRun?: boolean }
): Promise<RecalculatePaidStatusResult> {
  const dryRun = options?.dryRun ?? false

  const [items, paymentsAggregate, earmarks] = await Promise.all([
    getBillableItems(tenantId, patientId),
    prisma.patientPayment.aggregate({
      where: { tenantId, patientId, isActive: true },
      _sum: { amount: true },
    }),
    getAppointmentEarmarks(tenantId, patientId),
  ])

  const totalPaid = paymentsAggregate._sum.amount?.toNumber() || 0
  const allocations = computeFifoAllocation(items, totalPaid, earmarks)

  const appointmentUpdates: { id: string; isPaid: boolean }[] = []
  const labworkUpdates: { id: string; isPaid: boolean }[] = []

  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    const shouldBePaid = allocations[i].isPaid

    // Only update if status changed
    if (item.isPaid !== shouldBePaid) {
      if (item.type === 'appointment') {
        appointmentUpdates.push({ id: item.id, isPaid: shouldBePaid })
      } else {
        labworkUpdates.push({ id: item.id, isPaid: shouldBePaid })
      }
    }
  }

  // Auto-mark labworks with price included in appointment as paid
  const includedLabworks = await prisma.labwork.findMany({
    where: { tenantId, patientId, isActive: true, priceIncludedInAppointment: true, isPaid: false },
    select: { id: true },
  })

  const result: RecalculatePaidStatusResult = {
    appointmentChanges: appointmentUpdates.length,
    labworkChanges: labworkUpdates.length + includedLabworks.length,
  }

  if (dryRun) {
    return result
  }

  // Batch updates
  const updates: Prisma.PrismaPromise<unknown>[] = []
  for (const u of appointmentUpdates) {
    updates.push(prisma.appointment.update({ where: { id: u.id }, data: { isPaid: u.isPaid } }))
  }
  for (const u of labworkUpdates) {
    updates.push(prisma.labwork.update({ where: { id: u.id }, data: { isPaid: u.isPaid } }))
  }
  for (const l of includedLabworks) {
    updates.push(prisma.labwork.update({ where: { id: l.id }, data: { isPaid: true } }))
  }

  if (updates.length > 0) {
    await prisma.$transaction(updates)
    logger.info(
      { tenantId, patientId, updatedItems: updates.length },
      'Recalculated paid status for billable items'
    )
  }

  return result
}

/**
 * Get patient balance: total debt, total paid, outstanding
 *
 * Deliberately not earmark-aware: with A = sum(earmarked_i) and
 * P = totalPaid - A, total remaining capacity across items is
 * sum(capacity_i) = totalDebt - A, so total applied
 * = A + min(P, totalDebt - A) = min(A + P, totalDebt) = min(totalPaid, totalDebt)
 * — identical to the plain sum used here. Earmarking redistributes payments
 * *among* items, never changes the aggregate paid/outstanding/credit, so
 * this aggregate query stays correct without earmark data.
 */
export async function getPatientBalance(
  tenantId: string,
  patientId: string
): Promise<
  | {
      success: true
      data: { totalDebt: number; totalPaid: number; outstanding: number; credit: number }
    }
  | { success: false; code: PaymentErrorCode }
> {
  const patient = await prisma.patient.findFirst({
    where: { id: patientId, tenantId },
    select: { id: true },
  })

  if (!patient) {
    return { success: false, code: 'PATIENT_NOT_FOUND' }
  }

  const [appointmentsAgg, labworksAgg, paymentsAgg] = await Promise.all([
    prisma.appointment.aggregate({
      where: { tenantId, patientId, isActive: true, cost: { not: null, gt: 0 } },
      _sum: { cost: true },
    }),
    prisma.labwork.aggregate({
      where: { tenantId, patientId, isActive: true, price: { gt: 0 }, priceIncludedInAppointment: false },
      _sum: { price: true },
    }),
    prisma.patientPayment.aggregate({
      where: { tenantId, patientId, isActive: true },
      _sum: { amount: true },
    }),
  ])

  const totalDebt =
    (appointmentsAgg._sum.cost?.toNumber() || 0) + (labworksAgg._sum.price?.toNumber() || 0)
  const totalPaid = paymentsAgg._sum.amount?.toNumber() || 0
  const outstanding = Math.max(0, totalDebt - totalPaid)
  const credit = Math.max(0, totalPaid - totalDebt)

  return { success: true, data: { totalDebt, totalPaid, outstanding, credit } }
}

/**
 * Three-number account statement for a patient. The numbers are deliberately
 * kept apart: remainingBudgetProjection is a projection of planned work, never
 * debt, and is not folded into any other field.
 */
export interface PatientAccountStatement {
  /**
   * Outstanding on work already performed (appointments with a cost and
   * labworks not included in an appointment — both are billable, so both count
   * as "lo que ya se realizo"). Derived from the same FIFO allocation as
   * getPatientBalance/listDebtors, so the figures never drift.
   */
  appointmentsDebt: number
  /** Unapplied payments left after FIFO, i.e. the "saldo a favor". */
  advancesCredit: number
  /** Planned-but-not-performed budget work. A projection, never debt. */
  remainingBudgetProjection: number
  /** Total cost of the billable items behind appointmentsDebt. */
  totalBilled: number
  /** Total of active payments of any kind. */
  totalPaid: number
  /** Share of totalPaid recorded as entregas (kind = ADVANCE), applied or not. */
  advancesTotal: number
}

/**
 * Get the three-number account statement for a patient: what is owed on work
 * already performed, what is left over as credit, and what remains planned in
 * live budgets.
 */
export async function getPatientAccountStatement(
  tenantId: string,
  patientId: string
): Promise<
  { success: true; data: PatientAccountStatement } | { success: false; code: PaymentErrorCode }
> {
  const patient = await prisma.patient.findFirst({
    where: { id: patientId, tenantId },
    select: { id: true },
  })

  if (!patient) {
    return { success: false, code: 'PATIENT_NOT_FOUND' }
  }

  const [items, totalPaid, earmarks, advancesAgg, budgetItemsAgg] = await Promise.all([
    getBillableItems(tenantId, patientId),
    getTotalPaid(tenantId, patientId),
    getAppointmentEarmarks(tenantId, patientId),
    prisma.patientPayment.aggregate({
      where: { tenantId, patientId, isActive: true, kind: 'ADVANCE' },
      _sum: { amount: true },
    }),
    // Single grouped aggregate over the join: bounded query count regardless
    // of how many budgets the patient has.
    prisma.budgetItem.aggregate({
      where: {
        status: { notIn: ['EXECUTED', 'CANCELLED'] },
        budget: {
          tenantId,
          patientId,
          isActive: true,
          status: { notIn: ['DRAFT', 'CANCELLED'] },
        },
      },
      _sum: { totalPrice: true },
    }),
  ])

  const allocations = computeFifoAllocation(items, totalPaid, earmarks)
  const appointmentsDebt = allocations.reduce((sum, a) => sum + a.outstanding, 0)
  const totalBilled = items.reduce((sum, item) => sum + item.cost, 0)

  return {
    success: true,
    data: {
      appointmentsDebt,
      // Whatever FIFO could not apply to performed work. Advances already
      // consumed by an item are part of paidAmount, never counted here.
      advancesCredit: Math.max(0, totalPaid - totalBilled),
      remainingBudgetProjection: budgetItemsAgg._sum.totalPrice?.toNumber() || 0,
      totalBilled,
      totalPaid,
      advancesTotal: advancesAgg._sum.amount?.toNumber() || 0,
    },
  }
}

export interface Debtor {
  patientId: string
  name: string
  totalDebt: number
  totalPaid: number
  outstanding: number
}

function addToMap(map: Map<string, number>, patientId: string | null, cents: number): void {
  if (!patientId) return
  map.set(patientId, (map.get(patientId) || 0) + cents)
}

export interface PatientOutstanding {
  totalDebt: number
  totalPaid: number
  outstanding: number
}

/**
 * Outstanding balance per patient for the whole tenant, keyed by patientId.
 *
 * No per-patient N+1: the whole tenant is covered by exactly three grouped
 * aggregates (appointments, labworks, payments) — there is no query inside
 * any loop here, and callers must not add one.
 *
 * Uses the same filters as getPatientBalance/getBillableItems, so the debt
 * figures stay consistent with the per-patient balance view. The payments
 * aggregate deliberately carries no `kind` filter: an ADVANCE is the
 * patient's money just as much as an APPOINTMENT payment is, and that is
 * what keeps the metric stable across the cancel/restore ADVANCE conversion
 * in convertAppointmentPaymentsToAdvance.
 *
 * Deliberately not earmark-aware, for the same reason as getPatientBalance:
 * earmarking only redistributes a patient's payments among their own
 * billable items, it never changes their totalDebt/totalPaid/outstanding
 * sums. Per-patient FIFO here would turn this into an N+1 loop for no
 * change in the numbers.
 *
 * Arithmetic runs in integer cents and `outstanding` is floored at 0 per
 * patient, so a patient in credit contributes exactly 0 and can never
 * offset another patient's debt.
 */
export async function computeOutstandingByPatient(
  tenantId: string
): Promise<Map<string, PatientOutstanding>> {
  const [appointments, labworks, payments] = await Promise.all([
    prisma.appointment.groupBy({
      by: ['patientId'],
      where: { tenantId, isActive: true, cost: { not: null, gt: 0 } },
      _sum: { cost: true },
    }),
    prisma.labwork.groupBy({
      by: ['patientId'],
      where: { tenantId, isActive: true, price: { gt: 0 }, priceIncludedInAppointment: false },
      _sum: { price: true },
    }),
    prisma.patientPayment.groupBy({
      by: ['patientId'],
      where: { tenantId, isActive: true },
      _sum: { amount: true },
    }),
  ])

  const debtCentsByPatient = new Map<string, number>()
  appointments.forEach((r) =>
    addToMap(debtCentsByPatient, r.patientId, toCents(r._sum.cost?.toNumber() || 0))
  )
  labworks.forEach((r) =>
    addToMap(debtCentsByPatient, r.patientId, toCents(r._sum.price?.toNumber() || 0))
  )

  const paidCentsByPatient = new Map<string, number>()
  payments.forEach((r) =>
    addToMap(paidCentsByPatient, r.patientId, toCents(r._sum.amount?.toNumber() || 0))
  )

  const result = new Map<string, PatientOutstanding>()
  for (const [patientId, debtCents] of debtCentsByPatient) {
    const paidCents = paidCentsByPatient.get(patientId) || 0
    result.set(patientId, {
      totalDebt: fromCents(debtCents),
      totalPaid: fromCents(paidCents),
      outstanding: fromCents(Math.max(0, debtCents - paidCents)),
    })
  }
  return result
}

/**
 * Tenant-wide outstanding total: the sum of every patient's own outstanding
 * balance, each floored at 0 (see computeOutstandingByPatient). Summed in
 * cents and converted to dollars once, so it is exactly equal to the sum of
 * listDebtors' outstanding column.
 */
export async function getTenantOutstandingTotal(tenantId: string): Promise<number> {
  const byPatient = await computeOutstandingByPatient(tenantId)
  let totalCents = 0
  for (const { outstanding } of byPatient.values()) {
    totalCents += toCents(outstanding)
  }
  return fromCents(totalCents)
}

/**
 * List all patients with an outstanding balance for the tenant, sorted by
 * outstanding desc. Shares computeOutstandingByPatient with the dashboard's
 * pending-payments metric, so the two can never disagree.
 */
export async function listDebtors(tenantId: string): Promise<Debtor[]> {
  const byPatient = await computeOutstandingByPatient(tenantId)

  const patientIds = [...byPatient.entries()]
    .filter(([, balance]) => balance.outstanding > 0)
    .map(([id]) => id)

  const patients = await prisma.patient.findMany({
    where: { tenantId, id: { in: patientIds } },
    select: { id: true, firstName: true, lastName: true },
  })

  return patients
    .map((patient) => {
      const balance = byPatient.get(patient.id) as PatientOutstanding
      return {
        patientId: patient.id,
        name: `${patient.firstName} ${patient.lastName}`,
        totalDebt: balance.totalDebt,
        totalPaid: balance.totalPaid,
        outstanding: balance.outstanding,
      }
    })
    .sort((a, b) => b.outstanding - a.outstanding)
}

/**
 * Create a new payment and recalculate FIFO allocation
 */
export async function createPayment(
  tenantId: string,
  patientId: string,
  input: CreatePaymentInput
): Promise<{ success: true; data: SafePayment } | { success: false; code: PaymentErrorCode }> {
  // Verify patient exists
  const patient = await prisma.patient.findFirst({
    where: { id: patientId, tenantId },
    select: { id: true },
  })

  if (!patient) {
    return { success: false, code: 'PATIENT_NOT_FOUND' }
  }

  // Verify patient still exists before writing (balance no longer caps the amount:
  // overpayment is allowed and becomes credit, applied via FIFO on the next charge)
  const balanceResult = await getPatientBalance(tenantId, patientId)
  if (!balanceResult.success) {
    return { success: false, code: balanceResult.code }
  }

  // Create payment
  const payment = await prisma.patientPayment.create({
    data: {
      tenantId,
      patientId,
      amount: input.amount,
      date: input.date,
      note: input.note || null,
      createdBy: input.createdBy || null,
      kind: input.kind ?? 'ADVANCE',
      appointmentId: input.appointmentId || null,
    },
    select: PAYMENT_SELECT,
  })

  // Recalculate FIFO
  await recalculatePaidStatus(tenantId, patientId)

  logger.info({ paymentId: payment.id, tenantId, patientId, amount: input.amount }, 'Payment created')

  return { success: true, data: payment }
}

/**
 * List payments for a patient
 */
export async function listPayments(
  tenantId: string,
  patientId: string,
  options?: ListPaymentsOptions
): Promise<{ data: SafePayment[]; total: number }> {
  const where: Prisma.PatientPaymentWhereInput = {
    tenantId,
    patientId,
    isActive: true,
    ...(options?.kind && { kind: options.kind }),
  }

  const [payments, total] = await Promise.all([
    prisma.patientPayment.findMany({
      where,
      select: PAYMENT_SELECT,
      orderBy: { date: 'desc' },
      take: options?.limit || 50,
      skip: options?.offset || 0,
    }),
    prisma.patientPayment.count({ where }),
  ])

  return { data: payments, total }
}

// Appended to a converted payment's note so it reads as self-explanatory in
// Entregas; stripped back off on restore via a suffix match.
const CANCELLED_APPOINTMENT_NOTE_SUFFIX = ' (cita cancelada)'

/**
 * Convert every active kind=APPOINTMENT payment linked to a cancelled
 * appointment into a kind=ADVANCE payment, inside the caller's transaction.
 * appointmentId is deliberately kept (not nulled) — it is the only
 * discriminator restoreAppointmentPaymentsFromAdvance uses to find its way
 * back, and every read of PatientPayment.appointmentId elsewhere in this
 * service filters on kind too, so leaving it set cannot leak into any
 * existing FIFO/earmark computation (getAppointmentEarmarks,
 * hasRecordedAppointmentPayment both require kind='APPOINTMENT').
 *
 * findMany + a per-row update (not a set-based updateMany) because the note
 * suffix must be appended to each row's *existing* note, which SQL-side
 * updateMany cannot express. "Simplifying" this into an updateMany would
 * drop the suffix and silently break the suffix strip that
 * restoreAppointmentPaymentsFromAdvance relies on to restore the original
 * note. findMany (not findFirst) because the loop must cover every matching
 * row even if the single-active-row-per-appointment invariant enforced by
 * hasRecordedAppointmentPayment plus deletePayment's soft-delete were ever
 * violated by a race.
 */
export async function convertAppointmentPaymentsToAdvance(
  tx: Prisma.TransactionClient,
  tenantId: string,
  appointmentId: string
): Promise<void> {
  const payments = await tx.patientPayment.findMany({
    where: { tenantId, appointmentId, kind: 'APPOINTMENT', isActive: true },
    select: { id: true, note: true },
  })

  for (const payment of payments) {
    await tx.patientPayment.update({
      where: { id: payment.id },
      data: {
        kind: 'ADVANCE',
        note: `${payment.note ?? ''}${CANCELLED_APPOINTMENT_NOTE_SUFFIX}`,
      },
    })
  }
}

/**
 * Reverse convertAppointmentPaymentsToAdvance on restore: only rows this
 * feature itself converted can match (kind=ADVANCE with a non-null
 * appointmentId), because the only client-facing payment-creation endpoint
 * (POST /api/patients/:id/payments, createPaymentSchema in
 * apps/api/src/routes/patients.ts) accepts just {amount, date, note} — kind
 * always falls to createPayment's 'ADVANCE' default and appointmentId to
 * null. A payment the operator deleted (isActive=false) in the meantime is
 * deliberately excluded: the money was given back, so the restored
 * appointment should read as unpaid again.
 */
export async function restoreAppointmentPaymentsFromAdvance(
  tx: Prisma.TransactionClient,
  tenantId: string,
  appointmentId: string
): Promise<void> {
  const payments = await tx.patientPayment.findMany({
    where: { tenantId, appointmentId, kind: 'ADVANCE', isActive: true },
    select: { id: true, note: true },
  })

  for (const payment of payments) {
    await tx.patientPayment.update({
      where: { id: payment.id },
      data: {
        kind: 'APPOINTMENT',
        note: payment.note?.endsWith(CANCELLED_APPOINTMENT_NOTE_SUFFIX)
          ? payment.note.slice(0, -CANCELLED_APPOINTMENT_NOTE_SUFFIX.length)
          : payment.note,
      },
    })
  }
}

/**
 * Soft delete a payment and recalculate FIFO allocation
 */
export async function deletePayment(
  tenantId: string,
  paymentId: string
): Promise<{ success: true; data: SafePayment } | { success: false; code: PaymentErrorCode }> {
  const payment = await prisma.patientPayment.findFirst({
    where: { id: paymentId, tenantId },
    select: { id: true, patientId: true, isActive: true },
  })

  if (!payment) {
    return { success: false, code: 'NOT_FOUND' }
  }

  if (!payment.isActive) {
    return { success: false, code: 'ALREADY_INACTIVE' }
  }

  const updated = await prisma.patientPayment.update({
    where: { id: paymentId },
    data: { isActive: false },
    select: PAYMENT_SELECT,
  })

  // Recalculate FIFO after removing payment
  await recalculatePaidStatus(tenantId, payment.patientId)

  logger.info({ paymentId, tenantId, patientId: payment.patientId }, 'Payment soft deleted')

  return { success: true, data: updated }
}
