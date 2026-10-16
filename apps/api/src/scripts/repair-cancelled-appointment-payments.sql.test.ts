import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { prisma } from '@dental/database'

import { repairCancelledAppointmentPayments } from './repair-cancelled-appointment-payments.js'
import { recalculatePaidStatus } from '../services/payment.service.js'
import { createCancelledFixture, type CancelledFixture } from '../test/cancelled-fixture.js'

/**
 * Task #597, guard 9: the SQL half and the script half agree.
 *
 * The SQL file is what actually reaches production (the image ships neither tsx
 * nor src/scripts/), and a SQL translation of a predicate is plausible until it
 * reproduces a known positive. This suite runs BOTH halves against the same
 * dental_test state and compares them, rather than asserting each separately:
 * two implementations that are never compared are two sources of truth.
 *
 *   count:  both run unscoped over the whole database (foreign rows included,
 *           which is the stronger comparison) and must list the same rows in
 *           the same order and report the same four totals.
 *   apply:  two tenants are seeded identically; the script repairs one (scoped
 *           by tenantId), the SQL repairs the other (the SQL takes no tenant
 *           argument by design, so it also repairs any foreign row in
 *           dental_test, which is a test database). The two post-states are
 *           then compared role by role, ignoring ids and timestamps.
 *
 * psql is the local binary when there is one (CI), else the one inside the
 * dental-postgres container (a developer machine). If neither exists the suite
 * FAILS: a silent skip would leave the SQL half unguarded.
 */

const SQL_FILE = resolve(dirname(fileURLToPath(import.meta.url)), 'repair-cancelled-appointment-payments.sql')

interface SqlOutput {
  rows: { tenantId: string; patientId: string; appointmentId: string; paymentId: string; amount: string; appointmentIsPaid: boolean }[]
  totals: { paymentCount: number; appointmentCount: number; frozenIsPaidCount: number; patientCount: number }
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

function runSql(apply: boolean): SqlOutput {
  const { cmd, args } = psqlInvocation()
  const full = apply ? [...args, '-v', 'apply=1'] : args
  let stdout: string
  try {
    stdout = execFileSync(cmd, full, { input: readFileSync(SQL_FILE), encoding: 'utf8', timeout: 60_000 })
  } catch (error) {
    const e = error as { message: string; stderr?: Buffer | string }
    throw new Error(`psql run failed (${cmd}): ${e.message}\n${String(e.stderr ?? '')}`)
  }
  const rows: SqlOutput['rows'] = []
  let totals: SqlOutput['totals'] | undefined
  for (const line of stdout.split('\n')) {
    const f = line.split('|')
    if (f.length === 6) {
      rows.push({
        tenantId: f[0],
        patientId: f[1],
        appointmentId: f[2],
        paymentId: f[3],
        amount: f[4],
        appointmentIsPaid: f[5] === 't',
      })
    } else if (f.length === 4) {
      totals = {
        paymentCount: Number(f[0]),
        appointmentCount: Number(f[1]),
        frozenIsPaidCount: Number(f[2]),
        patientCount: Number(f[3]),
      }
    }
  }
  if (!totals) throw new Error(`psql output carried no totals line:\n${stdout}`)
  return { rows, totals, stdout }
}

type Roles = Record<string, string>

/** The same shape of data in each tenant; returns role -> id. */
async function seed(fx: CancelledFixture, withOpenDebt = false): Promise<{ appointments: Roles; payments: Roles; debtPatient?: string }> {
  const p1 = await fx.newPatient('holder-one')
  const p2 = await fx.newPatient('holder-two')
  const appointments: Roles = {}
  const payments: Roles = {}
  appointments.frozen = await fx.appointment(p1, 3, 100, { status: 'CANCELLED', isPaid: true })
  appointments.completed = await fx.appointment(p1, 4, 200, { status: 'COMPLETED', isPaid: true })
  appointments.cancelledNoPayment = await fx.appointment(p1, 5, 50, { status: 'CANCELLED', isPaid: false })
  appointments.softDeleted = await fx.appointment(p1, 6, 70, { status: 'CANCELLED', isPaid: true, isActive: false })
  appointments.otherPatient = await fx.appointment(p2, 7, 80, { status: 'CANCELLED', isPaid: true })
  payments.frozenA = await fx.payment(p1, 60, { kind: 'APPOINTMENT', appointmentId: appointments.frozen, note: 'Pago en consulta' })
  payments.frozenB = await fx.payment(p1, 40, { kind: 'APPOINTMENT', appointmentId: appointments.frozen, note: null })
  payments.reversed = await fx.payment(p1, 30, { kind: 'APPOINTMENT', appointmentId: appointments.frozen, isActive: false })
  payments.completed = await fx.payment(p1, 200, { kind: 'APPOINTMENT', appointmentId: appointments.completed, note: 'Consulta normal' })
  payments.softDeleted = await fx.payment(p1, 70, { kind: 'APPOINTMENT', appointmentId: appointments.softDeleted, note: 'Cita borrada' })
  payments.otherPatient = await fx.payment(p2, 80, { kind: 'APPOINTMENT', appointmentId: appointments.otherPatient, note: 'Pago' })
  payments.alreadyAdvance = await fx.payment(p2, 15, { kind: 'ADVANCE', appointmentId: appointments.otherPatient, note: 'Adelanto' })

  let debtPatient: string | undefined
  if (withOpenDebt) {
    // A third patient: 100 earmarked on a cancelled visit, 80 owed on a
    // COMPLETED one. Once the 100 is converted it is credit that FIFO applies
    // to the 80.
    debtPatient = await fx.newPatient('holder-debt')
    appointments.debtCancelled = await fx.appointment(debtPatient, 8, 100, { status: 'CANCELLED', isPaid: true })
    appointments.debt = await fx.appointment(debtPatient, 9, 80, { status: 'COMPLETED', isPaid: false })
    payments.debtEarmark = await fx.payment(debtPatient, 100, { kind: 'APPOINTMENT', appointmentId: appointments.debtCancelled })
  }
  return { appointments, payments, debtPatient }
}

/** Post-state by role, with ids and timestamps left out. */
async function postState(seeded: { appointments: Roles; payments: Roles }) {
  const out: Record<string, unknown> = {}
  for (const [role, id] of Object.entries(seeded.appointments)) {
    const a = await prisma.appointment.findUniqueOrThrow({ where: { id }, select: { isPaid: true, status: true, isActive: true, cost: true } })
    out[`appointment:${role}`] = { ...a, cost: a.cost?.toFixed(2) }
  }
  for (const [role, id] of Object.entries(seeded.payments)) {
    const p = await prisma.patientPayment.findUniqueOrThrow({ where: { id }, select: { kind: true, note: true, isActive: true, amount: true } })
    const events = await prisma.patientPaymentEvent.findMany({
      where: { paymentId: id },
      select: { type: true, actorUserId: true },
      orderBy: [{ type: 'asc' }, { actorUserId: 'asc' }],
    })
    out[`payment:${role}`] = { ...p, amount: p.amount.toFixed(2), events }
  }
  return out
}

describe('SQL half and script half agree (#597 guard 9)', () => {
  let fxScript: CancelledFixture
  let fxSql: CancelledFixture

  beforeAll(async () => {
    fxScript = await createCancelledFixture('sql-twin-script')
    fxSql = await createCancelledFixture('sql-twin-sql')
  })

  afterAll(async () => {
    await fxScript.destroy()
    await fxSql.destroy()
  })

  beforeEach(async () => {
    await fxScript.wipe()
    await fxSql.wipe()
  })

  describe('count', () => {
    it('lists the same rows in the same order and reports the same four totals (database-wide)', async () => {
      await seed(fxScript)
      await seed(fxSql)

      const script = await repairCancelledAppointmentPayments({ apply: false })
      const sql = runSql(false)

      expect(sql.rows).toEqual(script.rows)
      expect(sql.totals).toEqual({
        paymentCount: script.paymentCount,
        appointmentCount: script.appointmentCount,
        frozenIsPaidCount: script.frozenIsPaidCount,
        patientCount: script.patientCount,
      })
    })

    it('finds the seeded positives: 3 payments, 2 appointments, 2 frozen, 2 patients per tenant (so the comparison is not over two empty sets)', async () => {
      const seeded = await seed(fxScript)
      const sql = runSql(false)
      const mine = sql.rows.filter((r) => r.tenantId === fxScript.tenantId)
      expect(mine).toHaveLength(3)
      expect(new Set(mine.map((r) => r.appointmentId)).size).toBe(2)
      expect(mine.filter((r) => r.appointmentIsPaid)).toHaveLength(3)
      expect(new Set(mine.map((r) => r.patientId)).size).toBe(2)
      // and the rows that must NOT be in it
      const { frozenA, frozenB, otherPatient, ...excluded } = seeded.payments
      expect(mine.map((r) => r.paymentId).sort()).toEqual([frozenA, frozenB, otherPatient].sort())
      for (const id of Object.values(excluded)) expect(sql.stdout).not.toContain(id)
    })

    it('the SQL count modifies nothing', async () => {
      const seeded = await seed(fxSql)
      const before = await postState(seeded)
      runSql(false)
      expect(await postState(seeded)).toEqual(before)
    })
  })

  describe('apply', () => {
    it('leaves the same post-state, role by role, from an identical seed', async () => {
      const a = await seed(fxScript)
      const b = await seed(fxSql)

      await repairCancelledAppointmentPayments({ apply: true, tenantId: fxScript.tenantId })
      runSql(true)

      const scriptState = await postState(a)
      const sqlState = await postState(b)
      expect(sqlState).toEqual(scriptState)
      // Not vacuous: the repair really happened on both sides.
      expect(scriptState['payment:frozenA']).toMatchObject({
        kind: 'ADVANCE',
        note: 'Pago en consulta (cita cancelada)',
        events: [{ type: 'CONVERTED_TO_ADVANCE', actorUserId: 'system:repair-597' }],
      })
      expect(scriptState['appointment:frozen']).toMatchObject({ isPaid: false })
      expect(scriptState['payment:completed']).toMatchObject({ kind: 'APPOINTMENT', events: [] })
    })

    it('the SQL apply is idempotent: a second run lists nothing for this tenant and changes nothing', async () => {
      const b = await seed(fxSql)
      runSql(true)
      const afterFirst = await postState(b)
      const second = runSql(true)
      expect(second.rows.filter((r) => r.tenantId === fxSql.tenantId)).toEqual([])
      expect(await postState(b)).toEqual(afterFirst)
    })

    it('the SQL apply reports exactly the rows it then converts (its own count agrees with its own repair)', async () => {
      const b = await seed(fxSql)
      const counted = runSql(false).rows.filter((r) => r.tenantId === fxSql.tenantId).map((r) => r.paymentId).sort()
      const applied = runSql(true).rows.filter((r) => r.tenantId === fxSql.tenantId).map((r) => r.paymentId).sort()
      expect(applied).toEqual(counted)
      const converted = await prisma.patientPaymentEvent.findMany({
        where: { tenantId: fxSql.tenantId, type: 'CONVERTED_TO_ADVANCE' },
        select: { paymentId: true },
      })
      expect(converted.map((e) => e.paymentId).sort()).toEqual(counted)
      expect(counted).toEqual([b.payments.frozenA, b.payments.frozenB, b.payments.otherPatient].sort())
    })
  })

  describe('KNOWN LIMITATION: the SQL half does not re-derive the FIFO allocation', () => {
    // The script re-runs recalculatePaidStatus per patient; the SQL cannot (FIFO
    // lives in application code). When converted money becomes credit that
    // covers OPEN debt on the same patient, the script flips that debt's isPaid
    // and the SQL leaves it stale until the patient's next recalculation. If the
    // SQL half is ever made to re-derive it, this test goes red and should be
    // rewritten as an agreement.
    it('with open debt behind the converted credit, the script flips the debt row to paid and the SQL leaves it false', async () => {
      const a = await seed(fxScript, true)
      const b = await seed(fxSql, true)

      const scriptResult = await repairCancelledAppointmentPayments({ apply: true, tenantId: fxScript.tenantId })
      runSql(true)

      expect(scriptResult.paidStatusChanges).toBe(1)
      const isPaid = async (id: string) => (await prisma.appointment.findUniqueOrThrow({ where: { id } })).isPaid
      expect(await isPaid(a.appointments.debt)).toBe(true)
      expect(await isPaid(b.appointments.debt)).toBe(false)

      // The stale column is exactly what a recalculation heals.
      const healed = await recalculatePaidStatus(fxSql.tenantId, b.debtPatient!)
      expect(healed.appointmentChanges).toBe(1)
      expect(await isPaid(b.appointments.debt)).toBe(true)
    })
  })
})
