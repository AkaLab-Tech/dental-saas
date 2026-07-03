import crypto from 'crypto'
import { prisma, Prisma, BudgetStatus, BudgetItemStatus } from '@dental/database'
import { logger } from '../utils/logger.js'

const BUDGET_ITEM_SELECT = {
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
  createdAt: true,
  updatedAt: true,
} as const

const BUDGET_SELECT = {
  id: true,
  tenantId: true,
  patientId: true,
  createdById: true,
  status: true,
  notes: true,
  validUntil: true,
  totalAmount: true,
  publicToken: true,
  publicTokenExpiresAt: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  items: {
    select: BUDGET_ITEM_SELECT,
    orderBy: { order: 'asc' },
  },
} as const satisfies Prisma.BudgetSelect

export type BudgetErrorCode =
  | 'NOT_FOUND'
  | 'PATIENT_NOT_FOUND'
  | 'ALREADY_INACTIVE'
  | 'ITEM_NOT_FOUND'
  | 'INVALID_STATUS_TRANSITION'

export interface BudgetItemInput {
  description: string
  toothNumber?: string | null
  quantity: number
  unitPrice: number
  plannedAppointmentType?: string | null
  notes?: string | null
  order?: number
}

export interface CreateBudgetInput {
  notes?: string | null
  validUntil?: Date | null
  status?: BudgetStatus
  items: BudgetItemInput[]
  createdById?: string | null
}

export interface UpdateBudgetInput {
  notes?: string | null
  validUntil?: Date | null
  status?: BudgetStatus
}

export interface UpdateBudgetItemInput {
  description?: string
  toothNumber?: string | null
  quantity?: number
  unitPrice?: number
  plannedAppointmentType?: string | null
  notes?: string | null
  order?: number
  status?: BudgetItemStatus
}

export interface ListBudgetsOptions {
  limit?: number
  offset?: number
  includeInactive?: boolean
}

export interface ShareTokenOptions {
  /** Optional expiry for the generated link. Omit for no expiry. */
  expiresInDays?: number
}

/** Tenant branding shown on the public (unauthenticated) budget page. Never includes tenantId. */
export interface PublicBudgetTenantInfo {
  name: string
  email: string | null
  phone: string | null
  address: string | null
  logo: string | null
  currency: string
  language: string
}

export interface PublicBudgetPatientInfo {
  firstName: string
  lastName: string
}

export interface PublicBudgetData {
  id: string
  status: BudgetStatus
  notes: string | null
  validUntil: Date | null
  totalAmount: Prisma.Decimal
  createdAt: Date
  items: Prisma.BudgetItemGetPayload<{ select: typeof BUDGET_ITEM_SELECT }>[]
  patient: PublicBudgetPatientInfo
  tenant: PublicBudgetTenantInfo
}

function computeItemTotal(quantity: number, unitPrice: number): Prisma.Decimal {
  return new Prisma.Decimal(unitPrice).mul(quantity)
}

function computeBudgetTotal(items: { totalPrice: Prisma.Decimal }[]): Prisma.Decimal {
  return items.reduce((sum, item) => sum.add(item.totalPrice), new Prisma.Decimal(0))
}

/**
 * Recalculate Budget.status from its items.
 * DRAFT / APPROVED / CANCELLED are sticky unless items drive them into PARTIAL / COMPLETED.
 * Once PARTIAL or COMPLETED is reached, further item changes can move back to PARTIAL or APPROVED.
 */
function deriveBudgetStatus(
  currentStatus: BudgetStatus,
  items: { status: BudgetItemStatus }[]
): BudgetStatus {
  if (currentStatus === 'CANCELLED' || currentStatus === 'DRAFT') {
    return currentStatus
  }
  const activeItems = items.filter((i) => i.status !== 'CANCELLED')
  if (activeItems.length === 0) {
    return currentStatus
  }
  const executedCount = activeItems.filter((i) => i.status === 'EXECUTED').length
  if (executedCount === 0) {
    // Keep whatever approved-like status it had (APPROVED, PARTIAL reverts to APPROVED)
    return currentStatus === 'PARTIAL' ? 'APPROVED' : currentStatus
  }
  if (executedCount === activeItems.length) {
    return 'COMPLETED'
  }
  return 'PARTIAL'
}

/**
 * Recompute Budget.totalAmount and Budget.status atomically.
 */
async function recalculateBudgetAggregates(
  tx: Prisma.TransactionClient,
  budgetId: string
): Promise<void> {
  const [budget, items] = await Promise.all([
    tx.budget.findUnique({
      where: { id: budgetId },
      select: { status: true },
    }),
    tx.budgetItem.findMany({
      where: { budgetId },
      select: { totalPrice: true, status: true },
    }),
  ])

  if (!budget) return

  const totalAmount = computeBudgetTotal(items)
  const nextStatus = deriveBudgetStatus(budget.status, items)

  await tx.budget.update({
    where: { id: budgetId },
    data: { totalAmount, status: nextStatus },
  })
}

export async function createBudget(
  tenantId: string,
  patientId: string,
  input: CreateBudgetInput
): Promise<
  | { success: true; data: Prisma.BudgetGetPayload<{ select: typeof BUDGET_SELECT }> }
  | { success: false; code: BudgetErrorCode }
> {
  const patient = await prisma.patient.findFirst({
    where: { id: patientId, tenantId },
    select: { id: true },
  })

  if (!patient) {
    return { success: false, code: 'PATIENT_NOT_FOUND' }
  }

  const budget = await prisma.$transaction(async (tx) => {
    const created = await tx.budget.create({
      data: {
        tenantId,
        patientId,
        createdById: input.createdById ?? null,
        status: input.status ?? 'DRAFT',
        notes: input.notes ?? null,
        validUntil: input.validUntil ?? null,
        totalAmount: 0,
        items: {
          create: input.items.map((item, index) => ({
            description: item.description,
            toothNumber: item.toothNumber ?? null,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            totalPrice: computeItemTotal(item.quantity, item.unitPrice),
            plannedAppointmentType: item.plannedAppointmentType ?? null,
            notes: item.notes ?? null,
            order: item.order ?? index,
          })),
        },
      },
      select: { id: true },
    })

    await recalculateBudgetAggregates(tx, created.id)

    return tx.budget.findUniqueOrThrow({
      where: { id: created.id },
      select: BUDGET_SELECT,
    })
  })

  logger.info(
    { budgetId: budget.id, tenantId, patientId, itemCount: input.items.length },
    'Budget created'
  )

  return { success: true, data: budget }
}

export async function getBudget(
  tenantId: string,
  budgetId: string
): Promise<
  | { success: true; data: Prisma.BudgetGetPayload<{ select: typeof BUDGET_SELECT }> }
  | { success: false; code: BudgetErrorCode }
> {
  const budget = await prisma.budget.findFirst({
    where: { id: budgetId, tenantId },
    select: BUDGET_SELECT,
  })

  if (!budget) {
    return { success: false, code: 'NOT_FOUND' }
  }

  return { success: true, data: budget }
}

export async function listBudgetsByPatient(
  tenantId: string,
  patientId: string,
  options?: ListBudgetsOptions
): Promise<{
  data: Prisma.BudgetGetPayload<{ select: typeof BUDGET_SELECT }>[]
  total: number
}> {
  const where: Prisma.BudgetWhereInput = {
    tenantId,
    patientId,
    ...(options?.includeInactive ? {} : { isActive: true }),
  }

  const [data, total] = await Promise.all([
    prisma.budget.findMany({
      where,
      select: BUDGET_SELECT,
      orderBy: { createdAt: 'desc' },
      take: options?.limit ?? 50,
      skip: options?.offset ?? 0,
    }),
    prisma.budget.count({ where }),
  ])

  return { data, total }
}

export async function updateBudget(
  tenantId: string,
  budgetId: string,
  input: UpdateBudgetInput
): Promise<
  | { success: true; data: Prisma.BudgetGetPayload<{ select: typeof BUDGET_SELECT }> }
  | { success: false; code: BudgetErrorCode }
> {
  const existing = await prisma.budget.findFirst({
    where: { id: budgetId, tenantId },
    select: { id: true, status: true, isActive: true },
  })

  if (!existing || !existing.isActive) {
    return { success: false, code: 'NOT_FOUND' }
  }

  const data: Prisma.BudgetUpdateInput = {}
  if (input.notes !== undefined) data.notes = input.notes
  if (input.validUntil !== undefined) data.validUntil = input.validUntil
  if (input.status !== undefined) data.status = input.status

  const updated = await prisma.$transaction(async (tx) => {
    await tx.budget.update({ where: { id: budgetId }, data })
    // A manual status change still gets normalized against item state
    await recalculateBudgetAggregates(tx, budgetId)
    return tx.budget.findUniqueOrThrow({
      where: { id: budgetId },
      select: BUDGET_SELECT,
    })
  })

  logger.info({ budgetId, tenantId }, 'Budget updated')
  return { success: true, data: updated }
}

export async function deleteBudget(
  tenantId: string,
  budgetId: string
): Promise<
  | { success: true; data: Prisma.BudgetGetPayload<{ select: typeof BUDGET_SELECT }> }
  | { success: false; code: BudgetErrorCode }
> {
  const existing = await prisma.budget.findFirst({
    where: { id: budgetId, tenantId },
    select: { id: true, isActive: true },
  })

  if (!existing) return { success: false, code: 'NOT_FOUND' }
  if (!existing.isActive) return { success: false, code: 'ALREADY_INACTIVE' }

  const updated = await prisma.budget.update({
    where: { id: budgetId },
    data: { isActive: false },
    select: BUDGET_SELECT,
  })

  logger.info({ budgetId, tenantId }, 'Budget soft deleted')
  return { success: true, data: updated }
}

export async function addBudgetItem(
  tenantId: string,
  budgetId: string,
  input: BudgetItemInput
): Promise<
  | { success: true; data: Prisma.BudgetGetPayload<{ select: typeof BUDGET_SELECT }> }
  | { success: false; code: BudgetErrorCode }
> {
  const budget = await prisma.budget.findFirst({
    where: { id: budgetId, tenantId, isActive: true },
    select: { id: true },
  })

  if (!budget) return { success: false, code: 'NOT_FOUND' }

  const result = await prisma.$transaction(async (tx) => {
    const currentMaxOrder = await tx.budgetItem.aggregate({
      where: { budgetId },
      _max: { order: true },
    })
    const nextOrder = input.order ?? (currentMaxOrder._max.order ?? -1) + 1

    await tx.budgetItem.create({
      data: {
        budgetId,
        description: input.description,
        toothNumber: input.toothNumber ?? null,
        quantity: input.quantity,
        unitPrice: input.unitPrice,
        totalPrice: computeItemTotal(input.quantity, input.unitPrice),
        plannedAppointmentType: input.plannedAppointmentType ?? null,
        notes: input.notes ?? null,
        order: nextOrder,
      },
    })

    await recalculateBudgetAggregates(tx, budgetId)

    return tx.budget.findUniqueOrThrow({
      where: { id: budgetId },
      select: BUDGET_SELECT,
    })
  })

  logger.info({ budgetId, tenantId }, 'Budget item added')
  return { success: true, data: result }
}

export async function updateBudgetItem(
  tenantId: string,
  budgetId: string,
  itemId: string,
  input: UpdateBudgetItemInput
): Promise<
  | { success: true; data: Prisma.BudgetGetPayload<{ select: typeof BUDGET_SELECT }> }
  | { success: false; code: BudgetErrorCode }
> {
  const item = await prisma.budgetItem.findFirst({
    where: { id: itemId, budgetId, budget: { tenantId, isActive: true } },
    select: {
      id: true,
      quantity: true,
      unitPrice: true,
    },
  })

  if (!item) return { success: false, code: 'ITEM_NOT_FOUND' }

  const nextQuantity = input.quantity ?? item.quantity
  const nextUnitPrice =
    input.unitPrice !== undefined ? new Prisma.Decimal(input.unitPrice) : item.unitPrice

  const data: Prisma.BudgetItemUpdateInput = {
    totalPrice: new Prisma.Decimal(nextUnitPrice).mul(nextQuantity),
  }
  if (input.description !== undefined) data.description = input.description
  if (input.toothNumber !== undefined) data.toothNumber = input.toothNumber
  if (input.quantity !== undefined) data.quantity = input.quantity
  if (input.unitPrice !== undefined) data.unitPrice = input.unitPrice
  if (input.plannedAppointmentType !== undefined)
    data.plannedAppointmentType = input.plannedAppointmentType
  if (input.notes !== undefined) data.notes = input.notes
  if (input.order !== undefined) data.order = input.order
  if (input.status !== undefined) data.status = input.status

  const result = await prisma.$transaction(async (tx) => {
    await tx.budgetItem.update({ where: { id: itemId }, data })
    await recalculateBudgetAggregates(tx, budgetId)
    return tx.budget.findUniqueOrThrow({
      where: { id: budgetId },
      select: BUDGET_SELECT,
    })
  })

  logger.info({ budgetId, itemId, tenantId }, 'Budget item updated')
  return { success: true, data: result }
}

export async function deleteBudgetItem(
  tenantId: string,
  budgetId: string,
  itemId: string
): Promise<
  | { success: true; data: Prisma.BudgetGetPayload<{ select: typeof BUDGET_SELECT }> }
  | { success: false; code: BudgetErrorCode }
> {
  const item = await prisma.budgetItem.findFirst({
    where: { id: itemId, budgetId, budget: { tenantId, isActive: true } },
    select: { id: true },
  })

  if (!item) return { success: false, code: 'ITEM_NOT_FOUND' }

  const result = await prisma.$transaction(async (tx) => {
    await tx.budgetItem.delete({ where: { id: itemId } })
    await recalculateBudgetAggregates(tx, budgetId)
    return tx.budget.findUniqueOrThrow({
      where: { id: budgetId },
      select: BUDGET_SELECT,
    })
  })

  logger.info({ budgetId, itemId, tenantId }, 'Budget item deleted')
  return { success: true, data: result }
}

/**
 * Generate (or rotate) the public share token for a budget.
 * No expiry by default; pass `expiresInDays` to set one.
 */
export async function generateShareToken(
  tenantId: string,
  budgetId: string,
  options: ShareTokenOptions = {}
): Promise<
  | { success: true; data: { token: string; expiresAt: Date | null } }
  | { success: false; code: BudgetErrorCode }
> {
  const existing = await prisma.budget.findFirst({
    where: { id: budgetId, tenantId, isActive: true },
    select: { id: true },
  })

  if (!existing) return { success: false, code: 'NOT_FOUND' }

  const token = crypto.randomBytes(32).toString('hex')
  const expiresAt = options.expiresInDays
    ? new Date(Date.now() + options.expiresInDays * 24 * 60 * 60 * 1000)
    : null

  await prisma.budget.update({
    where: { id: budgetId },
    data: { publicToken: token, publicTokenExpiresAt: expiresAt },
  })

  logger.info({ budgetId, tenantId }, 'Budget share token generated')
  return { success: true, data: { token, expiresAt } }
}

/**
 * Tenant-agnostic lookup for the public budget share page.
 * Rejects inactive budgets and expired tokens without distinguishing
 * between "not found" and "expired" in the response, to avoid leaking
 * token validity to an unauthenticated caller.
 */
export async function getBudgetByPublicToken(
  token: string
): Promise<{ success: true; data: PublicBudgetData } | { success: false; code: 'NOT_FOUND' }> {
  const budget = await prisma.budget.findUnique({
    where: { publicToken: token },
    select: {
      id: true,
      status: true,
      notes: true,
      validUntil: true,
      totalAmount: true,
      createdAt: true,
      isActive: true,
      publicTokenExpiresAt: true,
      items: { select: BUDGET_ITEM_SELECT, orderBy: { order: 'asc' } },
      patient: { select: { firstName: true, lastName: true } },
      tenant: {
        select: {
          name: true,
          email: true,
          phone: true,
          address: true,
          logo: true,
          currency: true,
          settings: { select: { language: true } },
        },
      },
    },
  })

  if (!budget || !budget.isActive) return { success: false, code: 'NOT_FOUND' }
  if (budget.publicTokenExpiresAt && budget.publicTokenExpiresAt < new Date()) {
    return { success: false, code: 'NOT_FOUND' }
  }

  return {
    success: true,
    data: {
      id: budget.id,
      status: budget.status,
      notes: budget.notes,
      validUntil: budget.validUntil,
      totalAmount: budget.totalAmount,
      createdAt: budget.createdAt,
      items: budget.items,
      patient: budget.patient,
      tenant: {
        name: budget.tenant.name,
        email: budget.tenant.email,
        phone: budget.tenant.phone,
        address: budget.tenant.address,
        logo: budget.tenant.logo,
        currency: budget.tenant.currency,
        language: budget.tenant.settings?.language || 'es',
      },
    },
  }
}
