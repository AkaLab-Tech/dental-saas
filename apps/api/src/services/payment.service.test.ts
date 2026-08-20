import { describe, it, expect } from 'vitest'
import { computeFifoAllocation, type BillableItem, type FifoAllocation } from './payment.service.js'

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
    const items = [item('a', 100), item('b', 50, 1), item('c', 200, 2)]
    const totalCost = 350

    const earmarkScenarios: { label: string; earmarks: Map<string, number> | undefined }[] = [
      { label: 'no earmarks argument', earmarks: undefined },
      { label: 'empty earmarks map', earmarks: new Map() },
      { label: 'a single under-cost earmark', earmarks: new Map([['a', 30]]) },
      { label: 'an earmark larger than its own item cost', earmarks: new Map([['a', 500]]) },
      { label: 'an over-cost earmark on the middle item', earmarks: new Map([['b', 999]]) },
      { label: 'an earmark id absent from items', earmarks: new Map([['ghost', 40]]) },
      {
        label: 'every item earmarked exactly at cost',
        earmarks: new Map([
          ['a', 100],
          ['b', 50],
          ['c', 200],
        ]),
      },
      {
        label: 'every item earmarked far over cost',
        earmarks: new Map([
          ['a', 1000],
          ['b', 1000],
          ['c', 1000],
        ]),
      },
      {
        label: 'mixed under/over/absent earmarks together',
        earmarks: new Map([
          ['a', 10],
          ['b', 9999],
          ['ghost', 5],
        ]),
      },
    ]

    const totalPaidScenarios = [0, 1, 49, 100, 150, 200, 349, 350, 351, 500, 10_000]

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
          expect(sumPaid).toBe(Math.min(totalPaid, totalCost))
          // Every item's paidAmount is bounded by its own cost, and
          // outstanding never goes negative.
          for (const a of allocations) {
            expect(a.paidAmount).toBeLessThanOrEqual(a.cost)
            expect(a.paidAmount).toBeGreaterThanOrEqual(0)
            expect(a.outstanding).toBeGreaterThanOrEqual(0)
            expect(a.outstanding).toBe(a.cost - a.paidAmount)
            expect(a.isPaid).toBe(a.cost > 0 && a.paidAmount >= a.cost)
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
})
