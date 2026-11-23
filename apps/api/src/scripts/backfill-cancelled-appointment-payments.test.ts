import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { prisma } from '@dental/database'

import { backfillCancelledAppointmentPayments } from './backfill-cancelled-appointment-payments.js'
import {
  CANCELLED_APPOINTMENT_NOTE_SUFFIX,
  SYSTEM_ACTOR_BACKFILL_406,
  getTotalPaid,
  recalculatePaidStatus,
} from '../services/payment.service.js'
import { restoreAppointment } from '../services/appointment.service.js'

/**
 * DB-backed suite for the #406 backfill. Unlike recalc-paid-status.ts, this
 * script exports the whole pass as a function behind an `isCli` guard, so the
 * tests call it directly against dental_test and assert on real rows.
 *
 * The script's selector is global (no tenant filter), so counts that are
 * inherently global — matchedCount, patientsRecalculated — are asserted as a
 * delta over a baseline measured in beforeEach against whatever rows already
 * live in the test database. Everything scoped to the two fixture tenants is
 * asserted exactly.
 */
describe('backfillCancelledAppointmentPayments (#406)', () => {
  const suffix = Date.now()

  let tenantAId: string
  let tenantBId: string
  let patientA1Id: string
  let patientA2Id: string
  let patientB1Id: string
  let doctorAId: string
  let doctorBId: string

  // Fixture ids refreshed by beforeEach.
  let apptInactiveCancelledId: string
  let apptInactiveScheduledId: string
  let apptActiveCancelledId: string
  let apptActiveNormalId: string
  let apptA2InactiveId: string
  let apptB1InactiveId: string

  let pConvertWithNoteId: string
  let pConvertNullNoteId: string
  let pActiveCancelledId: string
  let pActiveNormalId: string
  let pAlreadyAdvanceId: string
  let pSoftDeletedId: string
  let pConvertA2Id: string
  let pConvertB1Id: string

  /** Matching rows that exist in the database outside this suite's fixtures. */
  let foreignMatched: number
  let foreignPatients: number
  let foreignPaidStatusChanges: number
  /** Task #715: the same baseline for the row list and the four new counts. */
  let foreignRowIds: Set<string>
  let foreignAppointmentCount: number
  let foreignPatientCount: number
  let foreignTenantCount: number
  let foreignTotalCents: number

  const NOTE_WITH_TEXT = 'Pago en consulta'

  async function seedAppointment(
    tenantId: string,
    patientId: string,
    doctorId: string,
    hourOffset: number,
    cost: number,
    overrides: Record<string, unknown> = {}
  ) {
    return prisma.appointment.create({
      data: {
        tenantId,
        patientId,
        doctorId,
        startTime: new Date(Date.now() + hourOffset * 3600_000),
        endTime: new Date(Date.now() + hourOffset * 3600_000 + 1800_000),
        duration: 30,
        cost,
        ...overrides,
      },
    })
  }

  async function seedPayment(
    tenantId: string,
    patientId: string,
    amount: number,
    overrides: Record<string, unknown> = {}
  ) {
    return prisma.patientPayment.create({
      data: { tenantId, patientId, amount, date: new Date(), kind: 'ADVANCE', ...overrides },
    })
  }

  async function payment(id: string) {
    return prisma.patientPayment.findUniqueOrThrow({
      where: { id },
      select: { id: true, kind: true, note: true, appointmentId: true, tenantId: true, patientId: true, isActive: true },
    })
  }

  /** Cached paid-status + totals across both fixture tenants, for equality checks. */
  async function snapshot() {
    const tenantIds = [tenantAId, tenantBId]
    const appointments = await prisma.appointment.findMany({
      where: { tenantId: { in: tenantIds } },
      select: { id: true, isPaid: true },
      orderBy: { id: 'asc' },
    })
    const labworks = await prisma.labwork.findMany({
      where: { tenantId: { in: tenantIds } },
      select: { id: true, isPaid: true },
      orderBy: { id: 'asc' },
    })
    const totals: Record<string, number> = {}
    for (const [tenantId, patientId] of [
      [tenantAId, patientA1Id],
      [tenantAId, patientA2Id],
      [tenantBId, patientB1Id],
    ]) {
      totals[patientId] = await getTotalPaid(tenantId, patientId)
    }
    return { appointments, labworks, totals }
  }

  async function wipeFixtureData() {
    const tenantIds = [tenantAId, tenantBId].filter(Boolean)
    if (tenantIds.length === 0) return
    await prisma.patientPayment.deleteMany({ where: { tenantId: { in: tenantIds } } })
    await prisma.labwork.deleteMany({ where: { tenantId: { in: tenantIds } } })
    await prisma.appointment.deleteMany({ where: { tenantId: { in: tenantIds } } })
  }

  beforeAll(async () => {
    let freePlan = await prisma.plan.findUnique({ where: { name: 'free' } })
    if (!freePlan) {
      freePlan = await prisma.plan.create({
        data: { name: 'free', displayName: 'Free', price: 0, maxAdmins: 1, maxDoctors: 3, maxPatients: 50 },
      })
    }

    const tenantA = await prisma.tenant.create({
      data: { name: 'Backfill 406 A', slug: `backfill-406-a-${suffix}` },
    })
    const tenantB = await prisma.tenant.create({
      data: { name: 'Backfill 406 B', slug: `backfill-406-b-${suffix}` },
    })
    tenantAId = tenantA.id
    tenantBId = tenantB.id

    for (const tenantId of [tenantAId, tenantBId]) {
      await prisma.subscription.create({
        data: {
          tenantId,
          planId: freePlan.id,
          status: 'ACTIVE',
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
      })
    }

    patientA1Id = (await prisma.patient.create({ data: { tenantId: tenantAId, firstName: 'Ana', lastName: 'Uno' } })).id
    patientA2Id = (await prisma.patient.create({ data: { tenantId: tenantAId, firstName: 'Ana', lastName: 'Dos' } })).id
    patientB1Id = (await prisma.patient.create({ data: { tenantId: tenantBId, firstName: 'Beto', lastName: 'Uno' } })).id

    doctorAId = (
      await prisma.doctor.create({
        data: { tenantId: tenantAId, firstName: 'Doc', lastName: 'A', email: `backfill-406-a-${suffix}@test.com` },
      })
    ).id
    doctorBId = (
      await prisma.doctor.create({
        data: { tenantId: tenantBId, firstName: 'Doc', lastName: 'B', email: `backfill-406-b-${suffix}@test.com` },
      })
    ).id
  })

  afterAll(async () => {
    await wipeFixtureData()
    for (const tenantId of [tenantAId, tenantBId]) {
      await prisma.patient.deleteMany({ where: { tenantId } })
      await prisma.doctor.deleteMany({ where: { tenantId } })
      await prisma.subscription.deleteMany({ where: { tenantId } })
      await prisma.tenant.delete({ where: { id: tenantId } })
    }
  })

  beforeEach(async () => {
    await wipeFixtureData()

    // Measured with the fixtures absent, so foreign rows can never make an
    // exact assertion below flaky (and re-measured per test because an
    // `--apply` test converts foreign rows too).
    const baseline = await backfillCancelledAppointmentPayments({ dryRun: true })
    foreignMatched = baseline.matchedCount
    foreignPatients = baseline.patientsRecalculated
    foreignPaidStatusChanges = baseline.paidStatusChanges
    foreignRowIds = new Set(baseline.rows.map((r) => r.paymentId))
    foreignAppointmentCount = baseline.appointmentCount
    foreignPatientCount = baseline.patientCount
    foreignTenantCount = baseline.tenantCount
    foreignTotalCents = Math.round(Number(baseline.totalAmount) * 100)

    // Tenant A / patient A1: the full matrix of shapes.
    apptInactiveCancelledId = (
      await seedAppointment(tenantAId, patientA1Id, doctorAId, 1, 50, { isActive: false, status: 'CANCELLED' })
    ).id
    apptInactiveScheduledId = (
      await seedAppointment(tenantAId, patientA1Id, doctorAId, 3, 60, { isActive: false, status: 'SCHEDULED' })
    ).id
    // Finding 2: cancelled through PUT /api/appointments/:id — isActive stays
    // true, so it never left the billable set and must not be converted.
    apptActiveCancelledId = (
      await seedAppointment(tenantAId, patientA1Id, doctorAId, 5, 70, { isActive: true, status: 'CANCELLED' })
    ).id
    apptActiveNormalId = (await seedAppointment(tenantAId, patientA1Id, doctorAId, 7, 100)).id

    apptA2InactiveId = (
      await seedAppointment(tenantAId, patientA2Id, doctorAId, 9, 25, { isActive: false, status: 'CANCELLED' })
    ).id
    apptB1InactiveId = (
      await seedAppointment(tenantBId, patientB1Id, doctorBId, 11, 80, { isActive: false, status: 'CANCELLED' })
    ).id

    await prisma.labwork.create({
      data: { tenantId: tenantAId, patientId: patientA1Id, lab: 'Lab Central', date: new Date(), price: 40 },
    })

    pConvertWithNoteId = (
      await seedPayment(tenantAId, patientA1Id, 30, {
        appointmentId: apptInactiveCancelledId,
        kind: 'APPOINTMENT',
        note: NOTE_WITH_TEXT,
      })
    ).id
    pConvertNullNoteId = (
      await seedPayment(tenantAId, patientA1Id, 20, {
        appointmentId: apptInactiveScheduledId,
        kind: 'APPOINTMENT',
        note: null,
      })
    ).id
    pActiveCancelledId = (
      await seedPayment(tenantAId, patientA1Id, 70, {
        appointmentId: apptActiveCancelledId,
        kind: 'APPOINTMENT',
        note: 'Cita marcada CANCELLED sin borrar',
      })
    ).id
    pActiveNormalId = (
      await seedPayment(tenantAId, patientA1Id, 100, {
        appointmentId: apptActiveNormalId,
        kind: 'APPOINTMENT',
        note: 'Consulta normal',
      })
    ).id
    pAlreadyAdvanceId = (
      await seedPayment(tenantAId, patientA1Id, 15, {
        appointmentId: apptInactiveCancelledId,
        kind: 'ADVANCE',
        note: 'Adelanto previo',
      })
    ).id
    pSoftDeletedId = (
      await seedPayment(tenantAId, patientA1Id, 99, {
        appointmentId: apptInactiveScheduledId,
        kind: 'APPOINTMENT',
        note: 'Pago anulado',
        isActive: false,
      })
    ).id

    pConvertA2Id = (
      await seedPayment(tenantAId, patientA2Id, 25, { appointmentId: apptA2InactiveId, kind: 'APPOINTMENT' })
    ).id
    pConvertB1Id = (
      await seedPayment(tenantBId, patientB1Id, 80, { appointmentId: apptB1InactiveId, kind: 'APPOINTMENT' })
    ).id

    // Seeded rows carry isPaid=false by default, which is not the state a
    // production row would be in. Settle the cache once here so the pass is
    // measured against a *correct* pre-state — otherwise the recalc would
    // report the fixture's own staleness as paid-status changes and finding
    // 4's "flips nothing" claim could not be observed at all.
    await recalculatePaidStatus(tenantAId, patientA1Id)
    await recalculatePaidStatus(tenantAId, patientA2Id)
    await recalculatePaidStatus(tenantBId, patientB1Id)
  })

  describe('dry run (the default — a bare invocation never writes)', () => {
    it('reports what would convert while leaving every kind and note untouched in the database', async () => {
      const result = await backfillCancelledAppointmentPayments({ dryRun: true })

      expect(result.matchedCount).toBe(foreignMatched + 4)

      expect(await payment(pConvertWithNoteId)).toMatchObject({ kind: 'APPOINTMENT', note: NOTE_WITH_TEXT })
      expect(await payment(pConvertNullNoteId)).toMatchObject({ kind: 'APPOINTMENT', note: null })
      expect(await payment(pConvertA2Id)).toMatchObject({ kind: 'APPOINTMENT', note: null })
      expect(await payment(pConvertB1Id)).toMatchObject({ kind: 'APPOINTMENT', note: null })
    })

    it('counts the distinct (tenant, patient) pairs it would recalculate', async () => {
      const result = await backfillCancelledAppointmentPayments({ dryRun: true })

      // A1, A2 and B1 — the two A1 payments collapse into one pair.
      expect(result.patientsRecalculated).toBe(foreignPatients + 3)
      // Zero for the fixtures; the baseline term only absorbs staleness that
      // pre-existed in foreign rows and is 0 in a clean test database.
      expect(result.paidStatusChanges).toBe(foreignPaidStatusChanges)
    })
  })

  describe('per-tenant counts', () => {
    it('tallies converted payments under their own tenantId', async () => {
      const result = await backfillCancelledAppointmentPayments({ dryRun: true })

      expect(result.perTenantCounts.get(tenantAId)).toBe(3)
      expect(result.perTenantCounts.get(tenantBId)).toBe(1)
    })

    it('keeps matchedCount equal to the sum of the per-tenant counts', async () => {
      const result = await backfillCancelledAppointmentPayments({ dryRun: true })

      const summed = [...result.perTenantCounts.values()].reduce((a, b) => a + b, 0)
      expect(summed).toBe(result.matchedCount)
    })
  })

  describe('--apply (dryRun: false)', () => {
    it('converts a matching payment to ADVANCE, preserving appointmentId and appending the suffix', async () => {
      await backfillCancelledAppointmentPayments({ dryRun: false })

      expect(await payment(pConvertWithNoteId)).toMatchObject({
        kind: 'ADVANCE',
        note: `${NOTE_WITH_TEXT}${CANCELLED_APPOINTMENT_NOTE_SUFFIX}`,
        appointmentId: apptInactiveCancelledId,
        tenantId: tenantAId,
        patientId: patientA1Id,
      })
    })

    it('writes the bare suffix as the note when the original note was null', async () => {
      await backfillCancelledAppointmentPayments({ dryRun: false })

      expect(await payment(pConvertNullNoteId)).toMatchObject({
        kind: 'ADVANCE',
        note: CANCELLED_APPOINTMENT_NOTE_SUFFIX,
        appointmentId: apptInactiveScheduledId,
      })
    })

    it('converts matches in every tenant without leaking rows across tenants', async () => {
      const result = await backfillCancelledAppointmentPayments({ dryRun: false })

      expect(result.perTenantCounts.get(tenantAId)).toBe(3)
      expect(result.perTenantCounts.get(tenantBId)).toBe(1)

      expect(await payment(pConvertA2Id)).toMatchObject({ kind: 'ADVANCE', tenantId: tenantAId, patientId: patientA2Id })
      expect(await payment(pConvertB1Id)).toMatchObject({ kind: 'ADVANCE', tenantId: tenantBId, patientId: patientB1Id })
    })

    // Task #449: the script used to duplicate the conversion inline, so a row
    // it converted carried no audit event. It now calls the shared helper.
    describe('Task #449: the conversion is audited', () => {
      it('writes a CONVERTED_TO_ADVANCE event attributed to the system actor', async () => {
        await backfillCancelledAppointmentPayments({ dryRun: false })

        const events = await prisma.patientPaymentEvent.findMany({
          where: { paymentId: pConvertWithNoteId },
        })
        expect(events).toHaveLength(1)
        expect(events[0]).toMatchObject({
          type: 'CONVERTED_TO_ADVANCE',
          // NOT null. Null already means "the actor is unrecoverable" (#392
          // renders pre-#392 reversals that way), so a script writing null
          // would say something false by omission.
          actorUserId: SYSTEM_ACTOR_BACKFILL_406,
        })
        expect(events[0].actorUserId).not.toBeNull()
      })

      it('a dry run writes NO events', async () => {
        // An audit row for work that did not happen is the same defect as a
        // placeholder actor, from the other direction: both put something in
        // the ledger that is not true.
        const before = await prisma.patientPaymentEvent.count()

        await backfillCancelledAppointmentPayments({ dryRun: true })

        expect(await prisma.patientPaymentEvent.count()).toBe(before)
        expect(await prisma.patientPaymentEvent.count({ where: { paymentId: pConvertWithNoteId } })).toBe(0)
      })

      it('a backfilled row later restored leaves a MATCHED PAIR, not an orphan restore', async () => {
        // The consequence that made this worth fixing rather than watching.
        // restoreAppointmentPaymentsFromAdvance matches { kind: 'ADVANCE',
        // appointmentId, isActive: true } — which a backfilled row satisfies.
        // Before this change the restore emitted RESTORED_TO_APPOINTMENT with
        // no matching conversion: half a round trip, which reads as a real
        // imbalance and invites someone to investigate a discrepancy the
        // system invented.
        await backfillCancelledAppointmentPayments({ dryRun: false })
        await restoreAppointment(tenantAId, apptInactiveCancelledId, 'operator-449')

        const events = await prisma.patientPaymentEvent.findMany({
          where: { paymentId: pConvertWithNoteId },
          orderBy: { occurredAt: 'asc' },
        })
        expect(events.map((e) => e.type)).toEqual([
          'CONVERTED_TO_ADVANCE',
          'RESTORED_TO_APPOINTMENT',
        ])
        // And the two halves name different doers, which is the point of
        // recording an actor at all.
        expect(events[0].actorUserId).toBe(SYSTEM_ACTOR_BACKFILL_406)
        expect(events[1].actorUserId).toBe('operator-449')
      })
    })

    describe('untouched cases', () => {
      it('leaves a payment on an isActive=true, status=CANCELLED appointment alone (finding 2)', async () => {
        const before = await payment(pActiveCancelledId)
        await backfillCancelledAppointmentPayments({ dryRun: false })

        // The appointment never left the billable set, so its cost still
        // counts as debt and this payment still counts as paid — consistent
        // as-is, and converting it would be irreversible.
        expect(await payment(pActiveCancelledId)).toEqual(before)
        expect(before.kind).toBe('APPOINTMENT')
        expect(
          await prisma.appointment.findUniqueOrThrow({ where: { id: apptActiveCancelledId } })
        ).toMatchObject({ isActive: true, status: 'CANCELLED' })
      })

      it('leaves a payment on a normal active appointment alone', async () => {
        const before = await payment(pActiveNormalId)
        await backfillCancelledAppointmentPayments({ dryRun: false })

        expect(await payment(pActiveNormalId)).toEqual(before)
      })

      it('leaves an already-ADVANCE payment alone (no second suffix)', async () => {
        const before = await payment(pAlreadyAdvanceId)
        await backfillCancelledAppointmentPayments({ dryRun: false })

        expect(await payment(pAlreadyAdvanceId)).toEqual(before)
        expect(before.note).toBe('Adelanto previo')
      })

      it('leaves a soft-deleted (isActive=false) payment alone', async () => {
        const before = await payment(pSoftDeletedId)
        await backfillCancelledAppointmentPayments({ dryRun: false })

        expect(await payment(pSoftDeletedId)).toEqual(before)
        expect(before.kind).toBe('APPOINTMENT')
      })
    })
  })

  describe('paid-status equality across the pass (finding 4)', () => {
    it('leaves getTotalPaid and every cached isPaid identical, and reports zero paid-status changes', async () => {
      // Establish the real cached state first, exactly as production rows
      // would carry it.
      const before = await snapshot()

      const result = await backfillCancelledAppointmentPayments({ dryRun: false })
      const after = await snapshot()

      expect(result.paidStatusChanges).toBe(foreignPaidStatusChanges)
      expect(after.totals).toEqual(before.totals)
      expect(after.appointments).toEqual(before.appointments)
      expect(after.labworks).toEqual(before.labworks)
    })
  })

  /**
   * Task #715: the result grew a row list and four counts so the SQL twin can
   * be compared against this half row for row. The twin's own suite
   * (backfill-cancelled-appointment-payments.sql.test.ts) asserts the
   * agreement; these guards pin what this half reports, independently of psql.
   */
  describe('task #715: the reported rows and totals', () => {
    /** The four matching fixture payments, as rows, in no particular order. */
    function expectedRows() {
      return [
        { tenantId: tenantAId, patientId: patientA1Id, appointmentId: apptInactiveCancelledId, paymentId: pConvertWithNoteId, amount: '30.00' },
        { tenantId: tenantAId, patientId: patientA1Id, appointmentId: apptInactiveScheduledId, paymentId: pConvertNullNoteId, amount: '20.00' },
        { tenantId: tenantAId, patientId: patientA2Id, appointmentId: apptA2InactiveId, paymentId: pConvertA2Id, amount: '25.00' },
        { tenantId: tenantBId, patientId: patientB1Id, appointmentId: apptB1InactiveId, paymentId: pConvertB1Id, amount: '80.00' },
      ]
    }

    const byPaymentId = (a: { paymentId: string }, b: { paymentId: string }) =>
      a.paymentId < b.paymentId ? -1 : a.paymentId > b.paymentId ? 1 : 0

    it('lists one row per matched payment, carrying ids and a two-decimal amount and nothing else', async () => {
      const result = await backfillCancelledAppointmentPayments({ dryRun: true })
      const mine = result.rows.filter((r) => !foreignRowIds.has(r.paymentId))

      expect([...mine].sort(byPaymentId)).toEqual(expectedRows().sort(byPaymentId))
      // Asserted separately from the content above: the row object carries
      // exactly five keys, so no patient name can ride along in a sixth.
      for (const row of mine) {
        expect(Object.keys(row).sort()).toEqual(['amount', 'appointmentId', 'patientId', 'paymentId', 'tenantId'])
      }
    })

    it('counts the rows as matchedCount and nothing else as a row', async () => {
      const result = await backfillCancelledAppointmentPayments({ dryRun: true })

      expect(result.rows).toHaveLength(result.matchedCount)
      expect(result.rows.filter((r) => !foreignRowIds.has(r.paymentId))).toHaveLength(4)
    })

    it('reports appointmentCount, patientCount and tenantCount as three figures that differ from each other and from the payment count', async () => {
      // A SECOND payment on an appointment that already matches, so the four
      // figures are four different numbers (5 / 4 / 3 / 2). Without it the
      // fixture holds one payment per appointment and appointmentCount could
      // be the payment count under another name — a blind guard.
      await seedPayment(tenantAId, patientA1Id, 10, {
        appointmentId: apptInactiveCancelledId,
        kind: 'APPOINTMENT',
        note: 'Segundo pago de la misma cita',
      })

      const result = await backfillCancelledAppointmentPayments({ dryRun: true })

      expect(result.matchedCount - foreignMatched).toBe(5)
      expect(result.appointmentCount - foreignAppointmentCount).toBe(4)
      expect(result.patientCount - foreignPatientCount).toBe(3)
      expect(result.tenantCount - foreignTenantCount).toBe(2)
      // patientCount counts (tenantId, patientId) pairs and is the figure the
      // recalc pass is driven by, so the two must not drift apart.
      expect(result.patientCount).toBe(result.patientsRecalculated)
    })

    it('sums only the matched amounts into totalAmount', async () => {
      const result = await backfillCancelledAppointmentPayments({ dryRun: true })
      const cents = Math.round(Number(result.totalAmount) * 100)

      // 30 + 20 + 25 + 80.
      expect(((cents - foreignTotalCents) / 100).toFixed(2)).toBe('155.00')
      // Discriminating against a sum over the whole table: the fixture's
      // NON-matching payments add up to 284.00 (70 + 100 + 15 + 99), so an
      // over-broad sum would read 439.00 here.
      expect(result.totalAmount).toMatch(/^\d+\.\d{2}$/)
      const nonMatching = await prisma.patientPayment.aggregate({
        where: { tenantId: { in: [tenantAId, tenantBId] }, id: { notIn: [pConvertWithNoteId, pConvertNullNoteId, pConvertA2Id, pConvertB1Id] } },
        _sum: { amount: true },
      })
      expect(nonMatching._sum.amount?.toFixed(2)).toBe('284.00')
    })

    it('orders the rows by tenant, then patient, then appointment', async () => {
      const result = await backfillCancelledAppointmentPayments({ dryRun: true })

      // Compared as grouping rather than as string order: Postgres sorts cuids
      // under its own collation, which is not JS's, and the point of the
      // orderBy is that the SQL twin can be compared without either side
      // re-sorting.
      const contiguous = (keys: string[]) => {
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
      expect(contiguous(result.rows.map((r) => r.tenantId))).toBe(true)
      expect(contiguous(result.rows.map((r) => `${r.tenantId}:${r.patientId}`))).toBe(true)
      // Non-vacuous: patient A1 really does hold two of the matched rows, so
      // there is a group to be contiguous.
      expect(result.rows.filter((r) => r.patientId === patientA1Id)).toHaveLength(2)
    })

    it('reports an empty row list and zero counts when nothing matches', async () => {
      const seeded = await backfillCancelledAppointmentPayments({ dryRun: true })
      expect(seeded.rows.length).toBeGreaterThan(0)

      await wipeFixtureData()
      const empty = await backfillCancelledAppointmentPayments({ dryRun: true })

      // The fixtures are gone; only whatever foreign rows the baseline measured
      // remain, so every figure falls back to its baseline.
      expect(empty.rows.map((r) => r.paymentId).sort()).toEqual([...foreignRowIds].sort())
      expect(empty.appointmentCount).toBe(foreignAppointmentCount)
      expect(empty.patientCount).toBe(foreignPatientCount)
      expect(empty.tenantCount).toBe(foreignTenantCount)
      expect(empty.totalAmount).toBe((foreignTotalCents / 100).toFixed(2))
    })

    it('reports the same rows on a dry run and on an apply', async () => {
      const dry = await backfillCancelledAppointmentPayments({ dryRun: true })
      const applied = await backfillCancelledAppointmentPayments({ dryRun: false })

      // The row list is the PRE-state in both cases, which is what makes a dry
      // run usable as the plan the apply then carries out.
      expect(applied.rows).toEqual(dry.rows)
      expect(applied.totalAmount).toBe(dry.totalAmount)
      expect(dry.rows.filter((r) => !foreignRowIds.has(r.paymentId))).toHaveLength(4)
    })
  })

  describe('idempotence (structural — a converted row is no longer kind=APPOINTMENT)', () => {
    it('converts zero rows on a second run and appends no second suffix', async () => {
      await backfillCancelledAppointmentPayments({ dryRun: false })
      const afterFirst = await payment(pConvertWithNoteId)

      const second = await backfillCancelledAppointmentPayments({ dryRun: false })

      expect(second.perTenantCounts.has(tenantAId)).toBe(false)
      expect(second.perTenantCounts.has(tenantBId)).toBe(false)
      expect(await payment(pConvertWithNoteId)).toEqual(afterFirst)
      expect(afterFirst.note).toBe(`${NOTE_WITH_TEXT}${CANCELLED_APPOINTMENT_NOTE_SUFFIX}`)
    })
  })

  describe('round trip through restoreAppointment', () => {
    it('returns a backfilled payment to kind=APPOINTMENT with its original note', async () => {
      await backfillCancelledAppointmentPayments({ dryRun: false })
      expect(await payment(pConvertWithNoteId)).toMatchObject({ kind: 'ADVANCE' })

      const restored = await restoreAppointment(tenantAId, apptInactiveCancelledId, 'actor-392b')
      expect(restored.error).toBeUndefined()

      // Only possible because the backfill preserved appointmentId: the
      // restore path matches on (tenantId, appointmentId, kind=ADVANCE).
      expect(await payment(pConvertWithNoteId)).toMatchObject({
        kind: 'APPOINTMENT',
        note: NOTE_WITH_TEXT,
        appointmentId: apptInactiveCancelledId,
      })
    })
  })
})
