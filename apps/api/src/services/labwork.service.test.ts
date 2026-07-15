import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock prisma
vi.mock('@dental/database', () => ({
  prisma: {
    labwork: {
      findMany: vi.fn(),
      count: vi.fn(),
      aggregate: vi.fn(),
    },
  },
  Prisma: {},
}))

// Mock logger
vi.mock('../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

import { prisma } from '@dental/database'
import { listLabworks, countLabworks, getLabworkStats } from './labwork.service.js'

describe('labwork.service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(prisma.labwork.findMany).mockResolvedValue([])
    vi.mocked(prisma.labwork.count).mockResolvedValue(0)
    vi.mocked(prisma.labwork.aggregate).mockResolvedValue({ _sum: { price: null } } as never)
  })

  describe('listLabworks — search', () => {
    it('does not add an OR clause when search is omitted (existing behavior unchanged)', async () => {
      await listLabworks('tenant-1', {})

      const where = vi.mocked(prisma.labwork.findMany).mock.calls[0][0]!.where
      expect(where).toEqual({
        tenantId: 'tenant-1',
        isActive: true,
      })
      expect(where).not.toHaveProperty('OR')
    })

    it('does not add an OR clause when search is an empty string', async () => {
      await listLabworks('tenant-1', { search: '' })

      const where = vi.mocked(prisma.labwork.findMany).mock.calls[0][0]!.where
      expect(where).not.toHaveProperty('OR')
    })

    it('adds a case-insensitive OR across lab, patient.firstName, patient.lastName when search is set', async () => {
      await listLabworks('tenant-1', { search: 'Acme' })

      const where = vi.mocked(prisma.labwork.findMany).mock.calls[0][0]!.where
      expect(where).toEqual({
        tenantId: 'tenant-1',
        isActive: true,
        OR: [
          { lab: { contains: 'Acme', mode: 'insensitive' } },
          { patient: { firstName: { contains: 'Acme', mode: 'insensitive' } } },
          { patient: { lastName: { contains: 'Acme', mode: 'insensitive' } } },
        ],
      })
    })

    it('matches on lab name search terms case-insensitively (mode: insensitive on the lab clause)', async () => {
      await listLabworks('tenant-1', { search: 'aCmE dEnTaL' })

      const where = vi.mocked(prisma.labwork.findMany).mock.calls[0][0]!.where as Record<string, unknown>
      const or = where.OR as Array<{ lab?: { contains: string; mode: string } }>
      expect(or[0].lab).toEqual({ contains: 'aCmE dEnTaL', mode: 'insensitive' })
    })

    it('matches on patient first OR last name case-insensitively', async () => {
      await listLabworks('tenant-1', { search: 'garcia' })

      const where = vi.mocked(prisma.labwork.findMany).mock.calls[0][0]!.where as Record<string, unknown>
      const or = where.OR as Array<Record<string, unknown>>
      expect(or[1]).toEqual({ patient: { firstName: { contains: 'garcia', mode: 'insensitive' } } })
      expect(or[2]).toEqual({ patient: { lastName: { contains: 'garcia', mode: 'insensitive' } } })
    })

    it('combines search (OR) with an existing filter (isPaid) via AND, not replacing it', async () => {
      await listLabworks('tenant-1', { search: 'Acme', isPaid: true })

      const where = vi.mocked(prisma.labwork.findMany).mock.calls[0][0]!.where
      expect(where).toEqual({
        tenantId: 'tenant-1',
        isActive: true,
        isPaid: true,
        OR: [
          { lab: { contains: 'Acme', mode: 'insensitive' } },
          { patient: { firstName: { contains: 'Acme', mode: 'insensitive' } } },
          { patient: { lastName: { contains: 'Acme', mode: 'insensitive' } } },
        ],
      })
    })

    it('combines search with patientId, isDelivered, and a from-date filter simultaneously', async () => {
      // `date` is built from a single merged object spreading both `gte` (from)
      // and `lte` (to) into the same `date: {...}` literal, so either bound can
      // be supplied independently without clobbering the other. Here only
      // `from` is supplied; see the "date range filtering" describe block below
      // for the combined from+to regression coverage.
      const from = new Date('2026-01-01')

      await listLabworks('tenant-1', {
        search: 'Acme',
        patientId: 'patient-1',
        isDelivered: false,
        from,
      })

      const where = vi.mocked(prisma.labwork.findMany).mock.calls[0][0]!.where
      expect(where).toEqual({
        tenantId: 'tenant-1',
        isActive: true,
        patientId: 'patient-1',
        isDelivered: false,
        date: { gte: from },
        OR: [
          { lab: { contains: 'Acme', mode: 'insensitive' } },
          { patient: { firstName: { contains: 'Acme', mode: 'insensitive' } } },
          { patient: { lastName: { contains: 'Acme', mode: 'insensitive' } } },
        ],
      })
    })

    it('applies the same search where clause to the count query used for pagination totals', async () => {
      await listLabworks('tenant-1', { search: 'Acme' })

      const countWhere = vi.mocked(prisma.labwork.count).mock.calls[0][0]!.where
      expect(countWhere).toHaveProperty('OR')
      expect(countWhere).toEqual(vi.mocked(prisma.labwork.findMany).mock.calls[0][0]!.where)
    })
  })

  describe('listLabworks — date range filtering', () => {
    it('applies only a lower bound (gte) when only `from` is given', async () => {
      const from = new Date('2026-01-01')

      await listLabworks('tenant-1', { from })

      const where = vi.mocked(prisma.labwork.findMany).mock.calls[0][0]!.where
      expect(where).toEqual({ tenantId: 'tenant-1', isActive: true, date: { gte: from } })
    })

    it('applies only an upper bound (lte) when only `to` is given', async () => {
      const to = new Date('2026-01-31')

      await listLabworks('tenant-1', { to })

      const where = vi.mocked(prisma.labwork.findMany).mock.calls[0][0]!.where
      expect(where).toEqual({ tenantId: 'tenant-1', isActive: true, date: { lte: to } })
    })

    it('omits the `date` key entirely when neither `from` nor `to` is given', async () => {
      await listLabworks('tenant-1', {})

      const where = vi.mocked(prisma.labwork.findMany).mock.calls[0][0]!.where
      expect(where).not.toHaveProperty('date')
    })

    it('REGRESSION: applies BOTH bounds (gte and lte) when from and to are given together — would fail pre-fix (second spread used to clobber the first)', async () => {
      const from = new Date('2026-01-01')
      const to = new Date('2026-01-31')

      await listLabworks('tenant-1', { from, to })

      const where = vi.mocked(prisma.labwork.findMany).mock.calls[0][0]!.where as Record<string, unknown>
      expect(where.date).toEqual({ gte: from, lte: to })
    })

    it('applies the combined from+to date filter to the count query used for pagination totals too', async () => {
      const from = new Date('2026-01-01')
      const to = new Date('2026-01-31')

      await listLabworks('tenant-1', { from, to })

      const countWhere = vi.mocked(prisma.labwork.count).mock.calls[0][0]!.where as Record<string, unknown>
      expect(countWhere.date).toEqual({ gte: from, lte: to })
    })
  })

  describe('countLabworks — date range filtering', () => {
    it('applies only a lower bound (gte) when only `from` is given', async () => {
      const from = new Date('2026-01-01')

      await countLabworks('tenant-1', { from })

      const where = vi.mocked(prisma.labwork.count).mock.calls[0][0]!.where
      expect(where).toEqual({ tenantId: 'tenant-1', isActive: true, date: { gte: from } })
    })

    it('applies only an upper bound (lte) when only `to` is given', async () => {
      const to = new Date('2026-01-31')

      await countLabworks('tenant-1', { to })

      const where = vi.mocked(prisma.labwork.count).mock.calls[0][0]!.where
      expect(where).toEqual({ tenantId: 'tenant-1', isActive: true, date: { lte: to } })
    })

    it('omits the `date` key entirely when neither `from` nor `to` is given', async () => {
      await countLabworks('tenant-1', {})

      const where = vi.mocked(prisma.labwork.count).mock.calls[0][0]!.where
      expect(where).not.toHaveProperty('date')
    })

    it('REGRESSION: applies BOTH bounds (gte and lte) when from and to are given together — would fail pre-fix (second spread used to clobber the first)', async () => {
      const from = new Date('2026-01-01')
      const to = new Date('2026-01-31')

      await countLabworks('tenant-1', { from, to })

      const where = vi.mocked(prisma.labwork.count).mock.calls[0][0]!.where as Record<string, unknown>
      expect(where.date).toEqual({ gte: from, lte: to })
    })
  })

  describe('getLabworkStats — date range filtering', () => {
    it('applies only a lower bound (gte) when only `from` is given', async () => {
      const from = new Date('2026-01-01')

      await getLabworkStats('tenant-1', { from })

      const where = vi.mocked(prisma.labwork.count).mock.calls[0][0]!.where
      expect(where).toEqual({ tenantId: 'tenant-1', isActive: true, date: { gte: from } })
    })

    it('applies only an upper bound (lte) when only `to` is given', async () => {
      const to = new Date('2026-01-31')

      await getLabworkStats('tenant-1', { to })

      const where = vi.mocked(prisma.labwork.count).mock.calls[0][0]!.where
      expect(where).toEqual({ tenantId: 'tenant-1', isActive: true, date: { lte: to } })
    })

    it('omits the `date` key entirely when neither `from` nor `to` is given', async () => {
      await getLabworkStats('tenant-1', {})

      const where = vi.mocked(prisma.labwork.count).mock.calls[0][0]!.where
      expect(where).not.toHaveProperty('date')
    })

    it('REGRESSION: applies BOTH bounds (gte and lte) when from and to are given together — would fail pre-fix (second spread used to clobber the first)', async () => {
      const from = new Date('2026-01-01')
      const to = new Date('2026-01-31')

      await getLabworkStats('tenant-1', { from, to })

      const where = vi.mocked(prisma.labwork.count).mock.calls[0][0]!.where as Record<string, unknown>
      expect(where.date).toEqual({ gte: from, lte: to })
    })

    it('applies the same combined from+to date filter to the price aggregate query', async () => {
      const from = new Date('2026-01-01')
      const to = new Date('2026-01-31')

      await getLabworkStats('tenant-1', { from, to })

      const aggregateWhere = vi.mocked(prisma.labwork.aggregate).mock.calls[0][0]!.where as Record<string, unknown>
      expect(aggregateWhere.date).toEqual({ gte: from, lte: to })
    })
  })

  describe('listLabworks — overdue filter', () => {
    beforeEach(() => {
      // Fix "now" so the start-of-today boundary computed inside the service
      // (getStartOfToday) is deterministic and doesn't depend on the machine
      // running the suite. Local time is used deliberately (setSystemTime
      // supplies a UTC instant; getStartOfToday truncates in local time, same
      // as the expected value we compute below).
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-06-15T12:00:00.000Z'))
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    function expectedStartOfToday(): Date {
      const d = new Date()
      d.setHours(0, 0, 0, 0)
      return d
    }

    it('adds isDelivered:false and a strictly-before-today date bound when overdue is true and isDelivered is not explicitly set', async () => {
      await listLabworks('tenant-1', { overdue: true })

      const where = vi.mocked(prisma.labwork.findMany).mock.calls[0][0]!.where
      expect(where).toEqual({
        tenantId: 'tenant-1',
        isActive: true,
        isDelivered: false,
        date: { lt: expectedStartOfToday() },
      })
    })

    it('applies the same overdue where clause to the count query used for pagination totals', async () => {
      await listLabworks('tenant-1', { overdue: true })

      const countWhere = vi.mocked(prisma.labwork.count).mock.calls[0][0]!.where
      expect(countWhere).toEqual(vi.mocked(prisma.labwork.findMany).mock.calls[0][0]!.where)
    })

    it('does not force isDelivered:false when isDelivered is explicitly provided alongside overdue (explicit isDelivered wins)', async () => {
      await listLabworks('tenant-1', { overdue: true, isDelivered: true })

      const where = vi.mocked(prisma.labwork.findMany).mock.calls[0][0]!.where as Record<string, unknown>
      expect(where.isDelivered).toBe(true)
      // The strictly-before-today date bound is still applied even though
      // isDelivered:true is a contradictory combination — overdue only
      // controls the date bound here, isDelivered is a separate branch.
      expect(where.date).toEqual({ lt: expectedStartOfToday() })
    })

    it('merges overdue with an existing `from` bound into a single date filter object (gte + lt)', async () => {
      const from = new Date('2026-01-01')

      await listLabworks('tenant-1', { overdue: true, from })

      const where = vi.mocked(prisma.labwork.findMany).mock.calls[0][0]!.where as Record<string, unknown>
      expect(where.date).toEqual({ gte: from, lt: expectedStartOfToday() })
    })

    it('merges overdue with existing from+to bounds into a single date filter object (gte + lte + lt)', async () => {
      const from = new Date('2026-01-01')
      const to = new Date('2026-12-31')

      await listLabworks('tenant-1', { overdue: true, from, to })

      const where = vi.mocked(prisma.labwork.findMany).mock.calls[0][0]!.where as Record<string, unknown>
      expect(where.date).toEqual({ gte: from, lte: to, lt: expectedStartOfToday() })
    })

    it('does not add isDelivered or a date bound when overdue is explicitly false (falsy, not treated as active)', async () => {
      await listLabworks('tenant-1', { overdue: false })

      const where = vi.mocked(prisma.labwork.findMany).mock.calls[0][0]!.where
      expect(where).toEqual({ tenantId: 'tenant-1', isActive: true })
      expect(where).not.toHaveProperty('isDelivered')
      expect(where).not.toHaveProperty('date')
    })

    it('omits isDelivered and the date bound entirely when overdue is undefined (existing behavior unchanged)', async () => {
      await listLabworks('tenant-1', {})

      const where = vi.mocked(prisma.labwork.findMany).mock.calls[0][0]!.where
      expect(where).not.toHaveProperty('isDelivered')
      expect(where).not.toHaveProperty('date')
    })
  })

  describe('getLabworkStats — overdue count', () => {
    beforeEach(() => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-06-15T12:00:00.000Z'))
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    function expectedStartOfToday(): Date {
      const d = new Date()
      d.setHours(0, 0, 0, 0)
      return d
    }

    it('queries the overdue count with isDelivered:false and date strictly before start-of-today', async () => {
      await getLabworkStats('tenant-1', {})

      // Promise.all order in getLabworkStats: [total, paid, delivered, overdue, aggregate, paidAggregate]
      const overdueWhere = vi.mocked(prisma.labwork.count).mock.calls[3][0]!.where as Record<string, unknown>
      expect(overdueWhere).toEqual({
        tenantId: 'tenant-1',
        isActive: true,
        isDelivered: false,
        date: { lt: expectedStartOfToday() },
      })
    })

    it('intersects the overdue date bound with an existing from/to window instead of replacing it', async () => {
      const from = new Date('2026-01-01')
      const to = new Date('2026-12-31')

      await getLabworkStats('tenant-1', { from, to })

      const overdueWhere = vi.mocked(prisma.labwork.count).mock.calls[3][0]!.where as Record<string, unknown>
      expect(overdueWhere.date).toEqual({ gte: from, lte: to, lt: expectedStartOfToday() })
    })

    it('surfaces the overdue count returned by prisma on the `overdue` field of the result', async () => {
      vi.mocked(prisma.labwork.count)
        .mockResolvedValueOnce(10) // total
        .mockResolvedValueOnce(6) // paid
        .mockResolvedValueOnce(4) // delivered
        .mockResolvedValueOnce(3) // overdue

      const result = await getLabworkStats('tenant-1', {})

      expect(result.overdue).toBe(3)
    })
  })
})
