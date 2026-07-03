import { prisma, Prisma, type BudgetItemAppointmentRole } from '@dental/database'
import { logger } from '../utils/logger.js'
import { recalculateBudgetAggregates } from './budget.service.js'

const BUDGET_ITEM_SUMMARY_SELECT = {
  id: true,
  budgetId: true,
  description: true,
  toothNumber: true,
  quantity: true,
  unitPrice: true,
  totalPrice: true,
  plannedAppointmentType: true,
  status: true,
  notes: true,
  order: true,
} as const satisfies Prisma.BudgetItemSelect

export type BudgetAppointmentErrorCode =
  | 'APPOINTMENT_NOT_FOUND'
  | 'ITEM_NOT_FOUND'
  | 'ITEM_NOT_ELIGIBLE'
  | 'ITEM_NOT_ASSOCIATED'

export type AppointmentBudgetItemSummary = Prisma.BudgetItemGetPayload<{
  select: typeof BUDGET_ITEM_SUMMARY_SELECT
}> & { roles: BudgetItemAppointmentRole[] }

/** Internal control-flow error carrying a BudgetAppointmentErrorCode out of a $transaction rollback. */
class BudgetAppointmentServiceError extends Error {
  constructor(public readonly code: BudgetAppointmentErrorCode) {
    super(code)
    this.name = 'BudgetAppointmentServiceError'
  }
}

async function verifyAppointmentInTenant(
  tenantId: string,
  appointmentId: string
): Promise<boolean> {
  const appointment = await prisma.appointment.findFirst({
    where: { id: appointmentId, tenantId },
    select: { id: true },
  })
  return appointment !== null
}

/**
 * Load the budget items currently associated to an appointment, grouped by
 * item with every role (SCHEDULED and/or EXECUTED) they hold for it.
 * Not tenant-scoped on its own — callers must have already verified the
 * appointment belongs to the tenant.
 */
async function loadAppointmentBudgetItems(
  appointmentId: string
): Promise<AppointmentBudgetItemSummary[]> {
  const links = await prisma.budgetItemAppointment.findMany({
    where: { appointmentId },
    select: {
      role: true,
      budgetItem: { select: BUDGET_ITEM_SUMMARY_SELECT },
    },
  })

  const byItem = new Map<string, AppointmentBudgetItemSummary>()
  for (const link of links) {
    const existing = byItem.get(link.budgetItem.id)
    if (existing) {
      if (!existing.roles.includes(link.role)) existing.roles.push(link.role)
    } else {
      byItem.set(link.budgetItem.id, { ...link.budgetItem, roles: [link.role] })
    }
  }

  return Array.from(byItem.values()).sort((a, b) => a.order - b.order)
}

/**
 * Replace-set the SCHEDULED budget-item associations for an appointment.
 *
 * - Items newly present in `itemIds`: must belong to an active budget in the
 *   same tenant and currently be PENDING or SCHEDULED; promoted to SCHEDULED
 *   and linked with a role=SCHEDULED join row (upsert, so re-sending the same
 *   id is a no-op).
 * - Items previously SCHEDULED-linked to this appointment but absent from
 *   `itemIds`: the SCHEDULED join row is removed; the item reverts to
 *   PENDING only if it is still SCHEDULED (not IN_PROGRESS/EXECUTED/CANCELLED
 *   via some other path) and holds no EXECUTED join row anywhere — an
 *   executed item is never un-executed by unassociation.
 *
 * All reads/writes run in one transaction; every budget touched by an
 * add or a remove gets its aggregates recalculated in the same transaction.
 */
export async function setAppointmentBudgetItems(
  tenantId: string,
  appointmentId: string,
  itemIds: string[],
  userId: string | null
): Promise<
  | { success: true; data: AppointmentBudgetItemSummary[] }
  | { success: false; code: BudgetAppointmentErrorCode }
> {
  const appointmentExists = await verifyAppointmentInTenant(tenantId, appointmentId)
  if (!appointmentExists) return { success: false, code: 'APPOINTMENT_NOT_FOUND' }

  const desiredIds = Array.from(new Set(itemIds))

  try {
    await prisma.$transaction(async (tx) => {
      const currentLinks = await tx.budgetItemAppointment.findMany({
        where: { appointmentId, role: 'SCHEDULED' },
        select: { budgetItemId: true },
      })
      const currentIds = new Set(currentLinks.map((link) => link.budgetItemId))

      const toAdd = desiredIds.filter((id) => !currentIds.has(id))
      const toRemove = [...currentIds].filter((id) => !desiredIds.includes(id))

      const affectedBudgetIds = new Set<string>()

      for (const itemId of toAdd) {
        const item = await tx.budgetItem.findFirst({
          where: { id: itemId, budget: { tenantId, isActive: true } },
          select: { id: true, budgetId: true, status: true },
        })
        if (!item) throw new BudgetAppointmentServiceError('ITEM_NOT_FOUND')
        if (item.status !== 'PENDING' && item.status !== 'SCHEDULED') {
          throw new BudgetAppointmentServiceError('ITEM_NOT_ELIGIBLE')
        }

        await tx.budgetItem.update({ where: { id: itemId }, data: { status: 'SCHEDULED' } })
        await tx.budgetItemAppointment.upsert({
          where: {
            budgetItemId_appointmentId_role: {
              budgetItemId: itemId,
              appointmentId,
              role: 'SCHEDULED',
            },
          },
          create: { budgetItemId: itemId, appointmentId, role: 'SCHEDULED', createdById: userId },
          update: {},
        })
        affectedBudgetIds.add(item.budgetId)
      }

      for (const itemId of toRemove) {
        const item = await tx.budgetItem.findFirst({
          where: { id: itemId, budget: { tenantId } },
          select: { id: true, budgetId: true, status: true },
        })
        if (!item) continue

        await tx.budgetItemAppointment.deleteMany({
          where: { budgetItemId: itemId, appointmentId, role: 'SCHEDULED' },
        })

        if (item.status === 'SCHEDULED') {
          const hasExecutedRow = await tx.budgetItemAppointment.findFirst({
            where: { budgetItemId: itemId, role: 'EXECUTED' },
            select: { id: true },
          })
          if (!hasExecutedRow) {
            await tx.budgetItem.update({ where: { id: itemId }, data: { status: 'PENDING' } })
          }
        }
        affectedBudgetIds.add(item.budgetId)
      }

      for (const budgetId of affectedBudgetIds) {
        await recalculateBudgetAggregates(tx, budgetId)
      }
    })
  } catch (e) {
    if (e instanceof BudgetAppointmentServiceError) {
      return { success: false, code: e.code }
    }
    throw e
  }

  const data = await loadAppointmentBudgetItems(appointmentId)
  logger.info({ tenantId, appointmentId, itemIds: desiredIds }, 'Appointment budget items updated')
  return { success: true, data }
}

/**
 * Verify that every id in `itemIds` is currently SCHEDULED-linked to
 * `appointmentId` and belongs to a budget in `tenantId`. Throws
 * BudgetAppointmentServiceError('ITEM_NOT_ASSOCIATED' | 'ITEM_NOT_FOUND') on
 * the first violation. Read-only — safe to call with either the module
 * `prisma` client or an open transaction's `tx` client.
 */
async function assertItemsExecutable(
  client: Prisma.TransactionClient,
  tenantId: string,
  appointmentId: string,
  itemIds: string[]
): Promise<void> {
  const links = await client.budgetItemAppointment.findMany({
    where: { appointmentId, role: 'SCHEDULED', budgetItemId: { in: itemIds } },
    select: { budgetItemId: true },
  })
  const linkedIds = new Set(links.map((link) => link.budgetItemId))
  for (const itemId of itemIds) {
    if (!linkedIds.has(itemId)) {
      throw new BudgetAppointmentServiceError('ITEM_NOT_ASSOCIATED')
    }
  }

  for (const itemId of itemIds) {
    const item = await client.budgetItem.findFirst({
      where: { id: itemId, budget: { tenantId } },
      select: { id: true },
    })
    if (!item) throw new BudgetAppointmentServiceError('ITEM_NOT_FOUND')
  }
}

/**
 * Read-only pre-check for confirmExecutedBudgetItems: reports whether every
 * id in `itemIds` is currently SCHEDULED-linked to `appointmentId` (and would
 * therefore be confirmable), without writing anything. Callers that must not
 * leave side effects committed on a failing confirmation (e.g. marking an
 * appointment done) should call this first and only proceed to
 * confirmExecutedBudgetItems once it succeeds.
 */
export async function validateExecutableBudgetItems(
  tenantId: string,
  appointmentId: string,
  itemIds: string[]
): Promise<{ success: true } | { success: false; code: BudgetAppointmentErrorCode }> {
  const appointmentExists = await verifyAppointmentInTenant(tenantId, appointmentId)
  if (!appointmentExists) return { success: false, code: 'APPOINTMENT_NOT_FOUND' }

  const desiredIds = Array.from(new Set(itemIds))
  if (desiredIds.length === 0) return { success: true }

  try {
    await assertItemsExecutable(prisma, tenantId, appointmentId, desiredIds)
  } catch (e) {
    if (e instanceof BudgetAppointmentServiceError) {
      return { success: false, code: e.code }
    }
    throw e
  }

  return { success: true }
}

/**
 * Confirm doctor execution of a subset of the budget items currently
 * SCHEDULED-linked to an appointment: promotes each to EXECUTED and adds a
 * role=EXECUTED join row (upsert, idempotent on repeat calls). Items not
 * listed remain SCHEDULED — there is no auto-execution of the rest.
 * Rejects any id not currently SCHEDULED-linked to this appointment.
 */
export async function confirmExecutedBudgetItems(
  tenantId: string,
  appointmentId: string,
  itemIds: string[],
  userId: string | null
): Promise<
  | { success: true; data: AppointmentBudgetItemSummary[] }
  | { success: false; code: BudgetAppointmentErrorCode }
> {
  const appointmentExists = await verifyAppointmentInTenant(tenantId, appointmentId)
  if (!appointmentExists) return { success: false, code: 'APPOINTMENT_NOT_FOUND' }

  const desiredIds = Array.from(new Set(itemIds))

  if (desiredIds.length > 0) {
    try {
      await prisma.$transaction(async (tx) => {
        await assertItemsExecutable(tx, tenantId, appointmentId, desiredIds)

        const affectedBudgetIds = new Set<string>()

        for (const itemId of desiredIds) {
          const item = await tx.budgetItem.findFirst({
            where: { id: itemId, budget: { tenantId } },
            select: { id: true, budgetId: true },
          })
          if (!item) throw new BudgetAppointmentServiceError('ITEM_NOT_FOUND')

          await tx.budgetItem.update({ where: { id: itemId }, data: { status: 'EXECUTED' } })
          await tx.budgetItemAppointment.upsert({
            where: {
              budgetItemId_appointmentId_role: {
                budgetItemId: itemId,
                appointmentId,
                role: 'EXECUTED',
              },
            },
            create: { budgetItemId: itemId, appointmentId, role: 'EXECUTED', createdById: userId },
            update: {},
          })
          affectedBudgetIds.add(item.budgetId)
        }

        for (const budgetId of affectedBudgetIds) {
          await recalculateBudgetAggregates(tx, budgetId)
        }
      })
    } catch (e) {
      if (e instanceof BudgetAppointmentServiceError) {
        return { success: false, code: e.code }
      }
      throw e
    }
  }

  const data = await loadAppointmentBudgetItems(appointmentId)
  logger.info(
    { tenantId, appointmentId, itemIds: desiredIds },
    'Appointment budget items confirmed executed'
  )
  return { success: true, data }
}

/**
 * Return the budget items currently associated (any role) to an appointment,
 * for edit/completion hydration.
 */
export async function getAppointmentBudgetItems(
  tenantId: string,
  appointmentId: string
): Promise<
  | { success: true; data: AppointmentBudgetItemSummary[] }
  | { success: false; code: BudgetAppointmentErrorCode }
> {
  const appointmentExists = await verifyAppointmentInTenant(tenantId, appointmentId)
  if (!appointmentExists) return { success: false, code: 'APPOINTMENT_NOT_FOUND' }

  const data = await loadAppointmentBudgetItems(appointmentId)
  return { success: true, data }
}
