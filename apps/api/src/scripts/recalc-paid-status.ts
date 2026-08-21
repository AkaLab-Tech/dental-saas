#!/usr/bin/env tsx
/**
 * Backfill script for task #390 (earmark consultation payments before FIFO).
 *
 * `Appointment.isPaid` / `Labwork.isPaid` are persisted caches recomputed by
 * recalculatePaidStatus() on every payment write. Rows created before this
 * change may now disagree with the earmark-aware FIFO allocation, and
 * stats.service.ts / pdf.service.ts / export.service.ts read the raw
 * column, not a live recompute — so stale rows would show in dashboards and
 * PDFs until touched by a new payment write.
 *
 * Reuses recalculatePaidStatus() itself (not a SQL-only migration) so the
 * earmark+FIFO logic never has to be re-implemented here and drift from the
 * real read paths.
 *
 * Usage:
 *   pnpm --filter @dental/api recalc:paid:dry   # Preview only, no writes
 *   pnpm --filter @dental/api recalc:paid       # Apply
 */

import { prisma, disconnectDatabase } from '@dental/database'
import { recalculatePaidStatus } from '../services/payment.service.js'

async function recalcPaidStatus(dryRun: boolean) {
  console.log(`\n${'='.repeat(60)}`)
  console.log(`Recalc Paid Status - ${dryRun ? 'DRY RUN MODE' : 'LIVE MODE'}`)
  console.log(`${'='.repeat(60)}\n`)

  const patients = await prisma.patientPayment.groupBy({
    by: ['tenantId', 'patientId'],
    where: { isActive: true },
  })

  console.log(`Found ${patients.length} (tenant, patient) pairs with active payments\n`)

  if (patients.length === 0) {
    console.log('No patients to process\n')
    return
  }

  let processedCount = 0
  let changedCount = 0
  let errorCount = 0
  const tenantTotals = new Map<string, { appointmentChanges: number; labworkChanges: number }>()

  for (const { tenantId, patientId } of patients) {
    try {
      const result = await recalculatePaidStatus(tenantId, patientId, { dryRun })
      processedCount++

      if (result.appointmentChanges > 0 || result.labworkChanges > 0) {
        changedCount++
        const totals = tenantTotals.get(tenantId) || { appointmentChanges: 0, labworkChanges: 0 }
        totals.appointmentChanges += result.appointmentChanges
        totals.labworkChanges += result.labworkChanges
        tenantTotals.set(tenantId, totals)

        const verb = dryRun ? 'Would flip' : 'Flipped'
        console.log(
          `${verb} ${result.appointmentChanges} appointment(s) + ${result.labworkChanges} labwork(s) ` +
            `for tenant ${tenantId} / patient ${patientId}`
        )
      }

      if (processedCount % 200 === 0) {
        console.log(`... processed ${processedCount}/${patients.length}`)
      }
    } catch (error) {
      errorCount++
      console.error(`Error processing tenant ${tenantId} / patient ${patientId}:`, error)
    }
  }

  console.log(`\n${'='.repeat(60)}`)
  console.log('Summary:')
  console.log(`${'='.repeat(60)}`)
  console.log(`Pairs processed: ${processedCount}`)
  console.log(`Pairs with changes: ${changedCount}`)
  console.log(`Errors: ${errorCount}`)
  console.log('\nPer-tenant changed-row totals:')
  for (const [tenantId, totals] of tenantTotals) {
    console.log(
      `  ${tenantId}: ${totals.appointmentChanges} appointment(s), ${totals.labworkChanges} labwork(s)`
    )
  }
  console.log(`${'='.repeat(60)}\n`)

  if (dryRun && changedCount > 0) {
    console.log('This was a DRY RUN. No data was modified.')
    console.log('To apply, run: pnpm --filter @dental/api recalc:paid\n')
  } else if (!dryRun && changedCount > 0) {
    console.log('Recalculation completed successfully!\n')
  }

  if (errorCount > 0) {
    process.exitCode = 1
  }
}

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')

recalcPaidStatus(dryRun)
  .catch((error) => {
    console.error('Fatal error:', error)
    process.exitCode = 1
  })
  .finally(async () => {
    await disconnectDatabase()
  })
