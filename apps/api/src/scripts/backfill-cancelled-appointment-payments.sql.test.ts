import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { prisma } from '@dental/database'

import { backfillCancelledAppointmentPayments } from './backfill-cancelled-appointment-payments.js'
import {
  CANCELLED_APPOINTMENT_NOTE_SUFFIX,
  SYSTEM_ACTOR_BACKFILL_406,
  recalculatePaidStatus,
} from '../services/payment.service.js'
import { createCancelledFixture, type CancelledFixture } from '../test/cancelled-fixture.js'

/**
 * Task #715: the SQL half of the #406 backfill and the script half agree.
 *
 * The SQL file is the half that actually reaches production (the image ships
 * neither tsx nor src/scripts/, and dental-postgres publishes no ports), and a
 * SQL translation of a predicate is plausible until it reproduces a known
 * positive. This suite runs BOTH halves against the same dental_test state and
 * compares them, rather than asserting each separately: two implementations
 * that are never compared are two sources of truth.
 *
 *   count:  both run unscoped over the whole database (foreign rows included,
 *           which is the stronger comparison) and must list the same rows in
 *           the same order and report the same five totals.
 *   apply:  the two fixture tenants are seeded with the same shape of data, but
 *           NOT at the same time — backfillCancelledAppointmentPayments() takes
 *           no tenant argument, so it would convert both. The script's tenant is
 *           seeded and converted first; the SQL's tenant is seeded afterwards
 *           and converted by psql. By then the script tenant's rows are
 *           kind='ADVANCE' and out of the population, so the SQL cannot touch
 *           them. The two post-states are then compared role by role, ignoring
 *           ids and timestamps.
 *
 * psql is the local binary when there is one (CI), else the one inside the
 * dental-postgres container (a developer machine). If neither exists the suite
 * FAILS: a silent skip would leave the SQL half unguarded. Two
 * dental-postgres/redis pairs can claim port 5432 on a developer host, so the
 * container `docker exec` reaches need not be the one DATABASE_URL points at —
 * the first describe block below proves both halves land in the same database
 * before any agreement is measured, because that mismatch would otherwise
 * present as an agreement failure rather than as a configuration error.
 */

const SQL_FILE = resolve(dirname(fileURLToPath(import.meta.url)), 'backfill-cancelled-appointment-payments.sql')

interface SqlRow {
  tenantId: string
  patientId: string
  appointmentId: string
  paymentId: string
  amount: string
}

interface SqlTotals {
  paymentCount: number
  appointmentCount: number
  patientCount: number
  tenantCount: number
  totalAmount: string
}

interface SqlOutput {
  rows: SqlRow[]
  totals: SqlTotals
  stdout: string
}

function psqlInvocation(): { cmd: string; args: string[] } {
  const url = new URL(process.env.DATABASE_URL!)
  const database = url.pathname.slice(1)
  const user = decodeURIComponent(url.username)
  const common = ['-q', '-A', '-t', '-F', '|', '-v', 'ON_ERROR_STOP=1']
  let hasLocalPsql = true
  try {
    execFileSync('psql', ['--version'], { stdio: 'ignore' })
  } catch {
    hasLocalPsql = false
  }
  if (hasLocalPsql) {
    url.search = ''
    return { cmd: 'psql', args: [url.toString(), ...common] }
  }
  return { cmd: 'docker', args: ['exec', '-i', 'dental-postgres', 'psql', '-U', user, '-d', database, ...common] }
}

function psql(input: string | Buffer, extra: string[] = []): string {
  const { cmd, args } = psqlInvocation()
  try {
    return execFileSync(cmd, [...args, ...extra], { input, encoding: 'utf8', timeout: 60_000 })
  } catch (error) {
    const e = error as { message: string; stderr?: Buffer | string }
    throw new Error(`psql run failed (${cmd}): ${e.message}\n${String(e.stderr ?? '')}`)
  }
}

/**
 * The listing carries 5 fields per line and the totals line 6, the first of
 * which is the literal 'TOTALS' — the label is what makes the two tellable
 * apart at all, since without it both would carry 5.
 */
function runSql(apply: boolean): SqlOutput {
  const stdout = psql(readFileSync(SQL_FILE), apply ? ['-v', 'apply=1'] : [])
  const rows: SqlRow[] = []
  let totals: SqlTotals | undefined
  for (const line of stdout.split('\n')) {
    const f = line.split('|')
    if (f.length === 5) {
      rows.push({ tenantId: f[0], patientId: f[1], appointmentId: f[2], paymentId: f[3], amount: f[4] })
    } else if (f.length === 6 && f[0] === 'TOTALS') {
      totals = {
        paymentCount: Number(f[1]),
        appointmentCount: Number(f[2]),
        patientCount: Number(f[3]),
        tenantCount: Number(f[4]),
        totalAmount: f[5],
      }
    }
  }
  if (!totals) throw new Error(`psql output carried no TOTALS line:\n${stdout}`)
  return { rows, totals, stdout }
}

/** The raw output line (if any) that carries this payment id. */
function rawLineFor(stdout: string, paymentId: string): string | undefined {
  return stdout.split('\n').find((line) => line.includes(paymentId))
}

type Roles = Record<string, string>

interface Seeded {
  appointments: Roles
  payments: Roles
  patients: Roles
  /** Patients whose paid-status cache was settled; the debt patient is left stale. */
  settled: string[]
}

/**
 * The same shape of data in each tenant; returns role -> id.
 *
 * Positives (the #406 population: an active kind='APPOINTMENT' payment whose
 * appointment has isActive=false, ANY status):
 *   earmarkNote + earmarkNullNote — two payments on ONE soft-deleted COMPLETED
 *     appointment, one of them with note=null;
 *   earmarkScheduled — a soft-deleted SCHEDULED appointment, so the suite shows
 *     the predicate really does ignore status;
 *   earmarkOther — a second patient, on a soft-deleted CANCELLED appointment.
 * Negatives, one per axis of the predicate:
 *   onActive — appointment still isActive=true;
 *   alreadyAdvance — kind='ADVANCE' already;
 *   reversed — the payment itself is isActive=false.
 *
 * The positive appointments deliberately carry BOTH isPaid values (true on
 * deletedCompleted, false on deletedScheduled), so a blanket write to the
 * column in either direction is visible to the isPaid guard.
 */
async function seed(fx: CancelledFixture, withOpenDebt = false): Promise<Seeded> {
  const one = await fx.newPatient('holder-one')
  const two = await fx.newPatient('holder-two')
  const appointments: Roles = {}
  const payments: Roles = {}
  const patients: Roles = { one, two }

  appointments.deletedCompleted = await fx.appointment(one, 3, 100, { status: 'COMPLETED', isPaid: true, isActive: false })
  appointments.deletedScheduled = await fx.appointment(one, 4, 50, { status: 'SCHEDULED', isPaid: false, isActive: false })
  appointments.activeNormal = await fx.appointment(one, 5, 80, { status: 'COMPLETED', isPaid: true, isActive: true })
  appointments.deletedCancelled = await fx.appointment(two, 6, 70, { status: 'CANCELLED', isPaid: true, isActive: false })

  payments.earmarkNote = await fx.payment(one, 60, {
    kind: 'APPOINTMENT',
    appointmentId: appointments.deletedCompleted,
    note: 'Pago en consulta',
  })
  // A non-integer amount, so to_char(amount, 'FM999999990.00') and
  // Decimal.toFixed(2) are compared on a value that can actually disagree.
  payments.earmarkNullNote = await fx.payment(one, 40.55, {
    kind: 'APPOINTMENT',
    appointmentId: appointments.deletedCompleted,
    note: null,
  })
  payments.earmarkScheduled = await fx.payment(one, 50, {
    kind: 'APPOINTMENT',
    appointmentId: appointments.deletedScheduled,
    note: 'Cita borrada',
  })
  payments.onActive = await fx.payment(one, 80, {
    kind: 'APPOINTMENT',
    appointmentId: appointments.activeNormal,
    note: 'Consulta normal',
  })
  payments.earmarkOther = await fx.payment(two, 70, {
    kind: 'APPOINTMENT',
    appointmentId: appointments.deletedCancelled,
    note: 'Pago',
  })
  payments.alreadyAdvance = await fx.payment(two, 15, {
    kind: 'ADVANCE',
    appointmentId: appointments.deletedCancelled,
    note: 'Adelanto previo',
  })
  payments.reversed = await fx.payment(two, 30, {
    kind: 'APPOINTMENT',
    appointmentId: appointments.deletedCancelled,
    note: 'Pago anulado',
    isActive: false,
  })

  if (withOpenDebt) {
    // A third patient carrying a STALE cached isPaid: 100 earmarked on a
    // soft-deleted visit (which computeFifoAllocation already treats as
    // ordinary pool money, because the earmark points at an item absent from
    // the billable set) against an 80 COMPLETED visit seeded isPaid=false.
    // FIFO says that row is paid; only a recalculation can say so.
    patients.debt = await fx.newPatient('holder-debt')
    appointments.debtDeleted = await fx.appointment(patients.debt, 7, 100, {
      status: 'COMPLETED',
      isPaid: true,
      isActive: false,
    })
    appointments.debt = await fx.appointment(patients.debt, 8, 80, { status: 'COMPLETED', isPaid: false, isActive: true })
    payments.debtEarmark = await fx.payment(patients.debt, 100, {
      kind: 'APPOINTMENT',
      appointmentId: appointments.debtDeleted,
    })
  }

  // Seeded rows carry whatever isPaid the fixture was told to write, which is
  // not necessarily what FIFO derives. Settle the two base patients once so the
  // pass is measured against a CORRECT pre-state; the debt patient is left
  // stale on purpose and is the subject of the KNOWN LIMITATION block.
  const settled = [one, two]
  for (const patientId of settled) await recalculatePaidStatus(fx.tenantId, patientId)

  return { appointments, payments, patients, settled }
}

/** Post-state by role, with ids and timestamps left out. */
async function postState(seeded: Pick<Seeded, 'appointments' | 'payments'>) {
  const out: Record<string, unknown> = {}
  for (const [role, id] of Object.entries(seeded.appointments)) {
    const a = await prisma.appointment.findUniqueOrThrow({
      where: { id },
      select: { isPaid: true, status: true, isActive: true, cost: true },
    })
    out[`appointment:${role}`] = { ...a, cost: a.cost?.toFixed(2) }
  }
  for (const [role, id] of Object.entries(seeded.payments)) {
    const p = await prisma.patientPayment.findUniqueOrThrow({
      where: { id },
      select: { kind: true, note: true, isActive: true, amount: true },
    })
    const events = await prisma.patientPaymentEvent.findMany({
      where: { paymentId: id },
      select: { type: true, actorUserId: true },
      orderBy: [{ type: 'asc' }, { actorUserId: 'asc' }],
    })
    out[`payment:${role}`] = { ...p, amount: p.amount.toFixed(2), events }
  }
  return out
}

/** Only the appointment isPaid columns, by role. */
async function isPaidByRole(appointments: Roles) {
  const out: Record<string, boolean> = {}
  for (const [role, id] of Object.entries(appointments)) {
    out[role] = (await prisma.appointment.findUniqueOrThrow({ where: { id } })).isPaid
  }
  return out
}

const POSITIVE_ROLES = ['earmarkNote', 'earmarkNullNote', 'earmarkScheduled', 'earmarkOther'] as const
const NEGATIVE_ROLES = ['onActive', 'alreadyAdvance', 'reversed'] as const

function positiveIds(seeded: Seeded): string[] {
  return POSITIVE_ROLES.map((role) => seeded.payments[role])
}

describe('backfill-cancelled-appointment-payments.sql (#715)', () => {
  let fxScript: CancelledFixture
  let fxSql: CancelledFixture

  beforeAll(async () => {
    fxScript = await createCancelledFixture('backfill-sql-twin-script')
    fxSql = await createCancelledFixture('backfill-sql-twin-sql')
  })

  afterAll(async () => {
    await fxScript.destroy()
    await fxSql.destroy()
  })

  beforeEach(async () => {
    await fxScript.wipe()
    await fxSql.wipe()
  })

  describe('psql and Prisma reach the same database', () => {
    // Guard 1. Two dental-postgres containers can publish 5432 on this host, so
    // `docker exec dental-postgres` need not reach the instance DATABASE_URL
    // names. Measured here rather than assumed, because the symptom downstream
    // is an agreement failure that looks like a bug in the SQL.
    it('reports the database DATABASE_URL names and can read a row Prisma has just written', async () => {
      const expectedDatabase = new URL(process.env.DATABASE_URL!).pathname.slice(1)
      expect(psql('SELECT current_database();').trim()).toBe(expectedDatabase)

      // Known positive: the fixture tenant exists only in the database Prisma
      // wrote it to.
      const found = psql(`SELECT count(*) FROM tenants WHERE id = '${fxSql.tenantId}';`).trim()
      expect(found).toBe('1')
      // ... and the same query shape returns 0 for an id nobody wrote, so the
      // '1' above is a real read and not a quirk of the parsing.
      const absent = psql(`SELECT count(*) FROM tenants WHERE id = 'no-such-tenant-715';`).trim()
      expect(absent).toBe('0')
    })
  })

  describe('count', () => {
    // Guard 2.
    it('lists the same rows in the same order and reports the same five totals as the script (database-wide)', async () => {
      await seed(fxScript)
      await seed(fxSql)

      const script = await backfillCancelledAppointmentPayments({ dryRun: true })
      const sql = runSql(false)

      expect(sql.rows).toEqual(script.rows)
      expect(sql.totals).toEqual({
        paymentCount: script.matchedCount,
        appointmentCount: script.appointmentCount,
        patientCount: script.patientCount,
        tenantCount: script.tenantCount,
        totalAmount: script.totalAmount,
      })

      // The equality above would also hold for two lists that are ordered by
      // nothing, so assert the leading ORDER BY keys really group the output.
      // Compared as grouping, never as string order: the collation Postgres
      // sorts cuids under is not JS's, and the agreement is the only place that
      // may depend on the exact sequence.
      const groupsAreContiguous = (keys: string[]) => {
        const seen = new Set<string>()
        let last: string | undefined
        for (const key of keys) {
          if (key === last) continue
          if (seen.has(key)) return false
          seen.add(key)
          last = key
        }
        return true
      }
      expect(groupsAreContiguous(sql.rows.map((r) => r.tenantId))).toBe(true)
      expect(groupsAreContiguous(sql.rows.map((r) => `${r.tenantId}:${r.patientId}`))).toBe(true)
      expect(groupsAreContiguous(sql.rows.map((r) => `${r.tenantId}:${r.appointmentId}`))).toBe(true)
      // Non-vacuous: there are repeated keys to be grouped (two payments share
      // one appointment, two appointments share one patient) in each tenant.
      expect(sql.rows.filter((r) => r.tenantId === fxSql.tenantId)).toHaveLength(4)
      expect(new Set(sql.rows.filter((r) => r.tenantId === fxSql.tenantId).map((r) => r.appointmentId)).size).toBe(3)
    })

    // Guard 3 — the agreement above cannot be over two empty sets.
    it('finds the seeded positives: 4 payments on 3 appointments across 2 patients per tenant', async () => {
      const seeded = await seed(fxSql)
      const sql = runSql(false)
      const mine = sql.rows.filter((r) => r.tenantId === fxSql.tenantId)

      expect(mine).toHaveLength(4)
      expect(mine.map((r) => r.paymentId).sort()).toEqual(positiveIds(seeded).sort())
      // Counted separately from the content assertion above.
      expect(new Set(mine.map((r) => r.appointmentId)).size).toBe(3)
      expect(new Set(mine.map((r) => r.patientId)).size).toBe(2)
      expect(mine.map((r) => r.amount).sort()).toEqual(['40.55', '50.00', '60.00', '70.00'])
    })

    // Guard 4 — the five totals, as deltas over a baseline measured with the
    // fixtures absent, so foreign rows in dental_test cannot make them flaky.
    // The four deltas are deliberately four DIFFERENT numbers (4/3/2/1), so a
    // totals line that emitted the columns in another order fails here.
    it('reports paymentCount, appointmentCount, patientCount, tenantCount and totalAmount', async () => {
      const before = runSql(false).totals
      await seed(fxSql)
      const after = runSql(false).totals

      expect(after.paymentCount - before.paymentCount).toBe(4)
      expect(after.appointmentCount - before.appointmentCount).toBe(3)
      expect(after.patientCount - before.patientCount).toBe(2)
      expect(after.tenantCount - before.tenantCount).toBe(1)
      expect((Number(after.totalAmount) - Number(before.totalAmount)).toFixed(2)).toBe('220.55')
    })

    // Guard 5.
    it('modifies nothing', async () => {
      const seeded = await seed(fxSql)
      const before = await postState(seeded)
      runSql(false)
      expect(await postState(seeded)).toEqual(before)
    })

    // Guard 6.
    it('selects ids and an amount only — no patient name reaches stdout', async () => {
      const seeded = await seed(fxSql)
      const sql = runSql(false)
      const patients = await prisma.patient.findMany({
        where: { tenantId: fxSql.tenantId },
        select: { firstName: true, lastName: true },
      })

      // The grep is live: the patient's ID is in the output, which is what
      // makes the absence of the NAME below evidence rather than an empty
      // result that would also hold for an output nobody produced.
      expect(sql.stdout).toContain(seeded.patients.one)
      expect(patients).toHaveLength(2)
      for (const p of patients) {
        expect(sql.stdout).not.toContain(p.firstName)
        expect(sql.stdout).not.toContain(p.lastName)
      }

      // And the row really is five fields, in the documented order — asserted
      // on the raw line, not on the parser's own output.
      const line = rawLineFor(sql.stdout, seeded.payments.earmarkNullNote)
      expect(line?.split('|')).toEqual([
        fxSql.tenantId,
        seeded.patients.one,
        seeded.appointments.deletedCompleted,
        seeded.payments.earmarkNullNote,
        '40.55',
      ])
    })
  })

  describe('the three negatives, each against its own variant', () => {
    // Guards 7-9. Each case asserts the id is absent from the SQL's own stdout
    // and then perturbs ONLY that axis and watches the same id appear — so the
    // exclusion is attributed to the axis under test and not to the row being
    // invisible for some unrelated reason.
    it('excludes a payment whose appointment is still isActive=true (guard 7)', async () => {
      const seeded = await seed(fxSql)
      expect(runSql(false).stdout).not.toContain(seeded.payments.onActive)

      await prisma.appointment.update({
        where: { id: seeded.appointments.activeNormal },
        data: { isActive: false },
      })
      expect(runSql(false).stdout).toContain(seeded.payments.onActive)
    })

    it("excludes a payment that is already kind='ADVANCE' (guard 8)", async () => {
      const seeded = await seed(fxSql)
      expect(runSql(false).stdout).not.toContain(seeded.payments.alreadyAdvance)

      await prisma.patientPayment.update({
        where: { id: seeded.payments.alreadyAdvance },
        data: { kind: 'APPOINTMENT' },
      })
      expect(runSql(false).stdout).toContain(seeded.payments.alreadyAdvance)
    })

    it('excludes a payment with isActive=false (guard 9)', async () => {
      const seeded = await seed(fxSql)
      expect(runSql(false).stdout).not.toContain(seeded.payments.reversed)

      await prisma.patientPayment.update({
        where: { id: seeded.payments.reversed },
        data: { isActive: true },
      })
      expect(runSql(false).stdout).toContain(seeded.payments.reversed)
    })
  })

  describe('apply', () => {
    // Guard 10. The script takes no tenant argument, so the two halves are run
    // in sequence (see the header): script tenant seeded and converted first,
    // SQL tenant seeded after, by which time the script tenant's rows are
    // kind='ADVANCE' and out of the population.
    it('leaves the same post-state, role by role, as the script does from the same seed', async () => {
      const a = await seed(fxScript)
      await backfillCancelledAppointmentPayments({ dryRun: false })
      const scriptState = await postState(a)

      const b = await seed(fxSql)
      runSql(true)
      const sqlState = await postState(b)

      expect(sqlState).toEqual(scriptState)

      // Not vacuous: the conversion really happened on both sides, and it
      // mirrors convertAppointmentPaymentsToAdvance.
      for (const state of [scriptState, sqlState]) {
        expect(state['payment:earmarkNote']).toMatchObject({
          kind: 'ADVANCE',
          note: `Pago en consulta${CANCELLED_APPOINTMENT_NOTE_SUFFIX}`,
          events: [{ type: 'CONVERTED_TO_ADVANCE', actorUserId: SYSTEM_ACTOR_BACKFILL_406 }],
        })
        // A null note becomes the bare suffix, not the string 'null'.
        expect(state['payment:earmarkNullNote']).toMatchObject({
          kind: 'ADVANCE',
          note: CANCELLED_APPOINTMENT_NOTE_SUFFIX,
        })
        // And the negatives are still negatives on both sides.
        expect(state['payment:onActive']).toMatchObject({ kind: 'APPOINTMENT', note: 'Consulta normal', events: [] })
        expect(state['payment:alreadyAdvance']).toMatchObject({ kind: 'ADVANCE', note: 'Adelanto previo', events: [] })
        expect(state['payment:reversed']).toMatchObject({ kind: 'APPOINTMENT', note: 'Pago anulado', events: [] })
      }

      // postState drops ids, so appointmentId — which the restore path matches
      // on, and which neither half may clear — is asserted here per side.
      for (const seeded of [a, b]) {
        const converted = await prisma.patientPayment.findUniqueOrThrow({
          where: { id: seeded.payments.earmarkNote },
          select: { appointmentId: true },
        })
        expect(converted.appointmentId).toBe(seeded.appointments.deletedCompleted)
      }
    })

    // Guard 11. Counted separately from the content assertion in guard 10.
    it('writes exactly one CONVERTED_TO_ADVANCE event per converted payment', async () => {
      const b = await seed(fxSql)
      runSql(true)

      const events = await prisma.patientPaymentEvent.findMany({
        where: { tenantId: fxSql.tenantId },
        select: { paymentId: true, type: true },
      })
      expect(events).toHaveLength(4)
      expect(events.every((e) => e.type === 'CONVERTED_TO_ADVANCE')).toBe(true)
      expect(events.map((e) => e.paymentId).sort()).toEqual(positiveIds(b).sort())
    })

    // Guard 12.
    it('converts exactly the payments its own count listed, and exactly those carry the event', async () => {
      const b = await seed(fxSql)
      const counted = runSql(false)
        .rows.filter((r) => r.tenantId === fxSql.tenantId)
        .map((r) => r.paymentId)
        .sort()
      const applied = runSql(true)
        .rows.filter((r) => r.tenantId === fxSql.tenantId)
        .map((r) => r.paymentId)
        .sort()

      expect(applied).toEqual(counted)
      expect(counted).toEqual(positiveIds(b).sort())

      const converted = await prisma.patientPaymentEvent.findMany({
        where: { tenantId: fxSql.tenantId, type: 'CONVERTED_TO_ADVANCE' },
        select: { paymentId: true },
      })
      expect(converted.map((e) => e.paymentId).sort()).toEqual(counted)
      for (const role of NEGATIVE_ROLES) expect(counted).not.toContain(b.payments[role])
    })

    // Guard 13.
    it('is idempotent: a second apply lists nothing for the tenant and changes no row', async () => {
      const b = await seed(fxSql)
      runSql(true)
      const afterFirst = await postState(b)

      const second = runSql(true)
      expect(second.rows.filter((r) => r.tenantId === fxSql.tenantId)).toEqual([])
      expect(await postState(b)).toEqual(afterFirst)
      // Not vacuous: there WAS something to convert, and no second suffix was
      // appended to it.
      expect(afterFirst['payment:earmarkNote']).toMatchObject({
        note: `Pago en consulta${CANCELLED_APPOINTMENT_NOTE_SUFFIX}`,
      })
    })

    // Guard 14. Parity with the script, which never touches the column either:
    // the shared helper does not write it, and every appointment-level isPaid
    // reader in apps/api filters isActive=true. The seed carries isPaid=true on
    // one converted appointment and isPaid=false on another, so a blanket write
    // in EITHER direction shows up here.
    it('does not write appointments.isPaid', async () => {
      const b = await seed(fxSql)
      const before = await isPaidByRole(b.appointments)
      runSql(true)
      const after = await isPaidByRole(b.appointments)

      expect(after).toEqual(before)
      expect(before).toEqual({
        deletedCompleted: true,
        deletedScheduled: false,
        activeNormal: true,
        deletedCancelled: true,
      })
    })

    // Guard 15. The column the SQL must NOT touch is only meaningful if its
    // rows really were converted in the same run.
    it('converts the payments while leaving isPaid alone in the same run', async () => {
      const b = await seed(fxSql)
      runSql(true)

      const converted = await prisma.patientPayment.findMany({
        where: { tenantId: fxSql.tenantId, kind: 'ADVANCE', id: { in: positiveIds(b) } },
        select: { id: true },
      })
      expect(converted).toHaveLength(4)
      expect(
        (await prisma.appointment.findUniqueOrThrow({ where: { id: b.appointments.deletedCompleted } })).isPaid
      ).toBe(true)
    })
  })

  describe('KNOWN LIMITATION: the SQL half does not re-derive the paid-status cache', () => {
    // Guard 16. The script re-runs recalculatePaidStatus per affected patient;
    // the SQL cannot (FIFO lives in application code). On a patient whose cached
    // isPaid is already stale, the script heals the column as a side effect of
    // the pass and the SQL leaves it stale until the patient's next
    // recalculation. The money is not affected either way: an earmark pointing
    // at an appointment absent from the billable set is already ordinary pool
    // money to computeFifoAllocation, which is why the #406 pass is expected to
    // report zero paid-status changes on correctly cached data.
    //
    // If the SQL half is ever made to re-derive, THIS TEST MUST GO RED and be
    // rewritten as an agreement rather than deleted or relaxed.
    it('the script heals a stale cached isPaid and the SQL leaves it false', async () => {
      const a = await seed(fxScript, true)
      await backfillCancelledAppointmentPayments({ dryRun: false })

      const b = await seed(fxSql, true)
      runSql(true)

      const isPaid = async (id: string) => (await prisma.appointment.findUniqueOrThrow({ where: { id } })).isPaid
      expect(await isPaid(a.appointments.debt)).toBe(true)
      expect(await isPaid(b.appointments.debt)).toBe(false)

      // Both sides converted the money all the same — the divergence is the
      // cache, not the ledger.
      const kindOf = async (id: string) =>
        (await prisma.patientPayment.findUniqueOrThrow({ where: { id } })).kind
      expect(await kindOf(a.payments.debtEarmark)).toBe('ADVANCE')
      expect(await kindOf(b.payments.debtEarmark)).toBe('ADVANCE')

      // The stale column is exactly what a recalculation heals.
      const healed = await recalculatePaidStatus(fxSql.tenantId, b.patients.debt)
      expect(healed.appointmentChanges).toBe(1)
      expect(await isPaid(b.appointments.debt)).toBe(true)
    })
  })
})
