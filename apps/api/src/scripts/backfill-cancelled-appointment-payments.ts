#!/usr/bin/env tsx
/**
 * Backfill script for task #406 (consultation payments on appointments
 * cancelled before #391 landed).
 *
 * #391 made deleteAppointment() convert the appointment's consultation
 * payment into an ADVANCE so the money stays visible in Entregas once the
 * appointment leaves the billable set. Appointments cancelled *before* that
 * change still hold a kind='APPOINTMENT' payment pointing at an inactive
 * appointment: getBillableItems() no longer returns the appointment, so the
 * money is invisible in the patient's payment breakdown even though it still
 * counts towards getTotalPaid(). This pass repairs that visibility.
 *
 * Match predicate is `appointment.isActive = false` alone — deliberately NOT
 * `status = 'CANCELLED'`. getBillableItems() has no status filter, so an
 * appointment leaves the billable set iff isActive goes false. Appointments
 * merely marked CANCELLED via PUT /api/appointments/:id keep isActive=true,
 * stay billable, and are consistent as-is; converting them would be
 * irreversible since the restore path only runs for isActive=false rows.
 *
 * Idempotence is structural: a converted row is kind='ADVANCE' and no longer
 * matches the kind='APPOINTMENT' selector, so a second run converts zero rows
 * and cannot append a second suffix.
 *
 * The recalculatePaidStatus() pass is expected to flip nothing —
 * computeFifoAllocation() only reads earmarks for items still in the billable
 * set, and getTotalPaid() has no kind filter, so neither allocation input
 * changes. It runs anyway as cheap insurance and to match the #390 precedent.
 *
 * Usage (dry run is the DEFAULT — a bare invocation never writes):
 *   pnpm --filter @dental/api backfill:cancelled-payments        # Preview
 *   pnpm --filter @dental/api backfill:cancelled-payments:apply  # Apply
 *
 * Run the bare script against production first, read the per-tenant counts,
 * then re-run with the `:apply` variant.
 */

import { basename, extname } from 'node:path'

import { prisma, disconnectDatabase } from '@dental/database'
import {
  CANCELLED_APPOINTMENT_NOTE_SUFFIX,
  recalculatePaidStatus,
} from '../services/payment.service.js'

export interface BackfillCancelledAppointmentPaymentsResult {
  /** Payments matching the predicate (converted when dryRun is false). */
  matchedCount: number
  /** Payments converted per tenant, keyed by tenantId. */
  perTenantCounts: Map<string, number>
  /** Distinct (tenantId, patientId) pairs whose paid-status cache was recomputed. */
  patientsRecalculated: number
  /** Appointment/labwork isPaid columns flipped by the recalc pass — expected 0. */
  paidStatusChanges: number
}

/**
 * Convert every active kind='APPOINTMENT' payment whose appointment is
 * inactive into a kind='ADVANCE' payment, shaped exactly like the rows #391
 * produces (appointmentId preserved, note suffix appended) so
 * restoreAppointmentPaymentsFromAdvance() can round-trip them.
 */
export async function backfillCancelledAppointmentPayments(options: {
  dryRun: boolean
}): Promise<BackfillCancelledAppointmentPaymentsResult> {
  const { dryRun } = options

  const payments = await prisma.patientPayment.findMany({
    where: {
      isActive: true,
      kind: 'APPOINTMENT',
      appointment: { isActive: false },
    },
    select: { id: true, note: true, tenantId: true, patientId: true },
  })

  const perTenantCounts = new Map<string, number>()
  const affectedPatients = new Map<string, { tenantId: string; patientId: string }>()

  for (const payment of payments) {
    perTenantCounts.set(payment.tenantId, (perTenantCounts.get(payment.tenantId) ?? 0) + 1)
    affectedPatients.set(`${payment.tenantId}:${payment.patientId}`, {
      tenantId: payment.tenantId,
      patientId: payment.patientId,
    })

    if (!dryRun) {
      await prisma.patientPayment.update({
        where: { id: payment.id },
        data: {
          kind: 'ADVANCE',
          note: `${payment.note ?? ''}${CANCELLED_APPOINTMENT_NOTE_SUFFIX}`,
        },
      })
    }
  }

  let paidStatusChanges = 0
  for (const { tenantId, patientId } of affectedPatients.values()) {
    const result = await recalculatePaidStatus(tenantId, patientId, { dryRun })
    paidStatusChanges += result.appointmentChanges + result.labworkChanges
  }

  return {
    matchedCount: payments.length,
    perTenantCounts,
    patientsRecalculated: affectedPatients.size,
    paidStatusChanges,
  }
}

async function main(dryRun: boolean) {
  console.log(`\n${'='.repeat(60)}`)
  console.log(`Backfill Cancelled Appointment Payments - ${dryRun ? 'DRY RUN MODE' : 'LIVE MODE'}`)
  console.log(`${'='.repeat(60)}\n`)

  const result = await backfillCancelledAppointmentPayments({ dryRun })

  const verb = dryRun ? 'Would convert' : 'Converted'
  console.log(`${verb} ${result.matchedCount} payment(s) across ${result.perTenantCounts.size} tenant(s)\n`)

  if (result.matchedCount === 0) {
    console.log('Nothing to do — no active APPOINTMENT payment points at an inactive appointment\n')
    return
  }

  console.log('Per-tenant payment totals:')
  for (const [tenantId, count] of result.perTenantCounts) {
    console.log(`  ${tenantId}: ${count} payment(s)`)
  }

  console.log(`\nPatients recalculated: ${result.patientsRecalculated}`)
  console.log(`Paid-status columns changed: ${result.paidStatusChanges} (expected 0)`)
  console.log(`${'='.repeat(60)}\n`)

  if (dryRun) {
    console.log('This was a DRY RUN. No data was modified.')
    console.log('To apply, run: pnpm --filter @dental/api backfill:cancelled-payments:apply\n')
  } else {
    console.log('Backfill completed successfully!\n')
  }
}

// Extension-insensitive so a compiled dist/*.js invocation runs too: an
// extension-specific match would make the script a silent no-op that exits 0,
// indistinguishable from a legitimate "0 rows to convert" run.
const entrypoint = process.argv[1]
const isCli =
  entrypoint !== undefined &&
  basename(entrypoint, extname(entrypoint)) === 'backfill-cancelled-appointment-payments'

if (isCli) {
  const dryRun = !process.argv.slice(2).includes('--apply')

  main(dryRun)
    .catch((error) => {
      console.error('Fatal error:', error)
      process.exitCode = 1
    })
    .finally(async () => {
      await disconnectDatabase()
    })
}
