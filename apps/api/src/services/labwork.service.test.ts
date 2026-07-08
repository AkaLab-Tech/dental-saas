import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock prisma
vi.mock('@dental/database', () => ({
  prisma: {
    labwork: {
      findMany: vi.fn(),
      count: vi.fn(),
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
import { listLabworks } from './labwork.service.js'

describe('labwork.service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(prisma.labwork.findMany).mockResolvedValue([])
    vi.mocked(prisma.labwork.count).mockResolvedValue(0)
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
      // Note: only `from` is exercised here (not `from` + `to` together). The
      // service builds `date` via two separate object-spreads keyed on `date`
      // (`{ date: { gte } }` then `{ date: { lte } }`), so when both bounds are
      // supplied the second spread clobbers the first and `gte` is silently
      // lost. That is a pre-existing bug in `listLabworks` unrelated to the
      // search feature (present before this task's diff) — reported separately,
      // not fixed here since it is out of scope for the search change.
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
})
