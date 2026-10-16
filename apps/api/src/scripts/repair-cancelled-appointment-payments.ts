#!/usr/bin/env tsx
/**
 * Repair for task #597: appointments cancelled through the ordinary edit
 * (isActive = true, status = CANCELLED) BEFORE #596 landed.
 *
 * Those rows are outside the billable set, so recalculatePaidStatus never
 * reaches them: they keep a frozen isPaid = true (rendered "Cubierto por
 * saldo"), and the kind = APPOINTMENT payment earmarked to them was never
 * converted into an advance.
 *
 * Population (the query to quote):
 *   patientPayment where { isActive: true, kind: 'APPOINTMENT',
 *     appointment: { isActive: true, status: 'CANCELLED' } }
 * A cancelled appointment with no earmarked payment is NOT in the population
 * and is left untouched.
 *
 * Repair, one transaction per patient: convert each such payment to an ADVANCE
 * (the shared helper, with its CONVERTED_TO_ADVANCE event and a system actor),
 * clear isPaid on its appointment; then re-derive the patient's allocation with
 * recalculatePaidStatus. Idempotent: a converted row is kind = ADVANCE and no
 * longer matches, so a second run changes zero rows.
 *
 * COUNTS BY DEFAULT. It writes only behind an explicit --apply. Patient names
 * are never selected; rows are identified by patient id.
 *
 * This is the half the tests exercise. The production image ships neither tsx
 * nor src/scripts/ and dental-postgres publishes no ports, so what reaches
 * production is the reviewed SQL twin, repair-cancelled-appointment-payments.sql,
 * run with psql inside the dental-postgres container. Neither half takes a
 * connection URL: this one uses whatever DATABASE_URL the process already has.
 *
 * Usage:
 *   pnpm --filter @dental/api exec tsx --env-file=../../.env \
 *     src/scripts/repair-cancelled-appointment-payments.ts [--apply] [--tenant=<id>] [--json]
 */

import { basename, extname } from 'node:path'

import { prisma, disconnectDatabase } from '@dental/database'
import {
  SYSTEM_ACTOR_REPAIR_597,
  convertAppointmentPaymentsToAdvance,
  recalculatePaidStatus,
} from '../services/payment.service.js'

export interface RepairRow {
  tenantId: string
  patientId: string
  appointmentId: string
  paymentId: string
  amount: string
  appointmentIsPaid: boolean
}

export interface RepairResult {
  applied: boolean
  /** Payments matching the population; converted when `applied`. */
  paymentCount: number
  /** Distinct appointments in the population. */
  appointmentCount: number
  /** Of those, how many held the frozen isPaid = true that gets cleared. */
  frozenIsPaidCount: number
  patientCount: number
  /** isPaid columns flipped by the post-repair recalculation (0 when not applied). */
  paidStatusChanges: number
  rows: RepairRow[]
}

export async function repairCancelledAppointmentPayments(
  options: { apply: boolean; tenantId?: string } = { apply: false }
): Promise<RepairResult> {
  const { apply, tenantId } = options

  const payments = await prisma.patientPayment.findMany({
    where: {
      isActive: true,
      kind: 'APPOINTMENT',
      appointment: { isActive: true, status: 'CANCELLED' },
      ...(tenantId ? { tenantId } : {}),
    },
    select: {
      id: true,
      tenantId: true,
      patientId: true,
      appointmentId: true,
      amount: true,
      appointment: { select: { isPaid: true } },
    },
    orderBy: [{ tenantId: 'asc' }, { patientId: 'asc' }, { appointmentId: 'asc' }, { id: 'asc' }],
  })

  const rows: RepairRow[] = payments.map((p) => ({
    tenantId: p.tenantId,
    patientId: p.patientId,
    appointmentId: p.appointmentId!,
    paymentId: p.id,
    amount: p.amount.toFixed(2),
    appointmentIsPaid: p.appointment!.isPaid,
  }))

  const byPatient = new Map<string, { tenantId: string; patientId: string; appointmentIds: Set<string> }>()
  const appointments = new Map<string, boolean>()
  for (const row of rows) {
    const key = `${row.tenantId}:${row.patientId}`
    const entry = byPatient.get(key) ?? {
      tenantId: row.tenantId,
      patientId: row.patientId,
      appointmentIds: new Set<string>(),
    }
    entry.appointmentIds.add(row.appointmentId)
    byPatient.set(key, entry)
    appointments.set(row.appointmentId, row.appointmentIsPaid)
  }

  let paidStatusChanges = 0
  if (apply) {
    for (const { tenantId: t, patientId, appointmentIds } of byPatient.values()) {
      await prisma.$transaction(async (tx) => {
        for (const appointmentId of appointmentIds) {
          await convertAppointmentPaymentsToAdvance(tx, t, appointmentId, SYSTEM_ACTOR_REPAIR_597)
          await tx.appointment.update({ where: { id: appointmentId }, data: { isPaid: false } })
        }
      })
      const result = await recalculatePaidStatus(t, patientId)
      paidStatusChanges += result.appointmentChanges + result.labworkChanges + result.budgetItemChanges
    }
  }

  return {
    applied: apply,
    paymentCount: rows.length,
    appointmentCount: appointments.size,
    frozenIsPaidCount: [...appointments.values()].filter(Boolean).length,
    patientCount: byPatient.size,
    paidStatusChanges,
    rows,
  }
}

export function formatResult(result: RepairResult): string {
  const lines: string[] = []
  lines.push(`Repair of edit-cancelled appointments - ${result.applied ? 'APPLY' : 'COUNT ONLY'}`)
  lines.push('')
  for (const row of result.rows) {
    lines.push(
      `  tenant ${row.tenantId} patient ${row.patientId} appointment ${row.appointmentId} payment ${row.paymentId} amount ${row.amount} isPaid ${row.appointmentIsPaid}`
    )
  }
  if (result.rows.length > 0) lines.push('')
  const verb = result.applied ? 'Converted' : 'Would convert'
  lines.push(`${verb} ${result.paymentCount} payment(s) across ${result.patientCount} patient(s).`)
  lines.push(
    `${result.applied ? 'Cleared' : 'Would clear'} isPaid on ${result.frozenIsPaidCount} of ${result.appointmentCount} appointment(s) (the rest already read false).`
  )
  if (result.applied) {
    lines.push(`Paid-status columns changed by the recalculation: ${result.paidStatusChanges}`)
    lines.push('Applied.')
  } else {
    lines.push('Nothing was modified. Re-run with --apply to repair.')
  }
  return lines.join('\n')
}

export function parseArgs(argv: string[]): { apply: boolean; tenantId?: string; json: boolean } {
  let apply = false
  let json = false
  let tenantId: string | undefined
  for (const arg of argv) {
    if (arg === '--apply') apply = true
    else if (arg === '--json') json = true
    else if (arg.startsWith('--tenant=')) tenantId = arg.slice('--tenant='.length)
    else throw new Error(`Unknown argument: ${arg}`)
  }
  return { apply, tenantId, json }
}

async function main(argv: string[]) {
  const { json, ...options } = parseArgs(argv)
  const result = await repairCancelledAppointmentPayments(options)
  console.log(json ? JSON.stringify(result, null, 2) : formatResult(result))
}

// Extension-insensitive so a compiled dist/*.js invocation runs too.
const entrypoint = process.argv[1]
const isCli =
  entrypoint !== undefined &&
  basename(entrypoint, extname(entrypoint)) === 'repair-cancelled-appointment-payments'

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
