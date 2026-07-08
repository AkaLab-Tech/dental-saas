import { describe, it, expect, vi, beforeEach } from 'vitest'

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
})
