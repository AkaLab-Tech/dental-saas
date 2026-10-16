#!/usr/bin/env tsx
/**
 * Read-only report for task #546: appointments that carry BOTH a typed cost
 * and at least one budget item linked with role EXECUTED.
 *
 * Since #544 an executed budget item creates its own charge. Task #590 made
 * the appointment's own `cost` the single authority for its visit: when the
 * appointment carries a cost above zero and is not CANCELLED, its executed
 * items no longer bill on their own (see APPOINTMENT_COST_IS_THE_AUTHORITY in
 * payment.service.ts).
 *
 * The predicate below is deliberately WIDER than that rule - it filters
 * neither `cost > 0` nor `status` - so the rows it returns are of two kinds,
 * and each row prints which one it is: the rows #590 moves, whose debt falls
 * by at most what their executed items used to add (at most because
 * getBillableItems skips per LINK, so an item executed on another visit the
 * rule leaves alone keeps billing there), and the rows the rule leaves
 * alone (a typed cost of zero, or a CANCELLED appointment), where the items
 * keep billing and the printed subtotal is no fall in debt. Keeping both
 * kinds visible is the point - this is the instrument for reviewing the
 * population by hand, and a reporting predicate narrowed to the rule would
 * hide rows nobody would then know to look for. It still names nothing a
 * duplicate and adds up no "amount overcharged": the typed cost may
 * legitimately cover work the items do not.
 *
 * Predicate:
 *   appointment.isActive = true AND appointment.cost IS NOT NULL
 *   AND the appointment has a BudgetItemAppointment with role = EXECUTED whose
 *   item belongs to a budget with isActive = true.
 * The link has no active flag. Budget.status and BudgetItem.status are NOT
 * filtered - they are printed per row so a contradictory row stays visible.
 *
 * This script never writes. It has no --apply and no --dry-run: there is no
 * mutating mode to contrast with. Patient names are never selected; rows are
 * identified by patient id.
 *
 * Usage:
 *   pnpm --filter @dental/api report:cost-budget-overlap
 *   pnpm --filter @dental/api report:cost-budget-overlap -- --tenant=<id> --limit=50 --json
 */

import { basename, extname } from 'node:path'

import { prisma, disconnectDatabase } from '@dental/database'

export interface OverlapItem {
  budgetItemId: string
  budgetId: string
  description: string
  toothNumber: string | null
  totalPrice: string
  itemStatus: string
  budgetStatus: string
}

export interface OverlapAppointment {
  appointmentId: string
  startTime: Date
  appointmentStatus: string
  typedCost: string
  executedItems: OverlapItem[]
  executedItemsSubtotal: string
}

export interface OverlapPatient {
  patientId: string
  appointments: OverlapAppointment[]
}

export interface OverlapTenant {
  tenantId: string
  patients: OverlapPatient[]
}

export interface CostBudgetOverlapReport {
  tenants: OverlapTenant[]
  appointmentCount: number
}

export interface ReportOptions {
  tenantId?: string
  limit?: number
}

export async function findCostBudgetOverlaps(
  options: ReportOptions = {}
): Promise<CostBudgetOverlapReport> {
  const executedLink = {
    role: 'EXECUTED' as const,
    budgetItem: { budget: { isActive: true } },
  }

  const appointments = await prisma.appointment.findMany({
    where: {
      isActive: true,
      cost: { not: null },
      ...(options.tenantId ? { tenantId: options.tenantId } : {}),
      budgetItemAppointments: { some: executedLink },
    },
    select: {
      id: true,
      tenantId: true,
      patientId: true,
      startTime: true,
      status: true,
      cost: true,
      budgetItemAppointments: {
        where: executedLink,
        select: {
          budgetItem: {
            select: {
              id: true,
              budgetId: true,
              description: true,
              toothNumber: true,
              totalPrice: true,
              status: true,
              budget: { select: { status: true } },
            },
          },
        },
      },
    },
    orderBy: [{ tenantId: 'asc' }, { patientId: 'asc' }, { startTime: 'asc' }, { id: 'asc' }],
    ...(options.limit ? { take: options.limit } : {}),
  })

  const tenants = new Map<string, Map<string, OverlapAppointment[]>>()
  for (const appointment of appointments) {
    const executedItems: OverlapItem[] = appointment.budgetItemAppointments.map(({ budgetItem }) => ({
      budgetItemId: budgetItem.id,
      budgetId: budgetItem.budgetId,
      description: budgetItem.description,
      toothNumber: budgetItem.toothNumber,
      totalPrice: budgetItem.totalPrice.toFixed(2),
      itemStatus: budgetItem.status,
      budgetStatus: budgetItem.budget.status,
    }))
    const subtotal = appointment.budgetItemAppointments.reduce(
      (sum, { budgetItem }) => sum.plus(budgetItem.totalPrice),
      appointment.cost!.mul(0)
    )

    const patients = tenants.get(appointment.tenantId) ?? new Map<string, OverlapAppointment[]>()
    tenants.set(appointment.tenantId, patients)
    const rows = patients.get(appointment.patientId) ?? []
    patients.set(appointment.patientId, rows)
    rows.push({
      appointmentId: appointment.id,
      startTime: appointment.startTime,
      appointmentStatus: appointment.status,
      typedCost: appointment.cost!.toFixed(2),
      executedItems,
      executedItemsSubtotal: subtotal.toFixed(2),
    })
  }

  return {
    appointmentCount: appointments.length,
    tenants: [...tenants].map(([tenantId, patients]) => ({
      tenantId,
      patients: [...patients].map(([patientId, rows]) => ({ patientId, appointments: rows })),
    })),
  }
}

// Mirrors appointmentCostSupersedesItems in payment.service.ts, over the fields the
// row already prints: the query is wider than the rule, so each row has to say which
// side of it it falls on instead of leaving the reader to apply the rule by hand.
function supersessionNote(appt: OverlapAppointment): string {
  if (appt.appointmentStatus === 'CANCELLED')
    return 'Typed cost supersedes the executed items: no - the appointment is CANCELLED, so it bills nothing of its own, the items keep billing, and this subtotal is no fall in debt.'
  if (Number(appt.typedCost) <= 0)
    return 'Typed cost supersedes the executed items: no - the typed cost is zero, so the items keep billing and this subtotal is no fall in debt.'
  // Upper bound, not an equality: getBillableItems skips per LINK, so an item
  // also linked EXECUTED to a visit this rule does not supersede (costless,
  // zero-cost or CANCELLED) keeps billing there, and an item executed on two
  // costed visits is counted in both their rows while it stops billing once.
  // Stating the exact fall would need every other link of every item here,
  // which this row does not carry.
  return "Typed cost supersedes the executed items: yes - they no longer bill on their own here, so the patient's debt falls by at most this subtotal. It is an upper bound: an item also executed on a visit the rule leaves alone keeps billing there, and an item executed on two costed visits is counted in both rows though it stops billing once."
}

export function formatReport(report: CostBudgetOverlapReport): string {
  const lines: string[] = []
  lines.push('Appointments with a typed cost AND executed budget items - overlaps to review')
  lines.push(
    "Since task #590 a typed cost above zero on a non-CANCELLED appointment is the only charge for its visit: on those rows the executed items no longer bill on their own, and the subtotal shown is at most how much the patient's debt falls - at most, because an item executed on several visits only stops billing when every one of those visits supersedes it."
  )
  lines.push(
    'Not every row below is one of those. This report deliberately also lists the rows the rule leaves alone - a typed cost of zero, or a CANCELLED appointment - where the items keep billing and the subtotal is no fall in debt. Each appointment states which case it is.'
  )
  lines.push('')

  if (report.appointmentCount === 0) {
    lines.push('No overlaps found.')
    return lines.join('\n')
  }

  for (const tenant of report.tenants) {
    const count = tenant.patients.reduce((n, p) => n + p.appointments.length, 0)
    lines.push(`Tenant ${tenant.tenantId} - ${count} appointment(s) to review`)
    for (const patient of tenant.patients) {
      lines.push(`  Patient ${patient.patientId}`)
      for (const appt of patient.appointments) {
        lines.push(
          `    Appointment ${appt.appointmentId} on ${appt.startTime.toISOString().slice(0, 10)} (status ${appt.appointmentStatus})`
        )
        lines.push(`      Typed cost on the appointment: ${appt.typedCost}`)
        lines.push('      Executed budget items:')
        for (const item of appt.executedItems) {
          const tooth = item.toothNumber === null ? '' : ` tooth ${item.toothNumber}`
          lines.push(
            `        - item ${item.budgetItemId} "${item.description}"${tooth}: ${item.totalPrice} (item status ${item.itemStatus}, budget ${item.budgetId} status ${item.budgetStatus})`
          )
        }
        lines.push(`      Executed items subtotal: ${appt.executedItemsSubtotal}`)
        lines.push(`      ${supersessionNote(appt)}`)
      }
    }
    lines.push('')
  }

  lines.push(`${report.appointmentCount} appointment(s) to review across ${report.tenants.length} tenant(s).`)
  lines.push('Read-only report: nothing was modified.')
  return lines.join('\n')
}

export function parseArgs(argv: string[]): { tenantId?: string; limit?: number; json: boolean } {
  let tenantId: string | undefined
  let limit: number | undefined
  let json = false
  for (const arg of argv) {
    if (arg === '--json') json = true
    else if (arg.startsWith('--tenant=')) tenantId = arg.slice('--tenant='.length)
    else if (arg.startsWith('--limit=')) {
      limit = Number(arg.slice('--limit='.length))
      if (!Number.isInteger(limit) || limit <= 0) throw new Error(`Invalid --limit: ${arg}`)
    } else throw new Error(`Unknown argument: ${arg}`)
  }
  return { tenantId, limit, json }
}

async function main(argv: string[]) {
  const { json, ...options } = parseArgs(argv)
  const report = await findCostBudgetOverlaps(options)
  console.log(json ? JSON.stringify(report, null, 2) : formatReport(report))
}

// Extension-insensitive so a compiled dist/*.js invocation runs too.
const entrypoint = process.argv[1]
const isCli =
  entrypoint !== undefined &&
  basename(entrypoint, extname(entrypoint)) === 'report-cost-budget-overlap'

if (isCli) {
  main(process.argv.slice(2))
    .catch((error) => {
      console.error('Fatal error:', error)
      process.exitCode = 1
    })
    .finally(async () => {
      await disconnectDatabase()
    })
}
