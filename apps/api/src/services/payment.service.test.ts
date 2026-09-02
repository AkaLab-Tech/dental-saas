import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { prisma } from '@dental/database'
import {
  computeFifoAllocation,
  computeOutstandingByPatient,
  convertAppointmentPaymentsToAdvance,
  getTenantOutstandingTotal,
  listDebtors,
  restoreAppointmentPaymentsFromAdvance,
  type BillableItem,
  type FifoAllocation,
} from './payment.service.js'

// Pure-function unit tests for the two-stage (earmark, then FIFO pool)
// allocator introduced by #390. No Prisma/DB involved — `computeFifoAllocation`
// takes plain data in and returns plain data out.

function item(id: string, cost: number, dayOffset = 0, type: BillableItem['type'] = 'appointment'): BillableItem {
  return {
    id,
    type,
    cost,
    date: new Date(2025, 0, 1 + dayOffset),
    isPaid: false,
  }
}

function byId(allocations: FifoAllocation[]): Map<string, FifoAllocation> {
  return new Map(allocations.map((a) => [a.id, a]))
}

describe('computeFifoAllocation', () => {
  describe('backward compatibility — called without earmarks', () => {
    const items = [item('a', 100), item('b', 100, 1), item('c', 100, 2)]

    it('matches the pre-#390 partial-then-stop FIFO behavior with no earmarks argument at all', () => {
      const result = computeFifoAllocation(items, 110)
      expect(result).toEqual([
        { id: 'a', type: 'appointment', cost: 100, paidAmount: 100, outstanding: 0, isPaid: true },
        { id: 'b', type: 'appointment', cost: 100, paidAmount: 10, outstanding: 90, isPaid: false },
        { id: 'c', type: 'appointment', cost: 100, paidAmount: 0, outstanding: 100, isPaid: false },
      ])
    })

    it('produces byte-identical output whether earmarks is omitted or an empty Map', () => {
      const withoutArg = computeFifoAllocation(items, 250)
      const withEmptyMap = computeFifoAllocation(items, 250, new Map())
      expect(withEmptyMap).toEqual(withoutArg)
    })

    it('produces byte-identical output whether earmarks is omitted or a Map with no matching ids', () => {
      const withoutArg = computeFifoAllocation(items, 40)
      const withIrrelevantMap = computeFifoAllocation(items, 40, new Map([['does-not-exist', 999]]))
      expect(withIrrelevantMap).toEqual(withoutArg)
    })
  })

  describe('earmark absorption', () => {
    it('caps an earmark larger than its item cost at cost; the excess joins the pool oldest-first', () => {
      const items = [item('old', 100), item('new', 50, 1)]
      // "new" is earmarked for 80, but its cost is only 50: 50 is absorbed,
      // the remaining 30 becomes pool money that reaches the older item.
      const result = computeFifoAllocation(items, 80, new Map([['new', 80]]))
      const map = byId(result)
      expect(map.get('new')).toEqual({
        id: 'new',
        type: 'appointment',
        cost: 50,
        paidAmount: 50,
        outstanding: 0,
        isPaid: true,
      })
      expect(map.get('old')).toEqual({
        id: 'old',
        type: 'appointment',
        cost: 100,
        paidAmount: 30,
        outstanding: 70,
        isPaid: false,
      })
    })

    it('an earmark smaller than its item cost leaves the remainder outstanding and contributes nothing to any other item', () => {
      const items = [item('old', 100), item('new', 50, 1)]
      // "new" earmarked for 20 (< its 50 cost); no other money in the system.
      const result = computeFifoAllocation(items, 20, new Map([['new', 20]]))
      const map = byId(result)
      expect(map.get('new')).toEqual({
        id: 'new',
        type: 'appointment',
        cost: 50,
        paidAmount: 20,
        outstanding: 30,
        isPaid: false,
      })
      // The older item receives none of it — earmarked money never leaks
      // to a different item, even one earlier in FIFO order.
      expect(map.get('old')).toEqual({
        id: 'old',
        type: 'appointment',
        cost: 100,
        paidAmount: 0,
        outstanding: 100,
        isPaid: false,
      })
    })

    it('an earmark id absent from items is never stranded — the whole amount still reaches the pool', () => {
      const items = [item('a', 100)]
      const result = computeFifoAllocation(items, 60, new Map([['ghost-id', 60]]))
      expect(result).toEqual([
        { id: 'a', type: 'appointment', cost: 100, paidAmount: 60, outstanding: 40, isPaid: false },
      ])
    })

    it('an earmark on a zero-cost item contributes 0; the full amount flows to the pool', () => {
      const items = [item('free', 0), item('a', 100, 1)]
      const result = computeFifoAllocation(items, 100, new Map([['free', 100]]))
      const map = byId(result)
      expect(map.get('free')).toEqual({
        id: 'free',
        type: 'appointment',
        cost: 0,
        paidAmount: 0,
        outstanding: 0,
        isPaid: false, // cost > 0 is required for isPaid; a free item is never "paid"
      })
      expect(map.get('a')).toEqual({
        id: 'a',
        type: 'appointment',
        cost: 100,
        paidAmount: 100,
        outstanding: 0,
        isPaid: true,
      })
    })

    it('multiple earmarked items each claim their own money before any pool distribution happens', () => {
      const items = [item('a', 100), item('b', 100, 1), item('c', 100, 2)]
      // b (middle, by FIFO order) and c (last) both hold their own earmark;
      // only $10 of unearmarked pool money exists, which must reach the
      // oldest unearmarked capacity — item a.
      const earmarks = new Map([
        ['b', 100],
        ['c', 40],
      ])
      const totalPaid = 100 + 40 + 10 // b's earmark + c's earmark + pool
      const result = computeFifoAllocation(items, totalPaid, earmarks)
      const map = byId(result)
      expect(map.get('a')?.paidAmount).toBe(10)
      expect(map.get('b')).toMatchObject({ paidAmount: 100, isPaid: true })
      expect(map.get('c')).toMatchObject({ paidAmount: 40, isPaid: false, outstanding: 60 })
    })
  })

  describe('invariant: sum(paidAmount) === min(totalPaid, sum(cost))', () => {
    // This is exactly the property that makes leaving getPatientBalance and
    // listDebtors earmark-unaware safe (see the invariant comment above
    // getPatientBalance in payment.service.ts): earmarking only redistributes
    // a fixed pot of money among a patient's items, it never changes how much
    // of the total pot ends up applied.
    //
    // Costs and earmarks below are 2-decimal clinic amounts, not integers.
    // An earlier version of this suite used only integers (100/50/200),
    // which is exactly why it never caught the IEEE round-trip regression
    // described in the mixed-precision describe block below: integer
    // arithmetic on doubles has no rounding error to expose.
    const items = [item('a', 120.35), item('b', 50.15, 1), item('c', 200.4, 2)]
    const totalCost = 370.9

    const earmarkScenarios: { label: string; earmarks: Map<string, number> | undefined }[] = [
      { label: 'no earmarks argument', earmarks: undefined },
      { label: 'empty earmarks map', earmarks: new Map() },
      { label: 'a single under-cost earmark', earmarks: new Map([['a', 30.1]]) },
      { label: 'an earmark larger than its own item cost', earmarks: new Map([['a', 500.5]]) },
      { label: 'an over-cost earmark on the middle item', earmarks: new Map([['b', 999.9]]) },
      { label: 'an earmark id absent from items', earmarks: new Map([['ghost', 40.4]]) },
      {
        label: 'every item earmarked exactly at cost',
        earmarks: new Map([
          ['a', 120.35],
          ['b', 50.15],
          ['c', 200.4],
        ]),
      },
      {
        label: 'every item earmarked far over cost',
        earmarks: new Map([
          ['a', 1000.1],
          ['b', 1000.1],
          ['c', 1000.1],
        ]),
      },
      {
        label: 'mixed under/over/absent earmarks together',
        earmarks: new Map([
          ['a', 10.1],
          ['b', 9999.9],
          ['ghost', 5.5],
        ]),
      },
      {
        label: 'mixed case — item exactly covered by earmark + pool (the #390 regression repro)',
        earmarks: new Map([['a', 40.1]]),
      },
    ]

    const totalPaidScenarios = [0, 1, 49.05, 100.2, 150.35, 200.6, 349.9, 370.9, 371.15, 500.5, 10_000.25]

    // Mirrors the earmarked[] computation inside computeFifoAllocation
    // itself, purely to derive a realistic floor for totalPaid per scenario
    // below (see the precondition note).
    function totalEarmarkedFor(earmarks: ReadonlyMap<string, number> | undefined): number {
      return items.reduce(
        (sum, it) => sum + (it.cost > 0 ? Math.min(earmarks?.get(it.id) ?? 0, it.cost) : 0),
        0
      )
    }

    for (const { label, earmarks } of earmarkScenarios) {
      it(`holds for every totalPaid value with earmarks: ${label}`, () => {
        const totalEarmarked = totalEarmarkedFor(earmarks)
        // Precondition of the two real call sites (recalculatePaidStatus,
        // getPatientAccountStatement): earmarks come from summing a SUBSET
        // (kind=APPOINTMENT) of the same active payments that totalPaid
        // sums in full, so totalPaid >= totalEarmarked always holds in
        // production. A totalPaid lower than the earmarked amount is not a
        // reachable state — the earmarked money would have had to come from
        // payments that were never counted in totalPaid. We test right at
        // that boundary (totalEarmarked itself) plus every scenario value at
        // or above it.
        const applicablePaidValues = [
          totalEarmarked,
          ...totalPaidScenarios.filter((v) => v >= totalEarmarked),
        ]
        for (const totalPaid of applicablePaidValues) {
          const allocations = computeFifoAllocation(items, totalPaid, earmarks)
          const sumPaid = allocations.reduce((sum, a) => sum + a.paidAmount, 0)
          // toBeCloseTo, not toBe: paidAmount/outstanding are each
          // independently rounded from integer cents back to dollars, so
          // re-summing (or re-subtracting) the already-rounded dollar
          // figures can land 1 ULP away from a value computed straight
          // from totalPaid/totalCost — that is expected float behavior,
          // not a bug. Precision 9 is far tighter than currency (2dp)
          // while still catching any real (cent-level) logic error.
          expect(sumPaid).toBeCloseTo(Math.min(totalPaid, totalCost), 9)
          // Every item's paidAmount is bounded by its own cost, and
          // outstanding never goes negative.
          for (const a of allocations) {
            expect(a.paidAmount).toBeLessThanOrEqual(a.cost)
            expect(a.paidAmount).toBeGreaterThanOrEqual(0)
            expect(a.outstanding).toBeGreaterThanOrEqual(0)
            expect(a.outstanding).toBeCloseTo(a.cost - a.paidAmount, 9)
            expect(a.isPaid).toBe(a.cost > 0 && a.paidAmount >= a.cost)
          }
          // Independent of computeFifoAllocation's own paidAmount formula:
          // once the pot is large enough to cover every item's cost in
          // full, every item must report isPaid true and exactly 0
          // outstanding. This is the invariant the #390 floating-point
          // regression violated — paidAmount landed a few ULPs short of
          // cost (e.g. 120.29999999999998 instead of 120.30) even though
          // totalPaid mathematically covered it, flipping isPaid to false.
          if (totalPaid >= totalCost) {
            for (const a of allocations) {
              if (a.cost > 0) {
                expect(a.isPaid).toBe(true)
                expect(a.outstanding).toBe(0)
              }
            }
          }
        }
      })
    }
  })

  describe('mixed item types (appointments and labworks) share one FIFO order', () => {
    it('earmarks only ever apply to the appointment id they name, labworks are unaffected', () => {
      const items = [
        item('apt-1', 100, 0, 'appointment'),
        item('lab-1', 50, 1, 'labwork'),
      ]
      const result = computeFifoAllocation(items, 100, new Map([['apt-1', 100]]))
      const map = byId(result)
      expect(map.get('apt-1')).toMatchObject({ paidAmount: 100, isPaid: true })
      expect(map.get('lab-1')).toMatchObject({ paidAmount: 0, isPaid: false })
    })
  })

  describe('floating-point precision — MIXED case (earmark + pool both contribute)', () => {
    // The reviewer's canonical repro for the #390 regression: an appointment
    // covered partly by its own earmarked (kind=APPOINTMENT) payment and
    // partly by the advance pool. Pre-fix, `earmarked[i] + fromPool` (a
    // subtract-then-re-add round trip: capacity = cost - earmarked, then
    // earmarked + fromPool where fromPool === capacity) is lossy on IEEE
    // doubles: paidAmount landed at 120.29999999999998 instead of 120.30,
    // so isPaid read false and outstanding read 1.4210854715202004e-14 for
    // an appointment that was, in reality, paid in full.
    it('120.30 cost / 40.10 earmarked / 80.20 from the pool reports isPaid true and outstanding exactly 0', () => {
      const items = [item('apt', 120.3)]
      const result = computeFifoAllocation(items, 40.1 + 80.2, new Map([['apt', 40.1]]))
      expect(result).toEqual([
        {
          id: 'apt',
          type: 'appointment',
          cost: 120.3,
          paidAmount: 120.3,
          outstanding: 0,
          isPaid: true,
        },
      ])
    })

    // The trap that defeats a "simpler" one-liner fix: computing
    // `capacity = cost - earmarked` in dollars (rather than in integer
    // cents) is lossy in a way that leaks a fractional-cent residue onto
    // the *next* item's remaining pool, not just the earmarked item itself.
    // With capacity1 computed as 1.30 - 0.43 in IEEE doubles
    // (0.8700000000000001, not 0.87), `remaining -= capacity1` leaves
    // 1.6999999999999997 instead of 1.70 for item 2's pool, which then
    // fails `paidAmountCents2 >= costCents2` and flips apt2's isPaid to
    // false even though the pot exactly covers both items. Pinned here so
    // nobody "simplifies" the cents-based logic back into this trap.
    it('two items sharing one pool (apt1 1.30 cost / 0.43 earmarked, apt2 1.70 cost, totalPaid 3.00) both report isPaid true with 0 outstanding', () => {
      const items = [item('apt1', 1.3), item('apt2', 1.7, 1)]
      const result = computeFifoAllocation(items, 3.0, new Map([['apt1', 0.43]]))
      expect(result).toEqual([
        { id: 'apt1', type: 'appointment', cost: 1.3, paidAmount: 1.3, outstanding: 0, isPaid: true },
        { id: 'apt2', type: 'appointment', cost: 1.7, paidAmount: 1.7, outstanding: 0, isPaid: true },
      ])
    })

    it('holds for a sweep of 2-decimal costs and earmark splits that mix earmark + pool coverage', () => {
      // A bounded, deterministic stand-in for the reviewer's full sweep
      // (every 2-decimal cost from 1.00 to 5000.00 against six earmark
      // splits — 10,448/599,886 failures pre-fix, 0/599,886 post-fix).
      // Cent-based generation with a non-round step is chosen specifically
      // to land on many different fractional endings (not just .x0/.x5),
      // which is what makes doubles round the subtract-then-re-add
      // differently from case to case.
      const failures: string[] = []
      const stepCents = 3737 // coprime-ish step: walks through varied fractional endings
      for (let costCents = 100; costCents <= 500_000; costCents += stepCents) {
        const cost = costCents / 100
        const splitsCents = [
          1,
          Math.round(costCents / 4),
          Math.round(costCents / 3),
          Math.round(costCents / 2),
          Math.round((costCents * 2) / 3),
          costCents - 1,
        ]
        for (const earmarkCents of splitsCents) {
          const earmarkAmount = earmarkCents / 100
          const items = [item('x', cost)]
          // Full coverage: earmark claims its own item first, and the pool
          // (totalPaid - earmark) supplies exactly the remaining capacity.
          const result = computeFifoAllocation(items, cost, new Map([['x', earmarkAmount]]))
          const allocation = result[0]
          if (allocation.isPaid !== true || allocation.outstanding !== 0) {
            failures.push(
              `cost=${cost} earmark=${earmarkAmount} -> paidAmount=${allocation.paidAmount} ` +
                `isPaid=${allocation.isPaid} outstanding=${allocation.outstanding}`
            )
          }
        }
      }
      expect(failures).toEqual([])
    })
  })

  describe('remaining pool clamp — totalEarmarked > totalPaid (non-transactional read race)', () => {
    // buildPatientAllocationMap reads totalPaid and per-appointment earmarks
    // via a non-transactional Promise.all (see the clamp comment above
    // `remaining` in computeFifoAllocation): a payment inserted between
    // those two reads can make totalEarmarked outgrow the totalPaid
    // snapshot. Without `Math.max(0, ...)`, `remaining` goes negative and
    // that negative number propagates into `fromPool`, which propagates
    // into a negative `paidAmount` for a later, unearmarked item — money
    // the patient never actually contributed for that item.
    it('never produces a negative paidAmount when an unearmarked item follows an over-earmarked one', () => {
      const items = [item('earmarked', 100, 0), item('unearmarked', 100, 1)]
      // "earmarked" carries a real recorded payment of 150 (capped at its
      // own cost of 100), but the totalPaid snapshot only sums to 30 —
      // the inconsistent state the clamp is designed to survive.
      const result = computeFifoAllocation(items, 30, new Map([['earmarked', 150]]))
      const map = byId(result)

      // The earmarked item is fully covered by its own (capped) earmark,
      // independent of the stale totalPaid figure.
      expect(map.get('earmarked')).toEqual({
        id: 'earmarked',
        type: 'appointment',
        cost: 100,
        paidAmount: 100,
        outstanding: 0,
        isPaid: true,
      })
      // The unearmarked item gets nothing from a pool that was never
      // negative — critically, not a negative paidAmount.
      expect(map.get('unearmarked')).toEqual({
        id: 'unearmarked',
        type: 'appointment',
        cost: 100,
        paidAmount: 0,
        outstanding: 100,
        isPaid: false,
      })
      for (const a of result) {
        expect(a.paidAmount).toBeGreaterThanOrEqual(0)
        expect(a.outstanding).toBeGreaterThanOrEqual(0)
      }
    })
  })
})

// ============================================================================
// convertAppointmentPaymentsToAdvance / restoreAppointmentPaymentsFromAdvance
// (task #391 — cancelling an appointment must stop earmarking its linked
// consultation payment, and restoring must earmark it again). These take a
// real Prisma.TransactionClient, so they are exercised here against the test
// DB rather than as pure-function tests.
// ============================================================================

describe('convertAppointmentPaymentsToAdvance / restoreAppointmentPaymentsFromAdvance (#391)', () => {
  let tenantId: string
  let patientId: string
  let doctorId: string
  let appointmentId: string
  const suffix = Date.now()

  beforeAll(async () => {
    let freePlan = await prisma.plan.findUnique({ where: { name: 'free' } })
    if (!freePlan) {
      freePlan = await prisma.plan.create({
        data: { name: 'free', displayName: 'Free', price: 0, maxAdmins: 1, maxDoctors: 3, maxPatients: 50 },
      })
    }
    const tenant = await prisma.tenant.create({
      data: { name: 'Payment Conversion Svc', slug: `payment-conversion-svc-${suffix}` },
    })
    tenantId = tenant.id
    await prisma.subscription.create({
      data: {
        tenantId,
        planId: freePlan.id,
        status: 'ACTIVE',
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    })
    const patient = await prisma.patient.create({ data: { tenantId, firstName: 'Conv', lastName: 'Patient' } })
    patientId = patient.id
    const doctor = await prisma.doctor.create({
      data: { tenantId, firstName: 'Conv', lastName: 'Doctor', email: `conv-doc-${suffix}@test.com` },
    })
    doctorId = doctor.id
  })

  afterAll(async () => {
    await prisma.patientPayment.deleteMany({ where: { tenantId } })
    await prisma.appointment.deleteMany({ where: { tenantId } })
    await prisma.patient.deleteMany({ where: { tenantId } })
    await prisma.doctor.deleteMany({ where: { tenantId } })
    await prisma.subscription.deleteMany({ where: { tenantId } })
    await prisma.tenant.delete({ where: { id: tenantId } })
  })

  beforeEach(async () => {
    await prisma.patientPayment.deleteMany({ where: { tenantId } })
    await prisma.appointment.deleteMany({ where: { tenantId } })
    const appointment = await prisma.appointment.create({
      data: {
        tenantId,
        patientId,
        doctorId,
        startTime: new Date(Date.now() + 3600_000),
        endTime: new Date(Date.now() + 5400_000),
        duration: 30,
        cost: 100,
      },
    })
    appointmentId = appointment.id
  })

  describe('convertAppointmentPaymentsToAdvance', () => {
    it('flips kind to ADVANCE, appends the " (cita cancelada)" note marker, and preserves appointmentId/amount', async () => {
      const payment = await prisma.patientPayment.create({
        data: {
          tenantId,
          patientId,
          appointmentId,
          amount: 75,
          date: new Date(),
          kind: 'APPOINTMENT',
          note: 'Pago en consulta',
        },
      })

      await prisma.$transaction((tx) => convertAppointmentPaymentsToAdvance(tx, tenantId, appointmentId))

      const updated = await prisma.patientPayment.findUniqueOrThrow({ where: { id: payment.id } })
      expect(updated.kind).toBe('ADVANCE')
      expect(updated.note).toBe('Pago en consulta (cita cancelada)')
      expect(updated.appointmentId).toBe(appointmentId)
      expect(updated.amount.toNumber()).toBe(75)
      expect(updated.isActive).toBe(true)
    })

    it('appends the marker to a null note (yields just the marker text)', async () => {
      const payment = await prisma.patientPayment.create({
        data: { tenantId, patientId, appointmentId, amount: 40, date: new Date(), kind: 'APPOINTMENT', note: null },
      })

      await prisma.$transaction((tx) => convertAppointmentPaymentsToAdvance(tx, tenantId, appointmentId))

      const updated = await prisma.patientPayment.findUniqueOrThrow({ where: { id: payment.id } })
      expect(updated.note).toBe(' (cita cancelada)')
    })

    it('leaves an already-inactive linked payment untouched (nothing to convert)', async () => {
      const payment = await prisma.patientPayment.create({
        data: {
          tenantId,
          patientId,
          appointmentId,
          amount: 50,
          date: new Date(),
          kind: 'APPOINTMENT',
          note: 'x',
          isActive: false,
        },
      })

      await prisma.$transaction((tx) => convertAppointmentPaymentsToAdvance(tx, tenantId, appointmentId))

      const unchanged = await prisma.patientPayment.findUniqueOrThrow({ where: { id: payment.id } })
      expect(unchanged.kind).toBe('APPOINTMENT')
      expect(unchanged.note).toBe('x')
    })

    it('is a no-op (resolves, writes nothing) when no APPOINTMENT payment is linked to the appointment', async () => {
      await expect(
        prisma.$transaction((tx) => convertAppointmentPaymentsToAdvance(tx, tenantId, appointmentId))
      ).resolves.toBeUndefined()
    })
  })

  describe('restoreAppointmentPaymentsFromAdvance', () => {
    it('flips kind back to APPOINTMENT and strips the note marker, preserving appointmentId/amount', async () => {
      const payment = await prisma.patientPayment.create({
        data: {
          tenantId,
          patientId,
          appointmentId,
          amount: 75,
          date: new Date(),
          kind: 'ADVANCE',
          note: 'Pago en consulta (cita cancelada)',
        },
      })

      await prisma.$transaction((tx) => restoreAppointmentPaymentsFromAdvance(tx, tenantId, appointmentId))

      const updated = await prisma.patientPayment.findUniqueOrThrow({ where: { id: payment.id } })
      expect(updated.kind).toBe('APPOINTMENT')
      expect(updated.note).toBe('Pago en consulta')
      expect(updated.appointmentId).toBe(appointmentId)
      expect(updated.amount.toNumber()).toBe(75)
    })

    it('leaves the note unchanged when it does not end with the marker', async () => {
      const payment = await prisma.patientPayment.create({
        data: { tenantId, patientId, appointmentId, amount: 30, date: new Date(), kind: 'ADVANCE', note: 'Entrega manual' },
      })

      await prisma.$transaction((tx) => restoreAppointmentPaymentsFromAdvance(tx, tenantId, appointmentId))

      const updated = await prisma.patientPayment.findUniqueOrThrow({ where: { id: payment.id } })
      expect(updated.kind).toBe('APPOINTMENT')
      expect(updated.note).toBe('Entrega manual')
    })

    // Deliberate negative case (#391): the operator deleted the converted
    // advance while the appointment was cancelled. Restore must NOT resurrect
    // it — the money was already refunded, so the restored appointment should
    // read as unpaid again, not double-earmarked.
    it('never matches an inactive (deleted) advance — a refunded advance stays refunded on restore', async () => {
      const payment = await prisma.patientPayment.create({
        data: {
          tenantId,
          patientId,
          appointmentId,
          amount: 75,
          date: new Date(),
          kind: 'ADVANCE',
          note: 'Pago en consulta (cita cancelada)',
          isActive: false,
        },
      })

      await prisma.$transaction((tx) => restoreAppointmentPaymentsFromAdvance(tx, tenantId, appointmentId))

      const unchanged = await prisma.patientPayment.findUniqueOrThrow({ where: { id: payment.id } })
      expect(unchanged.kind).toBe('ADVANCE')
      expect(unchanged.isActive).toBe(false)
      expect(unchanged.note).toBe('Pago en consulta (cita cancelada)')
    })
  })
})

// ============================================================================
// computeOutstandingByPatient / getTenantOutstandingTotal (task #396 — the
// dashboard's "pending payments" figure became the net outstanding shared
// with the debtors screen). These run grouped aggregates against Postgres,
// so they are exercised here against the test DB.
//
// Money fixtures below are deliberately 2-decimal clinic amounts (178.30 /
// 165.95, not round hundreds): the whole point of the cents-based arithmetic
// is that a chain of subtract/re-add on doubles drifts, and round numbers
// cannot expose that.
// ============================================================================

describe('computeOutstandingByPatient / getTenantOutstandingTotal (#396)', () => {
  let tenantId: string
  let otherTenantId: string
  let doctorId: string
  let otherDoctorId: string
  // Distinct patients per behavior, all inside the same tenant, so the
  // per-patient floor can be observed against a co-tenant's real debt.
  let debtorId: string
  let settledId: string
  let creditId: string
  let otherPatientId: string
  const suffix = Date.now()

  async function seedAppointment(
    forTenantId: string,
    forPatientId: string,
    forDoctorId: string,
    cost: number | null,
    overrides: Record<string, unknown> = {}
  ) {
    return prisma.appointment.create({
      data: {
        tenantId: forTenantId,
        patientId: forPatientId,
        doctorId: forDoctorId,
        startTime: new Date(Date.now() + 3600_000),
        endTime: new Date(Date.now() + 5400_000),
        duration: 30,
        cost,
        ...overrides,
      },
    })
  }

  async function seedPayment(
    forTenantId: string,
    forPatientId: string,
    amount: number,
    overrides: Record<string, unknown> = {}
  ) {
    return prisma.patientPayment.create({
      data: {
        tenantId: forTenantId,
        patientId: forPatientId,
        amount,
        date: new Date(),
        kind: 'ADVANCE',
        ...overrides,
      },
    })
  }

  async function seedLabwork(
    forTenantId: string,
    forPatientId: string,
    price: number,
    overrides: Record<string, unknown> = {}
  ) {
    return prisma.labwork.create({
      data: {
        tenantId: forTenantId,
        patientId: forPatientId,
        lab: 'Lab Central',
        date: new Date(),
        price,
        ...overrides,
      },
    })
  }

  beforeAll(async () => {
    let freePlan = await prisma.plan.findUnique({ where: { name: 'free' } })
    if (!freePlan) {
      freePlan = await prisma.plan.create({
        data: { name: 'free', displayName: 'Free', price: 0, maxAdmins: 1, maxDoctors: 3, maxPatients: 50 },
      })
    }
    const tenant = await prisma.tenant.create({
      data: { name: 'Outstanding Svc', slug: `outstanding-svc-${suffix}` },
    })
    tenantId = tenant.id
    const otherTenant = await prisma.tenant.create({
      data: { name: 'Outstanding Svc Other', slug: `outstanding-svc-other-${suffix}` },
    })
    otherTenantId = otherTenant.id
    for (const id of [tenantId, otherTenantId]) {
      await prisma.subscription.create({
        data: {
          tenantId: id,
          planId: freePlan.id,
          status: 'ACTIVE',
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
      })
    }
    debtorId = (await prisma.patient.create({ data: { tenantId, firstName: 'Debtor', lastName: 'Uno' } })).id
    settledId = (await prisma.patient.create({ data: { tenantId, firstName: 'Settled', lastName: 'Dos' } })).id
    creditId = (await prisma.patient.create({ data: { tenantId, firstName: 'Credit', lastName: 'Tres' } })).id
    otherPatientId = (
      await prisma.patient.create({
        data: { tenantId: otherTenantId, firstName: 'Other', lastName: 'Tenant' },
      })
    ).id
    doctorId = (
      await prisma.doctor.create({
        data: { tenantId, firstName: 'Out', lastName: 'Doctor', email: `out-doc-${suffix}@test.com` },
      })
    ).id
    otherDoctorId = (
      await prisma.doctor.create({
        data: {
          tenantId: otherTenantId,
          firstName: 'Out',
          lastName: 'Doctor Other',
          email: `out-doc-other-${suffix}@test.com`,
        },
      })
    ).id
  })

  afterAll(async () => {
    for (const id of [tenantId, otherTenantId]) {
      await prisma.patientPayment.deleteMany({ where: { tenantId: id } })
      await prisma.labwork.deleteMany({ where: { tenantId: id } })
      await prisma.appointment.deleteMany({ where: { tenantId: id } })
      await prisma.patient.deleteMany({ where: { tenantId: id } })
      await prisma.doctor.deleteMany({ where: { tenantId: id } })
      await prisma.subscription.deleteMany({ where: { tenantId: id } })
      await prisma.tenant.delete({ where: { id } })
    }
  })

  beforeEach(async () => {
    for (const id of [tenantId, otherTenantId]) {
      await prisma.patientPayment.deleteMany({ where: { tenantId: id } })
      await prisma.labwork.deleteMany({ where: { tenantId: id } })
      await prisma.appointment.deleteMany({ where: { tenantId: id } })
    }
  })

  it('a partially paid appointment contributes only the remainder (178.30 billed, 165.95 paid -> 12.35)', async () => {
    await seedAppointment(tenantId, debtorId, doctorId, 178.3)
    await seedPayment(tenantId, debtorId, 165.95)

    const byPatient = await computeOutstandingByPatient(tenantId)

    expect(byPatient.get(debtorId)).toEqual({ totalDebt: 178.3, totalPaid: 165.95, outstanding: 12.35 })
    expect(await getTenantOutstandingTotal(tenantId)).toBe(12.35)
  })

  it('a fully paid appointment contributes exactly 0', async () => {
    await seedAppointment(tenantId, settledId, doctorId, 178.3)
    await seedPayment(tenantId, settledId, 178.3)

    const byPatient = await computeOutstandingByPatient(tenantId)

    expect(byPatient.get(settledId)).toEqual({ totalDebt: 178.3, totalPaid: 178.3, outstanding: 0 })
    expect(await getTenantOutstandingTotal(tenantId)).toBe(0)
  })

  it('an unpaid appointment contributes its full cost', async () => {
    await seedAppointment(tenantId, debtorId, doctorId, 99.99)

    const byPatient = await computeOutstandingByPatient(tenantId)

    expect(byPatient.get(debtorId)).toEqual({ totalDebt: 99.99, totalPaid: 0, outstanding: 99.99 })
    expect(await getTenantOutstandingTotal(tenantId)).toBe(99.99)
  })

  it('a patient in credit reports exactly 0 (never negative) and never offsets another patient debt', async () => {
    // The load-bearing assertion of the per-patient floor: two patients in
    // ONE tenant. Credit patient is 74.40 in credit; if the floor were
    // applied only to the tenant total, the reported figure would be
    // 99.99 - 74.40 = 25.59 instead of the debtor's real 99.99.
    await seedAppointment(tenantId, creditId, doctorId, 45.6)
    await seedPayment(tenantId, creditId, 120.0)
    await seedAppointment(tenantId, debtorId, doctorId, 99.99)

    const byPatient = await computeOutstandingByPatient(tenantId)

    expect(byPatient.get(creditId)).toEqual({ totalDebt: 45.6, totalPaid: 120, outstanding: 0 })
    expect(byPatient.get(creditId)!.outstanding).toBeGreaterThanOrEqual(0)
    expect(byPatient.get(debtorId)!.outstanding).toBe(99.99)
    expect(await getTenantOutstandingTotal(tenantId)).toBe(99.99)

    // listDebtors, built on the same map, omits the credit patient entirely.
    const debtors = await listDebtors(tenantId)
    expect(debtors.map((d) => d.patientId)).toEqual([debtorId])
  })

  it('excludes a labwork whose price is already included in the appointment, and includes a billable one', async () => {
    await seedAppointment(tenantId, debtorId, doctorId, 178.3)
    await seedLabwork(tenantId, debtorId, 62.4, { priceIncludedInAppointment: true })
    await seedLabwork(tenantId, debtorId, 43.75, { priceIncludedInAppointment: false })

    const byPatient = await computeOutstandingByPatient(tenantId)

    // 178.30 + 43.75 = 222.05; the 62.40 included labwork is not billed twice.
    expect(byPatient.get(debtorId)).toEqual({ totalDebt: 222.05, totalPaid: 0, outstanding: 222.05 })
  })

  it('excludes a zero-price labwork even when priceIncludedInAppointment is false', async () => {
    await seedAppointment(tenantId, debtorId, doctorId, 178.3)
    await seedLabwork(tenantId, debtorId, 0, { priceIncludedInAppointment: false })

    const byPatient = await computeOutstandingByPatient(tenantId)

    expect(byPatient.get(debtorId)!.totalDebt).toBe(178.3)
  })

  it('excludes appointments with a null cost and with a zero cost', async () => {
    await seedAppointment(tenantId, debtorId, doctorId, null)
    await seedAppointment(tenantId, debtorId, doctorId, 0)

    const byPatient = await computeOutstandingByPatient(tenantId)

    // No billable row at all -> the patient is absent from the map entirely.
    expect(byPatient.has(debtorId)).toBe(false)
    expect(await getTenantOutstandingTotal(tenantId)).toBe(0)
  })

  it('excludes a soft-deleted (isActive false) appointment', async () => {
    await seedAppointment(tenantId, debtorId, doctorId, 178.3)
    await seedAppointment(tenantId, debtorId, doctorId, 500.55, { isActive: false })

    const byPatient = await computeOutstandingByPatient(tenantId)

    expect(byPatient.get(debtorId)!.totalDebt).toBe(178.3)
  })

  it('excludes a cancelled appointment (status CANCELLED + isActive false)', async () => {
    await seedAppointment(tenantId, debtorId, doctorId, 178.3)
    await seedAppointment(tenantId, debtorId, doctorId, 240.15, {
      isActive: false,
      status: 'CANCELLED',
    })

    const byPatient = await computeOutstandingByPatient(tenantId)

    expect(byPatient.get(debtorId)).toEqual({ totalDebt: 178.3, totalPaid: 0, outstanding: 178.3 })
  })

  it('excludes an inactive (reversed/deleted) payment from totalPaid', async () => {
    await seedAppointment(tenantId, debtorId, doctorId, 178.3)
    await seedPayment(tenantId, debtorId, 165.95)
    await seedPayment(tenantId, debtorId, 50.0, { isActive: false })

    const byPatient = await computeOutstandingByPatient(tenantId)

    expect(byPatient.get(debtorId)).toEqual({ totalDebt: 178.3, totalPaid: 165.95, outstanding: 12.35 })
  })

  it('counts APPOINTMENT-kind payments as well as ADVANCE ones (no kind filter)', async () => {
    const appointment = await seedAppointment(tenantId, debtorId, doctorId, 178.3)
    await seedPayment(tenantId, debtorId, 100.45, {
      kind: 'APPOINTMENT',
      appointmentId: appointment.id,
    })
    await seedPayment(tenantId, debtorId, 65.5, { kind: 'ADVANCE' })

    const byPatient = await computeOutstandingByPatient(tenantId)

    expect(byPatient.get(debtorId)).toEqual({ totalDebt: 178.3, totalPaid: 165.95, outstanding: 12.35 })
  })

  it('is tenant-isolated: another tenant debt, labworks and payments never leak in', async () => {
    await seedAppointment(tenantId, debtorId, doctorId, 178.3)
    await seedAppointment(otherTenantId, otherPatientId, otherDoctorId, 999.95)
    await seedLabwork(otherTenantId, otherPatientId, 55.25)
    await seedPayment(otherTenantId, otherPatientId, 10.1)

    const byPatient = await computeOutstandingByPatient(tenantId)

    expect([...byPatient.keys()]).toEqual([debtorId])
    expect(byPatient.has(otherPatientId)).toBe(false)
    expect(await getTenantOutstandingTotal(tenantId)).toBe(178.3)
    // ...and the other tenant sees only its own: 999.95 + 55.25 - 10.10.
    expect(await getTenantOutstandingTotal(otherTenantId)).toBe(1045.1)
  })

  it('sums a multi-patient tenant in cents, exactly equal to the sum of listDebtors outstanding', async () => {
    await seedAppointment(tenantId, debtorId, doctorId, 178.3)
    await seedPayment(tenantId, debtorId, 165.95) // -> 12.35
    await seedAppointment(tenantId, settledId, doctorId, 210.45)
    await seedPayment(tenantId, settledId, 210.45) // -> 0
    await seedAppointment(tenantId, creditId, doctorId, 45.6)
    await seedPayment(tenantId, creditId, 120.0) // -> 0 (74.40 credit, floored)
    await seedLabwork(tenantId, debtorId, 43.75) // -> debtor now 56.10

    const debtors = await listDebtors(tenantId)
    const sumOfColumn = debtors.reduce((sum, d) => sum + d.outstanding, 0)

    expect(await getTenantOutstandingTotal(tenantId)).toBe(56.1)
    expect(sumOfColumn).toBe(56.1)
  })
})
